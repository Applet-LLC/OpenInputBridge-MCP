# Reliably steals foreground focus for a target window from a background
# PowerShell process, using the standard AttachThreadInput trick (plain
# SetForegroundWindow from a non-foreground process is blocked by Windows'
# focus-stealing prevention). Used so real-hardware input tests land on the
# intended test window instead of whatever console/editor last had focus.
param(
    [Parameter(Mandatory = $true)]
    [long]$Hwnd
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OibFocus {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@

$target = [IntPtr]$Hwnd
$fg = [OibFocus]::GetForegroundWindow()
$fgThread = [OibFocus]::GetWindowThreadProcessId($fg, [ref]0)
$targetThread = [OibFocus]::GetWindowThreadProcessId($target, [ref]0)
$curThread = [OibFocus]::GetCurrentThreadId()

[OibFocus]::AttachThreadInput($curThread, $fgThread, $true) | Out-Null
[OibFocus]::AttachThreadInput($targetThread, $fgThread, $true) | Out-Null

[OibFocus]::ShowWindow($target, 9) | Out-Null # SW_RESTORE
[OibFocus]::BringWindowToTop($target) | Out-Null
$ok = [OibFocus]::SetForegroundWindow($target)

[OibFocus]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
[OibFocus]::AttachThreadInput($targetThread, $fgThread, $false) | Out-Null

Start-Sleep -Milliseconds 300

$nowFg = [OibFocus]::GetForegroundWindow()
Write-Host "SetForegroundWindow returned: $ok"
Write-Host "Foreground window is now: $nowFg (target was: $target)"
if ($nowFg -eq $target) {
    Write-Host "FOCUS_OK"
} else {
    Write-Host "FOCUS_FAILED"
}
