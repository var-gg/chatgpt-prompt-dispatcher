$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeMethods {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$MouseEventLeftDown = 0x0002
$MouseEventLeftUp = 0x0004
$MouseEventRightDown = 0x0008
$MouseEventRightUp = 0x0010
$SwRestore = 9
$SwShow = 5
$SwpNoZOrder = 0x0004
$SwpShowWindow = 0x0040

function New-Success($id, $result) {
  return @{ jsonrpc = '2.0'; id = $id; result = $result }
}

function New-Error($id, $code, $message, $data = $null) {
  $err = @{ code = $code; message = $message }
  if ($null -ne $data) { $err.data = $data }
  return @{ jsonrpc = '2.0'; id = $id; error = $err }
}

function Get-WindowTitle([IntPtr]$hWnd) {
  $len = [NativeMethods]::GetWindowTextLength($hWnd)
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [void][NativeMethods]::GetWindowText($hWnd, $sb, $sb.Capacity)
  return $sb.ToString()
}

function Get-WindowRectObject([IntPtr]$hWnd) {
  $rect = New-Object NativeMethods+RECT
  $ok = [NativeMethods]::GetWindowRect($hWnd, [ref]$rect)
  if (-not $ok) { return $null }
  return @{
    x = $rect.Left
    y = $rect.Top
    width = ($rect.Right - $rect.Left)
    height = ($rect.Bottom - $rect.Top)
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
  }
}

function ConvertTo-Hwnd($value) {
  if ($null -eq $value) { return [IntPtr]::Zero }
  if ($value -is [IntPtr]) { return $value }
  $text = [string]$value
  if ([string]::IsNullOrWhiteSpace($text)) { return [IntPtr]::Zero }
  return [IntPtr]::new([Int64]$text)
}

function Find-Window($params) {
  if ($params.hwnd) {
    $hwnd = ConvertTo-Hwnd $params.hwnd
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    return $hwnd
  }

  $titleHint = [string]$params.titleHint
  $processNames = @('chrome', 'msedge')
  if ($params.processNames) {
    $processNames = @($params.processNames)
  }

  $candidates = @()
  foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
    try {
      if ($processNames.Count -gt 0 -and ($processNames -notcontains $proc.ProcessName.ToLower())) { continue }
      if ($proc.MainWindowHandle -eq 0) { continue }
      $hwnd = [IntPtr]::new($proc.MainWindowHandle)
      if (-not [NativeMethods]::IsWindowVisible($hwnd)) { continue }
      $title = Get-WindowTitle $hwnd
      if ([string]::IsNullOrWhiteSpace($title)) { continue }
      if ($titleHint -and ($title -notlike "*$titleHint*")) { continue }
      $candidates += [pscustomobject]@{ hwnd = $hwnd; title = $title; processName = $proc.ProcessName; pid = $proc.Id }
    } catch {}
  }

  return ($candidates | Select-Object -First 1).hwnd
}

function Get-WindowObject([IntPtr]$hwnd) {
  if ($hwnd -eq [IntPtr]::Zero) { return $null }
  $title = Get-WindowTitle $hwnd
  $rect = Get-WindowRectObject $hwnd
  [uint32]$pid = 0
  [void][NativeMethods]::GetWindowThreadProcessId($hwnd, [ref]$pid)
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  return @{
    hwnd = $hwnd.ToInt64().ToString()
    title = $title
    processId = [int]$pid
    processName = $proc.ProcessName
    rect = $rect
    visible = [NativeMethods]::IsWindowVisible($hwnd)
  }
}

