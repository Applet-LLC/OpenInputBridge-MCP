# Drives oib_bridge.exe's raw stdin/stdout protocol directly (bypassing the
# TypeScript bridge's automatic heartbeat sender) to verify the watchdog
# auto-disables exclusive mode when heartbeats stop arriving. No physical
# keyboard/mouse interaction needed - this only checks the driver-facing
# state transition and the emitted "event" line.
$exePath = Join-Path $PSScriptRoot "..\helper\oib_bridge.exe"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exePath
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.UseShellExecute = $false

$proc = [System.Diagnostics.Process]::Start($psi)

function Send-Line($line) {
    $proc.StandardInput.WriteLine($line)
    $proc.StandardInput.Flush()
}

Write-Host "--- enabling exclusive mode, watchdogTimeoutMs=3000, sending NO heartbeat ---"
Send-Line '{"id":1,"cmd":"enable_exclusive_input_mode","watchdogTimeoutMs":3000}'
$line1 = $proc.StandardOutput.ReadLine()
Write-Host "RESPONSE: $line1"

Write-Host "--- waiting 5s (past the 3s watchdog timeout) without sending any heartbeat ---"
Start-Sleep -Seconds 5

Write-Host "--- reading for the auto-disable event line (should already be buffered) ---"
$autoDisableLine = $null
if (-not $proc.StandardOutput.EndOfStream) {
    $autoDisableLine = $proc.StandardOutput.ReadLine()
}
Write-Host "EVENT LINE: $autoDisableLine"

Write-Host "--- querying heartbeat/status to confirm exclusiveModeActive is now false ---"
Send-Line '{"id":2,"cmd":"heartbeat"}'
$line2 = $proc.StandardOutput.ReadLine()
Write-Host "RESPONSE: $line2"

Write-Host "--- safety net: explicit disable (idempotent) ---"
Send-Line '{"id":3,"cmd":"disable_exclusive_input_mode"}'
$line3 = $proc.StandardOutput.ReadLine()
Write-Host "RESPONSE: $line3"

$proc.StandardInput.Close()
$proc.WaitForExit(2000) | Out-Null
if (-not $proc.HasExited) { $proc.Kill() }
Write-Host "--- done, process exited: $($proc.HasExited) ---"
