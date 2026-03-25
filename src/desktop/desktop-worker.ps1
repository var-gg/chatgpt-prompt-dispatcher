param(
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$win32Source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DesktopWorkerWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public int type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public int mouseData;
    public int dwFlags;
    public int time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public short wVk;
    public short wScan;
    public int dwFlags;
    public int time;
    public IntPtr dwExtraInfo;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr GetMessageExtraInfo();
}
'@
Add-Type -TypeDefinition $win32Source

$SW_RESTORE = 9
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$INPUT_MOUSE = 0
$INPUT_KEYBOARD = 1
$KEYEVENTF_KEYUP = 0x0002
$KEYEVENTF_UNICODE = 0x0004
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010

function Write-JsonLine($obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  [Console]::Out.WriteLine($json)
}

function Write-WorkerLog($event) {
  if ([string]::IsNullOrWhiteSpace($LogPath)) { return }
  $payload = @{ ts = [DateTime]::UtcNow.ToString('o') }
  if ($event -is [System.Collections.IDictionary]) {
    foreach ($key in $event.Keys) {
      $payload[$key] = $event[$key]
    }
  } else {
    foreach ($prop in $event.PSObject.Properties) {
      $payload[$prop.Name] = $prop.Value
    }
  }
  $line = $payload | ConvertTo-Json -Depth 10 -Compress
  try {
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($LogPath)) | Out-Null
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 -ErrorAction Stop
  } catch {
    # best-effort logging only; never crash the worker because the log file is locked
  }
}

function New-ErrorResult($code, $message, $data = $null) {
  $err = @{ code = $code; message = $message }
  if ($null -ne $data) { $err.data = $data }
  return [System.Exception]::new(($err | ConvertTo-Json -Depth 10 -Compress))
}

function Find-WindowByHandle([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $null }
  $rect = New-Object DesktopWorkerWin32+RECT
  if (-not [DesktopWorkerWin32]::GetWindowRect($handle, [ref]$rect)) { return $null }
  $titleBuilder = New-Object System.Text.StringBuilder 1024
  [void][DesktopWorkerWin32]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
  $processId = 0
  [void][DesktopWorkerWin32]::GetWindowThreadProcessId($handle, [ref]$processId)
  [pscustomobject]@{
    handle = $handle.ToInt64().ToString()
    title = $titleBuilder.ToString()
    processId = [int]$processId
    rect = @{ x = $rect.Left; y = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top) }
  }
}

function Get-DesktopWindows() {
  $list = New-Object System.Collections.Generic.List[object]
  $callback = [DesktopWorkerWin32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [DesktopWorkerWin32]::IsWindowVisible($hWnd)) { return $true }
    $titleBuilder = New-Object System.Text.StringBuilder 1024
    [void][DesktopWorkerWin32]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
    $title = $titleBuilder.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $processId = 0
    [void][DesktopWorkerWin32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
    try { $proc = Get-Process -Id $processId -ErrorAction Stop } catch { return $true }
    $rect = New-Object DesktopWorkerWin32+RECT
    if (-not [DesktopWorkerWin32]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
    $list.Add([pscustomobject]@{
      handle = $hWnd.ToInt64().ToString()
      title = $title
      processId = [int]$processId
      processName = $proc.ProcessName
      rect = @{ x = $rect.Left; y = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top) }
    }) | Out-Null
    return $true
  }
  [void][DesktopWorkerWin32]::EnumWindows($callback, [IntPtr]::Zero)
  return $list
}

function Resolve-Window($params) {
  if ($params.handle) {
    $value = [Int64]$params.handle
    $window = Find-WindowByHandle([IntPtr]::new($value))
    if ($window) { return $window }
  }
  $all = Get-DesktopWindows
  if ($params.titleHint) {
    $hint = [string]$params.titleHint
    $match = $all | Where-Object { $_.title -like "*$hint*" } | Select-Object -First 1
    if ($match) { return $match }
  }
  if ($params.processName) {
    $name = [string]$params.processName
    $match = $all | Where-Object { $_.processName -ieq $name } | Select-Object -First 1
    if ($match) { return $match }
  }
  return $null
}

function Send-KeyInput($vk, [bool]$keyUp = $false) {
  $input = New-Object DesktopWorkerWin32+INPUT
  $input.type = $INPUT_KEYBOARD
  $ki = New-Object DesktopWorkerWin32+KEYBDINPUT
  $ki.wVk = [int16]$vk
  $ki.wScan = 0
  $ki.dwFlags = if ($keyUp) { $KEYEVENTF_KEYUP } else { 0 }
  $ki.time = 0
  $ki.dwExtraInfo = [DesktopWorkerWin32]::GetMessageExtraInfo()
  $input.U = New-Object DesktopWorkerWin32+InputUnion
  $input.U.ki = $ki
  [void][DesktopWorkerWin32]::SendInput(1, @($input), [System.Runtime.InteropServices.Marshal]::SizeOf([type]'DesktopWorkerWin32+INPUT'))
}