function Invoke-Click($params, $button = 'left', $double = $false) {
  [void][NativeMethods]::SetCursorPos([int]$params.x, [int]$params.y)
  Start-Sleep -Milliseconds ([int]($params.preClickDelayMs ?? 35))
  if ($button -eq 'right') {
    [NativeMethods]::mouse_event($MouseEventRightDown, 0, 0, 0, [UIntPtr]::Zero)
    [NativeMethods]::mouse_event($MouseEventRightUp, 0, 0, 0, [UIntPtr]::Zero)
  } else {
    [NativeMethods]::mouse_event($MouseEventLeftDown, 0, 0, 0, [UIntPtr]::Zero)
    [NativeMethods]::mouse_event($MouseEventLeftUp, 0, 0, 0, [UIntPtr]::Zero)
    if ($double) {
      Start-Sleep -Milliseconds 70
      [NativeMethods]::mouse_event($MouseEventLeftDown, 0, 0, 0, [UIntPtr]::Zero)
      [NativeMethods]::mouse_event($MouseEventLeftUp, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
  return @{ ok = $true; x = [int]$params.x; y = [int]$params.y; button = $button; double = $double }
}

function Get-RoleName($controlType) {
  if ($null -eq $controlType) { return $null }
  try { return $controlType.ProgrammaticName } catch { return $null }
}

function Find-UiaElement($params) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  if ($params.windowHwnd) {
    $hwnd = ConvertTo-Hwnd $params.windowHwnd
    if ($hwnd -ne [IntPtr]::Zero) {
      try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch {}
    }
  }

  $name = [string]$params.name
  $role = [string]$params.role
  $scopeValue = [string]($params.scope ?? 'descendants')
  $scope = [System.Windows.Automation.TreeScope]::Descendants
  if ($scopeValue -eq 'children') { $scope = [System.Windows.Automation.TreeScope]::Children }

  $condition = [System.Windows.Automation.Condition]::TrueCondition
  if ($name) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  }

  $collection = $root.FindAll($scope, $condition)
  foreach ($item in $collection) {
    $itemRole = Get-RoleName $item.Current.ControlType
    if ($role) {
      if (-not $itemRole) { continue }
      if ($itemRole -notlike "*$role*") { continue }
    }
    return $item
  }
  return $null
}

function Wait-Until($timeoutMs, $intervalMs, [scriptblock]$predicate) {
  $start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  while (([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $start) -lt $timeoutMs) {
    $value = & $predicate
    if ($null -ne $value) { return $value }
    Start-Sleep -Milliseconds $intervalMs
  }
  return $null
}

function Handle-Request($req) {
  $id = $req.id
  $params = if ($req.params) { $req.params } else { @{} }
  switch ($req.method) {
    'listChromeWindows' {
      $items = @()
      foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
        try {
          if (@('chrome', 'msedge') -notcontains $proc.ProcessName.ToLower()) { continue }
          if ($proc.MainWindowHandle -eq 0) { continue }
          $hwnd = [IntPtr]::new($proc.MainWindowHandle)
          if (-not [NativeMethods]::IsWindowVisible($hwnd)) { continue }
          $title = Get-WindowTitle $hwnd
          if ([string]::IsNullOrWhiteSpace($title)) { continue }
          $items += Get-WindowObject $hwnd
        } catch {}
      }
      return New-Success $id @{ windows = $items }
    }
    'focusWindow' {
      $hwnd = Find-Window $params
      if ($hwnd -eq [IntPtr]::Zero -or $null -eq $hwnd) { return New-Error $id 'WINDOW_NOT_FOUND' 'Window not found.' }
      [void][NativeMethods]::ShowWindowAsync($hwnd, $SwRestore)
      [void][NativeMethods]::ShowWindowAsync($hwnd, $SwShow)
      $ok = [NativeMethods]::SetForegroundWindow($hwnd)
      if (-not $ok) { return New-Error $id 'FG_LOCKED' 'Failed to bring the target window to the foreground.' @{ hwnd = $hwnd.ToInt64().ToString() } }
      return New-Success $id (Get-WindowObject $hwnd)
    }
    'moveResizeWindow' {
      $hwnd = Find-Window $params
      if ($hwnd -eq [IntPtr]::Zero -or $null -eq $hwnd) { return New-Error $id 'WINDOW_NOT_FOUND' 'Window not found.' }
      $ok = [NativeMethods]::SetWindowPos($hwnd, [IntPtr]::Zero, [int]$params.x, [int]$params.y, [int]$params.width, [int]$params.height, $SwpNoZOrder -bor $SwpShowWindow)
      if (-not $ok) { return New-Error $id 'WINDOW_MOVE_FAILED' 'Failed to move/resize the target window.' }
      return New-Success $id (Get-WindowObject $hwnd)
    }
    'getWindowRect' {
      $hwnd = Find-Window $params
      if ($hwnd -eq [IntPtr]::Zero -or $null -eq $hwnd) { return New-Error $id 'WINDOW_NOT_FOUND' 'Window not found.' }
      return New-Success $id @{ hwnd = $hwnd.ToInt64().ToString(); rect = Get-WindowRectObject $hwnd }
    }
    'getForegroundWindow' {
      $hwnd = [NativeMethods]::GetForegroundWindow()
      if ($hwnd -eq [IntPtr]::Zero) { return New-Error $id 'NO_FOREGROUND_WINDOW' 'No foreground window is available.' }
      return New-Success $id (Get-WindowObject $hwnd)
    }
    'setClipboard' {
      try {
        [System.Windows.Forms.Clipboard]::SetText([string]$params.text)
        return New-Success $id @{ ok = $true }
      } catch {
        return New-Error $id 'CLIPBOARD_FAILED' $_.Exception.Message
      }
    }
    'getClipboard' {
      try {
        $text = if ([System.Windows.Forms.Clipboard]::ContainsText()) { [System.Windows.Forms.Clipboard]::GetText() } else { '' }
        return New-Success $id @{ text = $text }
      } catch {
        return New-Error $id 'CLIPBOARD_FAILED' $_.Exception.Message
      }
    }
    'sendKeys' {
      try {
        [System.Windows.Forms.SendKeys]::SendWait([string]$params.keys)
        return New-Success $id @{ ok = $true; keys = [string]$params.keys }
      } catch {
        return New-Error $id 'UIPI_BLOCKED' $_.Exception.Message
      }
    }
    'click' { return New-Success $id (Invoke-Click $params 'left' $false) }
    'doubleClick' { return New-Success $id (Invoke-Click $params 'left' $true) }
    'rightClick' { return New-Success $id (Invoke-Click $params 'right' $false) }
    'getUrlViaOmnibox' {
      try {
        $saved = if ([System.Windows.Forms.Clipboard]::ContainsText()) { [System.Windows.Forms.Clipboard]::GetText() } else { '' }
        [System.Windows.Forms.SendKeys]::SendWait('^l')
        Start-Sleep -Milliseconds ([int]($params.stepDelayMs ?? 80))
        [System.Windows.Forms.SendKeys]::SendWait('^c')
        Start-Sleep -Milliseconds ([int]($params.stepDelayMs ?? 80))
        $url = if ([System.Windows.Forms.Clipboard]::ContainsText()) { [System.Windows.Forms.Clipboard]::GetText() } else { '' }
        [System.Windows.Forms.Clipboard]::SetText($saved)
        if ([string]::IsNullOrWhiteSpace($url)) { return New-Error $id 'UIA_EMPTY' 'Omnibox copy returned an empty value.' }
        return New-Success $id @{ url = $url }
      } catch {
        return New-Error $id 'CLIPBOARD_FAILED' $_.Exception.Message
      }
    }
    'uiaQueryByNameRole' {
      try {
        $item = Find-UiaElement $params
        if ($null -eq $item) { return New-Error $id 'UIA_EMPTY' 'No matching UI Automation element was found.' }
        return New-Success $id @{ name = $item.Current.Name; role = (Get-RoleName $item.Current.ControlType); automationId = $item.Current.AutomationId }
      } catch {
        return New-Error $id 'UIA_QUERY_FAILED' $_.Exception.Message
      }
    }
    'uiaGetFocusedElement' {
      try {
        $item = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ($null -eq $item) { return New-Error $id 'UIA_EMPTY' 'No focused UI Automation element was found.' }
        return New-Success $id @{ name = $item.Current.Name; role = (Get-RoleName $item.Current.ControlType); automationId = $item.Current.AutomationId }
      } catch {
        return New-Error $id 'UIA_QUERY_FAILED' $_.Exception.Message
      }
    }
    'waitForWindow' {
      $timeoutMs = [int]($params.timeoutMs ?? 5000)
      $intervalMs = [int]($params.intervalMs ?? 150)
      $found = Wait-Until $timeoutMs $intervalMs { Find-Window $params }
      if ($null -eq $found -or $found -eq [IntPtr]::Zero) { return New-Error $id 'WINDOW_NOT_FOUND' 'Window was not found before timeout.' }
      return New-Success $id (Get-WindowObject $found)
    }
    'waitForElement' {
      try {
        $timeoutMs = [int]($params.timeoutMs ?? 5000)
        $intervalMs = [int]($params.intervalMs ?? 150)
        $item = Wait-Until $timeoutMs $intervalMs { Find-UiaElement $params }
        if ($null -eq $item) { return New-Error $id 'UIA_EMPTY' 'Element was not found before timeout.' }
        return New-Success $id @{ name = $item.Current.Name; role = (Get-RoleName $item.Current.ControlType); automationId = $item.Current.AutomationId }
      } catch {
        return New-Error $id 'UIA_QUERY_FAILED' $_.Exception.Message
      }
    }
    default {
      return New-Error $id 'METHOD_NOT_FOUND' "Unknown method: $($req.method)"
    }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $req = $line | ConvertFrom-Json -Depth 20
    $resp = Handle-Request $req
  } catch {
    $resp = New-Error $null 'INVALID_JSON' $_.Exception.Message
  }
  [Console]::Out.WriteLine(($resp | ConvertTo-Json -Compress -Depth 20))
  [Console]::Out.Flush()
}
