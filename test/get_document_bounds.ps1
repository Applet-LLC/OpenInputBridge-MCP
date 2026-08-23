param([long]$Hwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper4 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
}
"@
[DpiHelper4]::SetProcessDpiAwarenessContext([DpiHelper4]::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) | Out-Null

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$hwnd = [IntPtr]$Hwnd
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$doc = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
$r = $doc.Current.BoundingRectangle
Write-Host "DOCUMENT_BOUNDS: $r"
