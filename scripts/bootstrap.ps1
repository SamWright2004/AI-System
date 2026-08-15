$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Require-Command {
    param([string]$Name, [string]$InstallHint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing $Name. $InstallHint"
    }
}

Require-Command "git" "Install Git for Windows, then reopen PowerShell."
Require-Command "node" "Install Node.js 24 LTS, then reopen PowerShell."
Require-Command "pnpm" "Run: npm install --global pnpm@11"
Require-Command "docker" "Install and start Docker Desktop with the WSL 2 backend."

$NodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($NodeMajor -ne 24) {
    throw "Node.js 24 LTS is required. Found $(node --version)."
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    $SecretBytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($SecretBytes)
    $Secret = [Convert]::ToHexString($SecretBytes).ToLowerInvariant()
    $EnvText = Get-Content ".env" -Raw
    $EnvText = $EnvText.Replace("development-only-secret-change-me", $Secret)
    Set-Content ".env" $EnvText -NoNewline
    Write-Host "Created local .env configuration."
} else {
    Write-Host "Keeping the existing .env configuration."
}

$PersonalisationFile = "config/personalisation/profile.local.json"
if (-not (Test-Path $PersonalisationFile)) {
    Copy-Item "config/personalisation/profile.example.json" $PersonalisationFile
    Write-Host "Created local personalisation profile."
} else {
    Write-Host "Keeping the existing personalisation profile."
}

pnpm install
docker compose up -d

Write-Host "Waiting for PostgreSQL..."
$Ready = $false
for ($Attempt = 1; $Attempt -le 30; $Attempt++) {
    docker compose exec -T postgres pg_isready -U personal_ai -d personal_ai *> $null
    if ($LASTEXITCODE -eq 0) {
        $Ready = $true
        break
    }
    Start-Sleep -Seconds 2
}

if (-not $Ready) {
    throw "PostgreSQL did not become ready. Open Docker Desktop and run: docker compose logs postgres"
}

pnpm db:migrate
pnpm db:seed

Write-Host ""
Write-Host "Foundation ready. Run: pnpm dev"
Write-Host "Then open: http://127.0.0.1:5173"
Write-Host "Personalise it in: $PersonalisationFile"