function Send-UnicodeChars([string]$text) {
  foreach ($ch in $text.ToCharArray()) {
    $down = New-Object DesktopWorkerWin32+INPUT
    $down.type = $INPUT_KEYBOARD
    $down.U = New-Object DesktopWorkerWin32+InputUnion
    $down.U.ki = New-Object DesktopWorkerWin32+KEYBDINPUT
    $down.U.ki.wVk = 0
    $down.U.ki.wScan = [int][char]$ch
    $down.U.ki.dwFlags = $KEYEVENTF_UNICODE
    $up = New-Object DesktopWorkerWin32+INPUT
    $up.type = $INPUT_KEYBOARD
    $up.U = New-Object DesktopWorkerWin32+InputUnion
    $up.U.ki = New-Object DesktopWorkerWin32+KEYBDINPUT
    $up.U.ki.wVk = 0
    $up.U.ki.wScan = [int][char]$ch
    $up.U.ki.dwFlags = $KEYEVENTF_UNICODE -bor $KEYEVENTF_KEYUP
    [void][DesktopWorkerWin32]::SendInput(2, @($down, $up), [System.Runtime.InteropServices.Marshal]::SizeOf([type]'DesktopWorkerWin32+INPUT'))
  }
}

function Invoke-Click($x, $y, $button, [int]$count = 1) {
  [void][DesktopWorkerWin32]::SetCursorPos([int]$x, [int]$y)
  Start-Sleep -Milliseconds 40
  for ($i = 0; $i -lt $count; $i++) {
    switch ($button) {
      'right' {
        $downFlag = $MOUSEEVENTF_RIGHTDOWN; $upFlag = $MOUSEEVENTF_RIGHTUP
      }
      default {
        $downFlag = $MOUSEEVENTF_LEFTDOWN; $upFlag = $MOUSEEVENTF_LEFTUP
      }
    }
    $down = New-Object DesktopWorkerWin32+INPUT
    $down.type = $INPUT_MOUSE
    $down.U = New-Object DesktopWorkerWin32+InputUnion
    $down.U.mi = New-Object DesktopWorkerWin32+MOUSEINPUT
    $down.U.mi.dwFlags = $downFlag
    $up = New-Object DesktopWorkerWin32+INPUT
    $up.type = $INPUT_MOUSE
    $up.U = New-Object DesktopWorkerWin32+InputUnion
    $up.U.mi = New-Object DesktopWorkerWin32+MOUSEINPUT
    $up.U.mi.dwFlags = $upFlag
    [void][DesktopWorkerWin32]::SendInput(2, @($down, $up), [System.Runtime.InteropServices.Marshal]::SizeOf([type]'DesktopWorkerWin32+INPUT'))
    Start-Sleep -Milliseconds 60
  }
}

function Get-UiaRootFromWindow($window) {
  if (-not $window) { return $null }
  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]$window.handle))
  } catch {
    return $null
  }
}

function New-UiaCondition($params) {
  $conds = New-Object System.Collections.Generic.List[System.Windows.Automation.Condition]
  if ($params.name) {
    $conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, [string]$params.name))) | Out-Null
  }
  if ($params.role) {
    $ctrlType = [System.Windows.Automation.ControlType]::$($params.role)
    $conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ctrlType))) | Out-Null
  }
  if ($params.automationId) {
    $conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$params.automationId))) | Out-Null
  }
  if ($params.className) {
    $conds.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, [string]$params.className))) | Out-Null
  }
  if ($conds.Count -eq 0) { return [System.Windows.Automation.Condition]::TrueCondition }
  if ($conds.Count -eq 1) { return $conds[0] }
  return New-Object System.Windows.Automation.AndCondition($conds.ToArray())
}

function Find-UiaElement($window, $params, $timeoutMs = 0) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  do {
    $root = Get-UiaRootFromWindow $window
    if ($root) {
      $condition = New-UiaCondition $params
      $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if ($found) { return $found }
    }
    if ($timeoutMs -le 0) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  return $null
}

function Find-UiaByNameRole($window, $name, $role, $timeoutMs = 0) {
  return Find-UiaElement $window @{ name = $name; role = $role } $timeoutMs
}

