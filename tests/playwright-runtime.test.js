import test from 'node:test';
import assert from 'node:assert/strict';
import { __playwrightRuntimeInternals } from '../src/playwright-runtime.js';

function makePage({ count = 1, visible = true, bodyText = '' } = {}) {
  return {
    locator(selector) {
      if (selector === 'textarea, div[contenteditable="true"], [role="textbox"]') {
        return {
          first() {
            return {
              async count() { return count; },
              async isVisible() { return visible; }
            };
          }
        };
      }
      if (selector === 'body') {
        return {
          async innerText() { return bodyText; }
        };
      }
      throw new Error(`Unexpected selector: ${selector}`);
    }
  };
}

test('detectPromptReadiness treats visible prompt with login controls as guest-ready', async () => {
  const readiness = await __playwrightRuntimeInternals.detectPromptReadiness(makePage({
    count: 1,
    visible: true,
    bodyText: 'ChatGPT 로그인 무료로 회원 가입 무엇이든 물어보세요'
  }));

  assert.deepEqual(readiness, { ready: true, mode: 'guest-ready' });
});

test('detectPromptReadiness returns manual-required when prompt is missing', async () => {
  const readiness = await __playwrightRuntimeInternals.detectPromptReadiness(makePage({
    count: 0,
    visible: false,
    bodyText: 'Cloudflare challenge'
  }));

  assert.deepEqual(readiness, { ready: false, mode: 'manual-required' });
});
