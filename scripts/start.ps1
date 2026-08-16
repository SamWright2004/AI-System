$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail {
    param([string]$Message)
    throw $Message
}

function Require-Command {
    param([string]$Name, [string]$InstallHint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "Missing $Name. $InstallHint"
    }
}

function Read-DotEnv {
    param([string]$Path)

    $Values = @{}
    if (-not (Test-Path $Path)) {
        return $Values
    }

    foreach ($Line in Get-Content $Path) {
        $Trimmed = $Line.Trim()
        if (-not $Trimmed -or $Trimmed.StartsWith("#")) {
            continue
        }

        $Separator = $Trimmed.IndexOf("=")
        if ($Separator -lt 1) {
            continue
        }

        $Key = $Trimmed.Substring(0, $Separator).Trim()
        $Value = $Trimmed.Substring($Separator + 1).Trim()
        $Values[$Key] = $Value
    }

    return $Values
}

function Test-Url {
    param([string]$Url, [int]$TimeoutSeconds = 2)
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-DockerEngine {
    # Docker writes its normal "daemon is not running" state to stderr. With the
    # launcher's terminating-error policy that can abort the script before we get
    # a chance to start Docker Desktop, so probe it through cmd and use only the
    # process exit code.
    cmd.exe /d /c "docker info >nul 2>nul"
    return ($LASTEXITCODE -eq 0)
}

function Wait-ForCondition {
    param(
        [scriptblock]$Condition,
        [int]$Attempts,
        [int]$DelaySeconds,
        [string]$FailureMessage
    )

    for ($Attempt = 1; $Attempt -le $Attempts; $Attempt++) {
        if (& $Condition) {
            return
        }
        Start-Sleep -Seconds $DelaySeconds
    }

    Fail $FailureMessage
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerEngine) {
        Write-Host "Docker engine is already running."
        return
    }

    Write-Step "Starting Docker Desktop"
    Write-Host "Docker is installed, but its engine is currently stopped."

    $Candidates = @(
        "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$Env:LOCALAPPDATA\Docker\Docker Desktop.exe"
    )

    $DockerDesktop = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $DockerDesktop) {
        Fail "Docker Desktop could not be found. Install or open Docker Desktop manually once, then try again."
    }

    Write-Host "Launching Docker Desktop..."
    Start-Process -FilePath $DockerDesktop | Out-Null
    Write-Host "Waiting for the Docker engine to become ready. This can take a little while after Windows starts."

    Wait-ForCondition `
        -Condition { Test-DockerEngine } `
        -Attempts 90 `
        -DelaySeconds 2 `
        -FailureMessage "Docker Desktop opened, but the Docker engine did not become ready. Open Docker Desktop and check whether it reports a startup error."

    Write-Host "Docker engine is ready."
}

function Ensure-Postgres {
    Write-Step "Starting the local database"
    docker compose up -d postgres | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Fail "Docker could not start PostgreSQL. Run 'docker compose logs postgres' for details."
    }

    Wait-ForCondition `
        -Condition {
            cmd.exe /d /c "docker compose exec -T postgres pg_isready -U personal_ai -d personal_ai >nul 2>nul"
            return ($LASTEXITCODE -eq 0)
        } `
        -Attempts 30 `
        -DelaySeconds 2 `
        -FailureMessage "PostgreSQL did not become ready. Run 'docker compose logs postgres' for details."

    Write-Host "PostgreSQL is ready."
}