function Convert-UiaElement($element) {
  if (-not $element) { return $null }
  $rect = $element.Current.BoundingRectangle
  [pscustomobject]@{
    name = $element.Current.Name
    role = $element.Current.ControlType.ProgrammaticName
    controlType = $element.Current.ControlType.LocalizedControlType
    automationId = $element.Current.AutomationId
    className = $element.Current.ClassName
    hasKeyboardFocus = $element.Current.HasKeyboardFocus
    rect = @{ x = [int]$rect.Left; y = [int]$rect.Top; width = [int]$rect.Width; height = [int]$rect.Height }
  }
}

function Build-UiaSnapshot($element, [int]$depth = 2) {
  if (-not $element) { return $null }
  $node = Convert-UiaElement $element
  if ($depth -le 0) { return $node }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $children = New-Object System.Collections.Generic.List[object]
  $child = $walker.GetFirstChild($element)
  $count = 0
  while ($child -and $count -lt 12) {
    $children.Add((Build-UiaSnapshot $child ($depth - 1))) | Out-Null
    $child = $walker.GetNextSibling($child)
    $count++
  }
  $node | Add-Member -NotePropertyName children -NotePropertyValue @($children) -Force
  return $node
}

function Read-UiaText($element) {
  if (-not $element) { return '' }

  $patterns = @(
    [System.Windows.Automation.ValuePattern]::Pattern,
    [System.Windows.Automation.TextPattern]::Pattern,
    [System.Windows.Automation.LegacyIAccessiblePattern]::Pattern
  )

  foreach ($patternId in $patterns) {
    try {
      if ($element.TryGetCurrentPattern($patternId, [ref]$pattern)) {
        if ($pattern -is [System.Windows.Automation.ValuePattern]) {
          return [string]$pattern.Current.Value
        }
        if ($pattern -is [System.Windows.Automation.TextPattern]) {
          return [string]$pattern.DocumentRange.GetText(-1)
        }
        if ($pattern -is [System.Windows.Automation.LegacyIAccessiblePattern]) {
          if ($pattern.Current.Value) { return [string]$pattern.Current.Value }
          if ($pattern.Current.Name) { return [string]$pattern.Current.Name }
        }
      }
    } catch {
      # try next pattern
    }
  }

  return [string]$element.Current.Name
}

function Set-ClipboardTextRobust([string]$text, [int]$attempts = 8) {
  $lastError = $null
  for ($i = 0; $i -lt $attempts; $i++) {
    try {
      [System.Windows.Forms.Clipboard]::SetText($text)
      return
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (80 + ($i * 40))
    }
  }
  throw $lastError
}

function Get-ClipboardTextRobust([int]$attempts = 8) {
  $lastError = $null
  for ($i = 0; $i -lt $attempts; $i++) {
    try {
      if ([System.Windows.Forms.Clipboard]::ContainsText()) { return [System.Windows.Forms.Clipboard]::GetText() }
      return ''
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (80 + ($i * 40))
    }
  }
  if ($lastError) { throw $lastError }
  return ''
}

