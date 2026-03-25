import { execPowerShell } from './powershell.js';

function q(value) {
  return String(value).replace(/'/g, "''");
}

export async function focusWindowByTitle(titleHint) {
  const script = `Add-Type -AssemblyName Microsoft.VisualBasic; Add-Type -AssemblyName System.Windows.Forms; $ws = New-Object -ComObject WScript.Shell; $null = $ws.AppActivate('${q(titleHint)}'); Start-Sleep -Milliseconds 150; Write-Output '{"ok":true}'`;
  return execPowerShell(script, { step: 'desktop-focus-window', json: true });
}

export async function setClipboardText(text) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText(@'\n${text}\n'@); Write-Output '{"ok":true}'`;
  return execPowerShell(script, { step: 'desktop-set-clipboard', json: true });
}

export async function sendKeys(keys) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${q(keys)}'); Write-Output '{"ok":true}'`;
  return execPowerShell(script, { step: 'desktop-send-keys', json: true });
}

export async function pasteClipboard() {
  return sendKeys('^v');
}

export async function pressEnter() {
  return sendKeys('~');
}

export async function resizeWindow(targetBounds) {
  const script = `$sig = @'
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
'@; Add-Type $sig; $h = [Win32]::GetForegroundWindow(); [Win32]::MoveWindow($h, ${Math.round(targetBounds.x)}, ${Math.round(targetBounds.y)}, ${Math.round(targetBounds.width)}, ${Math.round(targetBounds.height)}, $true) | Out-Null; Write-Output '{"ok":true}'`;
  return execPowerShell(script, { step: 'desktop-resize-window', json: true });
}

export async function clickPoint(point) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(point.x)}, ${Math.round(point.y)}); Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll", CharSet=CharSet.Auto, CallingConvention=CallingConvention.StdCall)]
  public static extern void mouse_event(long dwFlags, long dx, long dy, long cButtons, long dwExtraInfo);
}
'@; [Mouse]::mouse_event(0x0002,0,0,0,0); [Mouse]::mouse_event(0x0004,0,0,0,0); Write-Output '{"ok":true}'`;
  return execPowerShell(script, { step: 'desktop-click-point', json: true });
}

export async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
