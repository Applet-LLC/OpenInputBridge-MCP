# Prints the cursor position in physical (per-monitor-DPI-aware) pixels,
# plus each monitor's physical bounds - must be run as a fresh process
# (System.Windows.Forms.Screen caches monitor info per-process and a
# process's DPI awareness context can only be set once, before any
# Forms/graphics API call, so this can't be safely reused mid-session in
# a long-lived host). See test/REALWORLD_TESTING.md item 6.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
}
"@
[DpiHelper]::SetProcessDpiAwarenessContext([DpiHelper]::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) | Out-Null

Add-Type -AssemblyName System.Windows.Forms
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    Write-Host "$($s.DeviceName): Bounds=$($s.Bounds) Primary=$($s.Primary)"
}
Write-Host "VirtualScreen: $([System.Windows.Forms.SystemInformation]::VirtualScreen)"
$c = [System.Windows.Forms.Cursor]::Position
Write-Host "CURSOR: $($c.X), $($c.Y)"
