# ============================================================
# TEMPLE RUN IRL - LIVE TUNNEL & SERVER RUNNER
# ============================================================

$workDir = $PSScriptRoot
if (-not $workDir -or -not (Test-Path $workDir)) {
    $workDir = "e:\Anti Gravity\Project 3 Camera Game"
}
Set-Location $workDir

# 1. Clean up old tunnels & processes
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process ssh -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# 2. Check if local server is responding on port 8080
$serverRunning = $false
try {
    $resp = curl.exe -s -o NUL -w "%{http_code}" -m 2 "http://127.0.0.1:8080/"
    if ($resp -eq "200") { $serverRunning = $true }
} catch {}

if (-not $serverRunning) {
    # Free port 8080 if lingering
    $conns = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
    Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$workDir\server.ps1`"" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

# 3. Start Cloudflare Tunnel
$logPath = "$workDir\cloudflared.log"
if (Test-Path $logPath) { Remove-Item $logPath -Force }

$cfExe = "$workDir\cloudflared.exe"
$proc = Start-Process -FilePath $cfExe -ArgumentList "tunnel --url http://127.0.0.1:8080 --no-autoupdate" -RedirectStandardError $logPath -PassThru

$url = $null
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $logPath) {
        $content = Get-Content $logPath -Raw
        if ($content -match '(https://[a-zA-Z0-9\.\-_]+\.trycloudflare\.com)') {
            $url = $matches[1]
            break
        }
    }
}

if ($url) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  TEMPLE RUN IRL - LIVE PUBLIC HTTPS READY!" -ForegroundColor Green
    Write-Host "  Live URL:   $url" -ForegroundColor Yellow
    Write-Host "  Local URL:  http://localhost:8080/" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Green
    [System.IO.File]::WriteAllText("$workDir\live_url.txt", $url)
} else {
    Write-Host "Failed to obtain tunnel URL." -ForegroundColor Red
}

while (-not $proc.HasExited) {
    Start-Sleep -Seconds 10
}
