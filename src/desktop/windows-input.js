import { getDesktopWorkerClient } from './powershell.js';

function client() {
  return getDesktopWorkerClient();
}

export async function listChromeWindows() {
  const result = await client().call('listChromeWindows', {}, { step: 'desktop-list-chrome-windows', timeoutMs: 8000 });
  return result.windows || [];
}

export async function focusWindowByTitle(titleHint) {
  return client().call('focusWindow', { titleHint }, { step: 'desktop-focus-window', timeoutMs: 8000 });
}

export async function focusWindow(handle) {
  return client().call('focusWindow', { handle }, { step: 'desktop-focus-window', timeoutMs: 8000 });
}

export async function resizeWindow(targetBounds, handle = null) {
  return client().call('moveResizeWindow', { handle, ...targetBounds }, { step: 'desktop-resize-window', timeoutMs: 8000 });
}

export async function getWindowRect(handle) {
  return client().call('getWindowRect', { handle }, { step: 'desktop-get-window-rect', timeoutMs: 5000 });
}

export async function getForegroundWindow() {
  return client().call('getForegroundWindow', {}, { step: 'desktop-get-foreground-window', timeoutMs: 5000 });
}

export async function setClipboardText(text) {
  return client().call('setClipboard', { text }, { step: 'desktop-set-clipboard', timeoutMs: 5000 });
}

export async function getClipboardText() {
  return client().call('getClipboard', {}, { step: 'desktop-get-clipboard', timeoutMs: 5000 });
}

export async function sendKeys(keys, modifiers = []) {
  if (typeof keys === 'string' && !['enter', 'v', 'c', 'l'].includes(keys.toLowerCase()) && modifiers.length === 0) {
    return client().call('sendKeys', { text: keys }, { step: 'desktop-send-keys', timeoutMs: 5000 });
  }
  return client().call('sendKeys', { key: keys, modifiers }, { step: 'desktop-send-keys', timeoutMs: 5000 });
}

export async function pasteClipboard() {
  return sendKeys('v', ['ctrl']);
}

export async function pressEnter() {
  return sendKeys('enter');
}

export async function clickPoint(point) {
  return client().call('click', { x: Math.round(point.x), y: Math.round(point.y) }, { step: 'desktop-click-point', timeoutMs: 5000 });
}

export async function doubleClickPoint(point) {
  return client().call('doubleClick', { x: Math.round(point.x), y: Math.round(point.y) }, { step: 'desktop-double-click-point', timeoutMs: 5000 });
}

export async function rightClickPoint(point) {
  return client().call('rightClick', { x: Math.round(point.x), y: Math.round(point.y) }, { step: 'desktop-right-click-point', timeoutMs: 5000 });
}

export async function getUrlViaOmnibox(target = {}) {
  return client().call('getUrlViaOmnibox', target, { step: 'desktop-get-url-omnibox', timeoutMs: 8000 });
}

export async function uiaQueryByNameRole(target = {}, query = {}) {
  return client().call('uiaQueryByNameRole', { ...target, ...query }, { step: 'desktop-uia-query', timeoutMs: query.timeoutMs || 5000 });
}

export async function uiaGetFocusedElement() {
  return client().call('uiaGetFocusedElement', {}, { step: 'desktop-uia-focused', timeoutMs: 5000 });
}

export async function waitForWindow(target = {}, timeoutMs = 5000) {
  return client().call('waitForWindow', { ...target, timeoutMs }, { step: 'desktop-wait-window', timeoutMs: timeoutMs + 1000 });
}

export async function waitForElement(target = {}, query = {}, timeoutMs = 5000) {
  return client().call('waitForElement', { ...target, ...query, timeoutMs }, { step: 'desktop-wait-element', timeoutMs: timeoutMs + 1000 });
}

export async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
