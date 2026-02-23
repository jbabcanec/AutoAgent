$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error "pnpm is required but not found in PATH."
}
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCommand) {
  $pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
}
if (-not $pnpmCommand) {
  Write-Error "Unable to resolve pnpm executable (pnpm.cmd/pnpm)."
}
$pnpmExe = $pnpmCommand.Source

Write-Host "Installing/updating dependencies..."
& $pnpmExe install

Write-Host "Starting control-plane..."
$control = Start-Process -FilePath $pnpmExe -ArgumentList @("--filter", "@autoagent/control-plane", "dev") -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting desktop app..."
$web = Start-Process -FilePath $pnpmExe -ArgumentList @("--filter", "@autoagent/web", "dev") -PassThru

Write-Host "AutoAgent dev mode is running."
Write-Host "Press Enter to stop services."
[void][System.Console]::ReadLine()

Write-Host "Stopping services..."
if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force }
if ($control -and -not $control.HasExited) { Stop-Process -Id $control.Id -Force }
