import { getDesktopWorkerClient } from './worker-client.js';

async function invokeDesktop(method, params, step) {
  const client = await getDesktopWorkerClient();
  return client.invoke(method, params, { step });
}

export async function listChromeWindows() {
  return invokeDesktop('listChromeWindows', {}, 'desktop-list-chrome-windows');
}

export async function focusWindowByTitle(titleHint) {
  return invokeDesktop('focusWindow', { titleHint }, 'desktop-focus-window');
}

export async function focusWindow(params) {
  return invokeDesktop('focusWindow', params, 'desktop-focus-window');
}

export async function moveResizeWindow(params) {
  return invokeDesktop('moveResizeWindow', params, 'desktop-move-resize-window');
}

export async function getWindowRect(params) {
  return invokeDesktop('getWindowRect', params, 'desktop-get-window-rect');
}

export async function getForegroundWindow() {
  return invokeDesktop('getForegroundWindow', {}, 'desktop-get-foreground-window');
}

export async function setClipboardText(text) {
  return invokeDesktop('setClipboard', { text }, 'desktop-set-clipboard');
}

export async function getClipboardText() {
  return invokeDesktop('getClipboard', {}, 'desktop-get-clipboard');
}

export async function sendKeys(keys) {
  return invokeDesktop('sendKeys', { keys }, 'desktop-send-keys');
}

export async function pasteClipboard() {
  return sendKeys('^v');
}

export async function pressEnter() {
  return sendKeys('~');
}

export async function resizeWindow(targetBounds) {
  const foreground = await getForegroundWindow();
  return moveResizeWindow({ hwnd: foreground.hwnd, ...targetBounds });
}

export async function clickPoint(point) {
  return invokeDesktop('click', { x: Math.round(point.x), y: Math.round(point.y) }, 'desktop-click-point');
}

export async function doubleClickPoint(point) {
  return invokeDesktop('doubleClick', { x: Math.round(point.x), y: Math.round(point.y) }, 'desktop-double-click-point');
}

export async function rightClickPoint(point) {
  return invokeDesktop('rightClick', { x: Math.round(point.x), y: Math.round(point.y) }, 'desktop-right-click-point');
}

export async function getUrlViaOmnibox(params = {}) {
  return invokeDesktop('getUrlViaOmnibox', params, 'desktop-get-url-via-omnibox');
}

export async function uiaQueryByNameRole(params) {
  return invokeDesktop('uiaQueryByNameRole', params, 'desktop-uia-query-by-name-role');
}

export async function uiaGetFocusedElement() {
  return invokeDesktop('uiaGetFocusedElement', {}, 'desktop-uia-get-focused-element');
}

export async function waitForWindow(params) {
  return invokeDesktop('waitForWindow', params, 'desktop-wait-for-window');
}

export async function waitForElement(params) {
  return invokeDesktop('waitForElement', params, 'desktop-wait-for-element');
}

export async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
