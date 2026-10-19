param(
  [switch]$Background
)

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root 'logs'
$serverLog = Join-Path $logDir 'server.log'
$serverErr = Join-Path $logDir 'server.err.log'
$clientLog = Join-Path $logDir 'client.log'
$clientErr = Join-Path $logDir 'client.err.log'
$apiUrl = 'http://127.0.0.1:3001'
$webUrl = 'http://localhost:5173/'
$autostartDir = [Environment]::GetFolderPath('Startup')
$autostartFile = Join-Path $autostartDir 'PokerCRM-Autostart.vbs'
$autostartLog = Join-Path $logDir 'autostart.log'
$autostartMutexName = 'PokerCRM-Autostart'
$bootDelaySeconds = 15

function Get-PortPids([int]$port) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    return @($conns | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique)
  } catch {
    return @()
  }
}

function Get-ServiceStatus {
  $apiUp = @(Get-PortPids 3001).Count -gt 0
  $webUp = @(Get-PortPids 5173).Count -gt 0
  return $apiUp, $webUp
}

function Write-AutostartLog([string]$message) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Add-Content -LiteralPath $autostartLog -Value "$(Get-Date -Format s) $message" -Encoding UTF8
}

function Stop-Services {
  foreach ($port in @(3001, 5173)) {
    foreach ($procId in Get-PortPids $port) {
      if ($procId -le 0) { continue }
      Write-Host "  останавливаю PID $procId (порт $port)"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

function Start-Services {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Start-Process cmd.exe -ArgumentList '/c', 'npm run dev -w server' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr
  Start-Process cmd.exe -ArgumentList '/c', 'npm run dev -w client' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $clientLog -RedirectStandardError $clientErr
  Write-Host "  сервисы стартуют в фоне (логи: $logDir)"
}

function Wait-Healthy([int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $apiUp = $false
    $webUp = $false
    try { $null = Invoke-WebRequest "$apiUrl/api/health" -TimeoutSec 2 -UseBasicParsing; $apiUp = $true } catch { }
    try { $res = Invoke-WebRequest $webUrl -TimeoutSec 2 -UseBasicParsing; $webUp = ($res.StatusCode -eq 200) } catch { }
    if ($apiUp -and $webUp) { return $true }
    Start-Sleep -Milliseconds 600
  }
  return $false
}

function Start-And-Open {
  Start-Services
  Write-Host "  жду поднятия сервисов..."
  if (Wait-Healthy 45) {
    Write-Host "  сервисы запущены: API $apiUrl, UI $webUrl"
    if (-not $Background) { Start-Process $webUrl }
  } else {
    Write-Host "  сервисы не поднялись за 45c — смотри логи в $logDir"
  }
}

function Start-Background {
  $mutex = New-Object System.Threading.Mutex($false, $autostartMutexName)
  $locked = $false
  try {
    $locked = $mutex.WaitOne(5000)
    if (-not $locked) {
      $locked = $mutex.WaitOne(70000)
      if (-not $locked) {
        Write-AutostartLog 'первый экземпляр автозапуска не ответил за 75 c — пропускаю'
        return
      }
    }
    $apiUp, $webUp = Get-ServiceStatus
    if ($apiUp -or $webUp) {
      Write-AutostartLog 'сервисы уже подняты — повторный автозапуск не создаю'
      return
    }
    Start-Services
    if (Wait-Healthy 45) {
      Write-AutostartLog "сервисы запущены (API $apiUrl, UI $webUrl)"
    } else {
      Write-AutostartLog 'сервисы не поднялись за 45c — смотри logs/*.err.log'
    }
  } finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Test-Autostart {
  Test-Path -LiteralPath $autostartFile
}

function Enable-Autostart {
  New-Item -ItemType Directory -Force -Path $autostartDir | Out-Null
  $scriptPath = Join-Path $root 'start.ps1'
  $vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""$scriptPath"" -Background", 0, False
"@
  Set-Content -LiteralPath $autostartFile -Value $vbs -Encoding ASCII
  Write-AutostartLog "автозапуск включён: $autostartFile -> $scriptPath"
}

function Disable-Autostart {
  if (Test-Path -LiteralPath $autostartFile) {
    Remove-Item -LiteralPath $autostartFile -Force
  }
}

function Show-Menu {
  while ($true) {
    Write-Host ''
    Write-Host '  1 — Перезапустить сервисы'
    Write-Host '  2 — Остановить сервисы'
    if (Test-Autostart) {
      Write-Host '  3 — Выключить автозапуск'
    } else {
      Write-Host '  3 — Включить автозапуск'
    }
    Write-Host '  4 — Выйти'
    $choice = Read-Host 'Выбери действие (1-4)'
    switch ($choice) {
      '1' { Stop-Services; Start-And-Open; return }
      '2' { Stop-Services; Write-Host '  сервисы остановлены.'; return }
      '3' {
        if (Test-Autostart) {
          Disable-Autostart
          Write-Host '  автозапуск выключен.'
        } else {
          Enable-Autostart
          Write-Host "  автозапуск включён: $autostartFile"
        }
      }
      '4' { return }
      default { Write-Host '  Неизвестный вариант.' }
    }
  }
}

if ($Background) {
  Write-AutostartLog "автозапуск: жду $bootDelaySeconds c, пока Windows поднимет сеть"
  Start-Sleep -Seconds $bootDelaySeconds
  try {
    Start-Background
  } catch {
    Write-AutostartLog "ОШИБКА автозапуска: $($_.Exception.Message)"
  }
  return
}

$apiUp, $webUp = Get-ServiceStatus

if ($apiUp -and $webUp) {
  Write-Host 'Poker CRM: сервисы уже запущены'
  Write-Host "  API $apiUrl — работает"
  Write-Host "  UI  $webUrl — работает"
} else {
  if ($apiUp -or $webUp) {
    Write-Host 'Poker CRM: часть сервисов недоступна — перезапускаю оба.'
    Stop-Services
  } else {
    Write-Host 'Poker CRM: сервисы не запущены — стартую в фоне.'
  }
  Start-And-Open
}

Show-Menu