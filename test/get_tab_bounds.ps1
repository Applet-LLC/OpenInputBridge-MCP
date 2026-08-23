param([long]$Hwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper3 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
}
"@
[DpiHelper3]::SetProcessDpiAwarenessContext([DpiHelper3]::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) | Out-Null

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$hwnd = [IntPtr]$Hwnd
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$tabItems = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)))
foreach ($t in $tabItems) {
    $r = $t.Current.BoundingRectangle
    $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    Write-Host "TAB: Name=$($t.Current.Name) Bounds=$r IsSelected=$($sel.Current.IsSelected)"
}
