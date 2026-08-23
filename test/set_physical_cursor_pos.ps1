param([int]$X, [int]$Y)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper2 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
}
"@
[DpiHelper2]::SetProcessDpiAwarenessContext([DpiHelper2]::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) | Out-Null
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($X, $Y)
Start-Sleep -Milliseconds 200
$c = [System.Windows.Forms.Cursor]::Position
Write-Host "CURSOR: $($c.X), $($c.Y)"
