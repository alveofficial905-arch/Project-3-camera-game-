$workDir = "e:\Anti Gravity\Project 3 Camera Game"
Set-Location $workDir

# 1. Clean up old tunnels
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

$logPath = "$workDir\cloudflared.log"
if (Test-Path $logPath) { Remove-Item $logPath -Force }

# 2. Launch cloudflared tunnel
$cfExe = "$workDir\cloudflared.exe"
$proc = Start-Process -FilePath $cfExe -ArgumentList "tunnel --url http://127.0.0.1:8080 --no-autoupdate" -RedirectStandardError $logPath -PassThru

$url = $null
for ($i = 0; $i -lt 120; $i++) {
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
    Write-Host "  LIVE CLOUDFLARE HTTPS LINK READY!" -ForegroundColor Green
    Write-Host "  $url" -ForegroundColor Yellow
    Write-Host "  Local Link: http://localhost:8080/" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Green
    [System.IO.File]::WriteAllText("$workDir\live_url.txt", $url)
} else {
    Write-Host "Failed to extract Cloudflare tunnel URL." -ForegroundColor Red
}

# Keep running
while (-not $proc.HasExited) {
    Start-Sleep -Seconds 10
}
