# ============================================================
# TEMPLE RUN IRL - MULTITHREADED HIGH-SPEED HTTP SERVER
# Powershell + Built-in C# Multi-threaded Web Server
# Compatible with Localhost, Chrome, Edge, and Remote Tunnels
# ============================================================

$root = $PSScriptRoot
if (-not $root -or -not (Test-Path $root)) {
    $root = "e:\Anti Gravity\Project 3 Camera Game"
}

$port = 8080

# Clean up any lingering process on port 8080 (except self)
$conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    if ($c.OwningProcess -ne $PID) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 300

$csPath = Join-Path $root "Server.cs"
Add-Type -Path $csPath

$server = New-Object TempleServer.HttpServer($port, $root)

try {
    $server.Start()
} finally {
    $server.Stop()
}