function Invoke-Method($method, $params) {
  switch ($method) {
    'listChromeWindows' {
      $wins = Get-DesktopWindows | Where-Object { $_.processName -in @('chrome','msedge') }
      return @{ windows = @($wins) }
    }
    'focusWindow' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      [void][DesktopWorkerWin32]::ShowWindow([IntPtr]::new([Int64]$window.handle), $SW_RESTORE)
      $ok = [DesktopWorkerWin32]::SetForegroundWindow([IntPtr]::new([Int64]$window.handle))
      Start-Sleep -Milliseconds 120
      if (-not $ok) { throw (New-ErrorResult 'FG_LOCKED' 'SetForegroundWindow returned false.' @{ handle = $window.handle }) }
      return @{ window = $window }
    }
    'moveResizeWindow' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $ok = [DesktopWorkerWin32]::SetWindowPos([IntPtr]::new([Int64]$window.handle), [IntPtr]::Zero, [int]$params.x, [int]$params.y, [int]$params.width, [int]$params.height, $SWP_NOZORDER)
      if (-not $ok) { throw (New-ErrorResult 'WINDOW_MOVE_FAILED' 'SetWindowPos returned false.') }
      $updated = Resolve-Window @{ handle = $window.handle }
      return @{ window = $updated }
    }
    'getWindowRect' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      return @{ rect = $window.rect; window = $window }
    }
    'getForegroundWindow' {
      $window = Find-WindowByHandle([DesktopWorkerWin32]::GetForegroundWindow())
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Foreground window not found.') }
      return @{ window = $window }
    }
    'setClipboard' {
      Set-ClipboardTextRobust ([string]$params.text)
      return @{ ok = $true }
    }
    'getClipboard' {
      $text = Get-ClipboardTextRobust
      return @{ text = $text }
    }
    'sendKeys' {
      if ($params.text) {
        Send-UnicodeChars([string]$params.text)
      } else {
        $mods = @($params.modifiers)
        foreach ($mod in $mods) {
          switch -Regex ($mod) {
            'ctrl' { Send-KeyInput 0x11 }
            'alt' { Send-KeyInput 0x12 }
            'shift' { Send-KeyInput 0x10 }
            'win' { Send-KeyInput 0x5B }
          }
        }
        switch -Regex ([string]$params.key) {
          '^enter$' { Send-KeyInput 0x0D; Send-KeyInput 0x0D $true }
          '^tab$' { Send-KeyInput 0x09; Send-KeyInput 0x09 $true }
          '^escape$' { Send-KeyInput 0x1B; Send-KeyInput 0x1B $true }
          '^v$' { Send-KeyInput 0x56; Send-KeyInput 0x56 $true }
          '^c$' { Send-KeyInput 0x43; Send-KeyInput 0x43 $true }
          '^l$' { Send-KeyInput 0x4C; Send-KeyInput 0x4C $true }
          '^t$' { Send-KeyInput 0x54; Send-KeyInput 0x54 $true }
          '^a$' { Send-KeyInput 0x41; Send-KeyInput 0x41 $true }
          '^0$' { Send-KeyInput 0x30; Send-KeyInput 0x30 $true }
          default { throw (New-ErrorResult 'UNSUPPORTED_KEY' "Unsupported key: $($params.key)") }
        }
        for ($i = $mods.Count - 1; $i -ge 0; $i--) {
          switch -Regex ($mods[$i]) {
            'ctrl' { Send-KeyInput 0x11 $true }
            'alt' { Send-KeyInput 0x12 $true }
            'shift' { Send-KeyInput 0x10 $true }
            'win' { Send-KeyInput 0x5B $true }
          }
        }
      }
      return @{ ok = $true }
    }
    'click' {
      Invoke-Click $params.x $params.y 'left' 1
      return @{ ok = $true }
    }
    'doubleClick' {
      Invoke-Click $params.x $params.y 'left' 2
      return @{ ok = $true }
    }
    'rightClick' {
      Invoke-Click $params.x $params.y 'right' 1
      return @{ ok = $true }
    }
    'getUrlViaOmnibox' {
      $saved = Get-ClipboardTextRobust
      try {
        if ($params.titleHint -or $params.handle) { [void](Invoke-Method 'focusWindow' $params) }
        [void](Invoke-Method 'sendKeys' @{ key = 'l'; modifiers = @('ctrl') })
        Start-Sleep -Milliseconds 80
        [void](Invoke-Method 'sendKeys' @{ key = 'c'; modifiers = @('ctrl') })
        Start-Sleep -Milliseconds 80
        $text = Get-ClipboardTextRobust
        return @{ url = $text }
      } finally {
        Set-ClipboardTextRobust $saved
      }
    }
    'getCursorPos' {
      $point = New-Object DesktopWorkerWin32+POINT
      [void][DesktopWorkerWin32]::GetCursorPos([ref]$point)
      return @{ point = @{ x = $point.X; y = $point.Y } }
    }
    'uiaElementFromPoint' {
      $pt = New-Object System.Windows.Point([double]$params.x, [double]$params.y)
      $element = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
      if (-not $element) { throw (New-ErrorResult 'UIA_EMPTY' 'No UI Automation element found at the given point.') }
      return @{ element = (Convert-UiaElement $element) }
    }
    'uiaSnapshot' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $depth = if ($null -ne $params.depth) { [int]$params.depth } else { 2 }
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      if (-not $focused) { throw (New-ErrorResult 'UIA_EMPTY' 'No focused UI Automation element found for snapshot.') }
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $parent = $walker.GetParent($focused)
      return @{ tree = [pscustomobject]@{ parent = (Build-UiaSnapshot $parent 1); focused = (Build-UiaSnapshot $focused $depth) } }
    }
    'uiaQueryByNameRole' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $found = Find-UiaByNameRole $window $params.name $params.role ([int]$params.timeoutMs)
      if (-not $found) { throw (New-ErrorResult 'UIA_EMPTY' 'UI Automation query returned no element.') }
      return @{ element = (Convert-UiaElement $found) }
    }
    'uiaQuery' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $found = Find-UiaElement $window $params ([int]$params.timeoutMs)
      if (-not $found) { throw (New-ErrorResult 'UIA_EMPTY' 'UI Automation query returned no element.') }
      return @{ element = (Convert-UiaElement $found) }
    }
    'uiaSetFocus' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $found = Find-UiaElement $window $params ([int]$params.timeoutMs)
      if (-not $found) { throw (New-ErrorResult 'UIA_EMPTY' 'UI Automation query returned no element.') }
      $found.SetFocus()
      Start-Sleep -Milliseconds 120
      return @{ element = (Convert-UiaElement $found); focused = (Convert-UiaElement ([System.Windows.Automation.AutomationElement]::FocusedElement)) }
    }
    'uiaInvoke' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $found = Find-UiaElement $window $params ([int]$params.timeoutMs)
      if (-not $found) { throw (New-ErrorResult 'UIA_EMPTY' 'UI Automation query returned no element.') }
      try {
        $pattern = $found.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
      } catch {
        throw (New-ErrorResult 'UIA_INVOKE_FAILED' 'Failed to invoke UI Automation element.' @{ name = $params.name; automationId = $params.automationId; className = $params.className })
      }
      Start-Sleep -Milliseconds 120
      return @{ element = (Convert-UiaElement $found); focused = (Convert-UiaElement ([System.Windows.Automation.AutomationElement]::FocusedElement)) }
    }
    'uiaGetFocusedElement' {
      try {
        $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      } catch {
        throw (New-ErrorResult 'UIA_EMPTY' 'No focused UI Automation element found.')
      }
      if (-not $focused) { throw (New-ErrorResult 'UIA_EMPTY' 'No focused UI Automation element found.') }
      return @{ element = (Convert-UiaElement $focused) }
    }
    'uiaReadText' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $found = Find-UiaElement $window $params ([int]$params.timeoutMs)
      if (-not $found) { throw (New-ErrorResult 'UIA_EMPTY' 'UI Automation query returned no element.') }
      return @{ element = (Convert-UiaElement $found); text = (Read-UiaText $found) }
    }
    'uiaReadFocusedText' {
      try {
        $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      } catch {
        throw (New-ErrorResult 'UIA_EMPTY' 'No focused UI Automation element found.')
      }
      if (-not $focused) { throw (New-ErrorResult 'UIA_EMPTY' 'No focused UI Automation element found.') }
      return @{ element = (Convert-UiaElement $focused); text = (Read-UiaText $focused) }
    }
    'waitForWindow' {
      $timeoutMs = [int]($params.timeoutMs)
      $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
      do {
        $window = Resolve-Window $params
        if ($window) { return @{ window = $window } }
        Start-Sleep -Milliseconds 100
      } while ([DateTime]::UtcNow -lt $deadline)
      throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Timed out waiting for window.')
    }
    'waitForElement' {
      $window = Resolve-Window $params
      if (-not $window) { throw (New-ErrorResult 'WINDOW_NOT_FOUND' 'Window not found.') }
      $found = Find-UiaByNameRole $window $params.name $params.role ([int]$params.timeoutMs)
      if (-not $found) { throw (New-ErrorResult 'UIA_EMPTY' 'Timed out waiting for element.') }
      return @{ element = (Convert-UiaElement $found) }
    }
    default {
      throw (New-ErrorResult 'METHOD_NOT_FOUND' "Unknown method: $method")
    }
  }
}

Write-WorkerLog @{ event = 'worker-start' }

while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id
    $method = [string]$request.method
    $params = if ($request.PSObject.Properties.Name -contains 'params') { $request.params } else { @{} }
    Write-WorkerLog @{ event = 'request'; id = $id; method = $method }
    $result = Invoke-Method $method $params
    Write-JsonLine @{ jsonrpc = '2.0'; id = $id; result = $result }
    Write-WorkerLog @{ event = 'response'; id = $id; method = $method; ok = $true }
  } catch {
    $id = if ($request) { $request.id } else { $null }
    $payload = $null
    if ($_.Exception.Message -match '^\{') {
      try { $payload = $_.Exception.Message | ConvertFrom-Json } catch { $payload = $null }
    }
    if (-not $payload) {
      $payload = @{ code = 'WORKER_ERROR'; message = $_.Exception.Message }
    }
    Write-JsonLine @{ jsonrpc = '2.0'; id = $id; error = $payload }
    Write-WorkerLog @{ event = 'response'; id = $id; ok = $false; code = $payload.code; message = $payload.message }
  }
}

Write-WorkerLog @{ event = 'worker-stop' }