function Ensure-LocalOllama {
    param([hashtable]$EnvValues)

    $Provider = if ($EnvValues.ContainsKey("AI_PROVIDER")) { $EnvValues["AI_PROVIDER"] } else { "mock" }
    if ($Provider -ne "ollama") {
        Write-Host "AI provider is '$Provider'; Ollama startup is not required."
        return
    }

    $BaseUrl = if ($EnvValues.ContainsKey("OLLAMA_BASE_URL")) { $EnvValues["OLLAMA_BASE_URL"] } else { "http://127.0.0.1:11434" }
    $Model = if ($EnvValues.ContainsKey("OLLAMA_CHAT_MODEL")) { $EnvValues["OLLAMA_CHAT_MODEL"] } else { "qwen3.5:4b" }

    $Uri = [Uri]$BaseUrl
    $IsLocal = $Uri.Host -in @("127.0.0.1", "localhost", "::1")

    Write-Step "Checking Ollama"

    if (-not (Test-Url "$BaseUrl/api/tags")) {
        if (-not $IsLocal) {
            Fail "The configured Ollama server at $BaseUrl is unavailable."
        }

        Require-Command "ollama" "Install Ollama, then reopen the launcher."
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden | Out-Null

        Wait-ForCondition `
            -Condition { Test-Url "$BaseUrl/api/tags" } `
            -Attempts 30 `
            -DelaySeconds 2 `
            -FailureMessage "Ollama was started, but its local API at $BaseUrl did not become ready."
    }

    Write-Host "Ollama is ready."

    if (-not $IsLocal) {
        return
    }

    Require-Command "ollama" "Install Ollama, then reopen the launcher."
    $Models = ollama list 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "Ollama is running, but the launcher could not list installed models."
    }

    $ModelPresent = $false
    foreach ($Line in $Models) {
        if ($Line -match "^\s*$([Regex]::Escape($Model))\s") {
            $ModelPresent = $true
            break
        }
    }

    if (-not $ModelPresent) {
        Fail "The configured Ollama model '$Model' is not installed. Run: ollama pull $Model"
    }

    Write-Host "Model '$Model' is available."
}

function Ensure-LocalFiles {
    $NeedsBootstrap = (-not (Test-Path ".env")) -or (-not (Test-Path "config/personalisation/profile.local.json")) -or (-not (Test-Path "node_modules"))
    if (-not $NeedsBootstrap) {
        return
    }

    Write-Step "Completing first-time setup"
    & "$PSScriptRoot\bootstrap.ps1"
    if ($LASTEXITCODE -ne 0) {
        Fail "First-time setup failed."
    }
}

function Ensure-Dependencies {
    Require-Command "node" "Install Node.js 24 LTS, then try again."
    Require-Command "pnpm" "Run: npm install --global pnpm@11"
    Require-Command "docker" "Install Docker Desktop with the WSL 2 backend."

    $NodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
    if ($NodeMajor -ne 24) {
        Fail "Node.js 24 LTS is required. Found $(node --version)."
    }
}

function Start-Application {
    $WebUrl = "http://127.0.0.1:5173"
    $HealthUrl = "http://127.0.0.1:4310/api/v1/health"

    if ((Test-Url $WebUrl) -and (Test-Url $HealthUrl)) {
        Write-Host "Personal AI is already running."
        Start-Process $WebUrl | Out-Null
        return
    }

    Write-Step "Starting Personal AI"

    $EscapedProjectRoot = $ProjectRoot.Replace("'", "''")
    $Command = "Set-Location -LiteralPath '$EscapedProjectRoot'; pnpm dev"
    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
        -WorkingDirectory $ProjectRoot | Out-Null

    Wait-ForCondition `
        -Condition { (Test-Url $WebUrl) -and (Test-Url $HealthUrl) } `
        -Attempts 45 `
        -DelaySeconds 2 `
        -FailureMessage "The application processes started, but the web interface or API did not become ready. Check the Personal AI terminal window for the error."

    Write-Host "Personal AI is ready."
    Start-Process $WebUrl | Out-Null
}

try {
    Write-Host "Personal AI Launcher" -ForegroundColor Green
    Write-Host "--------------------" -ForegroundColor DarkGray

    Ensure-Dependencies
    Start-DockerDesktopIfNeeded
    Ensure-LocalFiles
    Ensure-Postgres

    Write-Step "Updating the database schema"
    pnpm db:migrate | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Fail "Database migration failed."
    }

    $EnvValues = Read-DotEnv ".env"
    Ensure-LocalOllama -EnvValues $EnvValues
    Start-Application

    Write-Host ""
    Write-Host "Personal AI launched successfully." -ForegroundColor Green
    exit 0
} catch {
    Write-Host ""
    Write-Host "PERSONAL AI FAILED TO START" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
