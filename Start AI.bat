@echo off
setlocal
cd /d "%~dp0"

echo Personal AI Launcher
echo --------------------

rem Start Docker before PowerShell. The Docker Desktop CLI works even when the
rem engine itself is stopped on current Docker Desktop releases.
docker info >nul 2>nul
if not errorlevel 1 goto docker_ready

echo.
echo Starting Docker Desktop...
docker desktop start --detach >nul 2>nul
if not errorlevel 1 goto wait_for_docker

rem Fall back to executable discovery for Docker Desktop versions that do not
rem provide the `docker desktop` CLI. Cover both system-wide and per-user installs.
set "DOCKER_DESKTOP="
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe" set "DOCKER_DESKTOP=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%LOCALAPPDATA%\Programs\DockerDesktop\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%LOCALAPPDATA%\Programs\DockerDesktop\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%LOCALAPPDATA%\Programs\Docker\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%LOCALAPPDATA%\Programs\Docker\Docker\Docker Desktop.exe"
if not defined DOCKER_DESKTOP if exist "%LOCALAPPDATA%\Docker\Docker Desktop.exe" set "DOCKER_DESKTOP=%LOCALAPPDATA%\Docker\Docker Desktop.exe"

if defined DOCKER_DESKTOP (
    echo Found Docker Desktop at: %DOCKER_DESKTOP%
    start "" "%DOCKER_DESKTOP%"
    goto wait_for_docker
)

echo.
echo PERSONAL AI FAILED TO START
echo Docker is installed, but the launcher could not start Docker Desktop.
echo Open Docker Desktop once manually, then try Start AI.bat again.
pause
exit /b 1

:wait_for_docker
echo Waiting for the Docker engine to become ready...
for /l %%I in (1,1,90) do (
    docker info >nul 2>nul
    if not errorlevel 1 goto docker_ready
    timeout /t 2 /nobreak >nul
)

echo.
echo PERSONAL AI FAILED TO START
echo Docker Desktop was launched, but its engine did not become ready.
echo Open Docker Desktop and check whether it reports a startup error.
pause
exit /b 1

:docker_ready
echo Docker engine is ready.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Personal AI failed to start. See the message above for details.
    pause
)

exit /b %EXIT_CODE%
