import test from 'node:test';
import assert from 'node:assert/strict';
import { StepError } from '../src/errors.js';
import {
  __desktopActionInternals,
  selectDesktopMode,
  startDesktopNewChat
} from '../src/desktop/chatgpt-desktop-actions.js';

function createProfile() {
  return {
    profileName: 'default',
    browser: {
      channel: 'chrome-user-session',
      locale: 'ko-KR'
    },
    chatgpt: {
      mode: 'auto',
      uiTier: 'pro'
    },
    ui: {
      newChat: {
        labels: ['새 채팅']
      },
      modeMenu: {
        entry: {
          labels: ['Pro']
        },
        options: {
          pro: {
            roles: [{ role: 'menuitem', name: 'Pro' }]
          }
        },
        overflow: {}
      }
    }
  };
}

function createCalibration() {
  return {
    window: {
      targetBounds: {
        x: 0,
        y: 0,
        width: 1200,
        height: 800
      }
    },
    anchors: {
      promptInput: { x: 0.5, y: 0.8 },
      submitButton: { x: 0.9, y: 0.8 },
      newChatButton: { x: 0.1, y: 0.1 },
      modeButton: { x: 0.7, y: 0.8 }
    }
  };
}

test('startDesktopNewChat uses UIA activation before coordinate fallback', async () => {
  let clicked = false;
  const result = await startDesktopNewChat({
    handle: 1,
    stepDelayMs: 0,
    calibration: createCalibration(),
    windowBounds: createCalibration().window.targetBounds,
    profile: createProfile(),
    deps: {
      async clickPoint() { clicked = true; },
      async delay() {},
      async pressEnter() {},
      async uiaInvoke(_target, query) {
        if (query.name === '새 채팅') return {};
        throw new Error('not found');
      },
      async uiaQuery() { throw new Error('not needed'); },
      async uiaSetFocus() { throw new Error('not needed'); }
    }
  });

  assert.equal(result.proof, 'newChatActivatedViaUia');
  assert.match(result.method, /uiaInvoke/);
  assert.equal(clicked, false);
});

test('startDesktopNewChat falls back to calibrated coordinate click', async () => {
  let clickPointValue = null;
  const result = await startDesktopNewChat({
    handle: 1,
    stepDelayMs: 0,
    calibration: createCalibration(),
    windowBounds: createCalibration().window.targetBounds,
    profile: createProfile(),
    deps: {
      async clickPoint(point) { clickPointValue = point; },
      async delay() {},
      async pressEnter() {},
      async uiaInvoke() { throw new Error('no invoke'); },
      async uiaQuery() { throw new Error('no query'); },
      async uiaSetFocus() { throw new Error('no focus'); }
    }
  });

  assert.equal(result.proof, 'newChatActivatedViaCoordinateAnchor');
  assert.equal(result.method, 'coordinateClick:newChatButton');
  assert.deepEqual(clickPointValue, { x: 120, y: 80 });
});

test('selectDesktopMode uses focus-enter fallback for menu and option', async () => {
  const focused = [];
  const confirmed = [];
  const result = await selectDesktopMode({
    handle: 1,
    stepDelayMs: 0,
    calibration: createCalibration(),
    windowBounds: createCalibration().window.targetBounds,
    profile: createProfile(),
    modeResolved: 'pro',
    deps: {
      async clickPoint() { throw new Error('coordinate fallback should not run'); },
      async delay() {},
      async pressEnter() {},
      async uiaElementFromPoint() { throw new Error('no scan'); },
      async uiaInvoke() { throw new Error('invoke unavailable'); },
      async uiaQuery(_target, query) {
        confirmed.push(query);
        if (query.automationId === 'prompt-textarea') {
          return { element: { rect: { x: 400, y: 500, width: 500, height: 40 } } };
        }
        if (query.name === 'Pro 확장 모드') {
          throw new Error('not selected yet');
        }
        if (query.name === 'Pro') return { element: { name: 'Pro' } };
        throw new Error('not confirmed');
      },
      async uiaSetFocus(_target, query) {
        focused.push(query);
        if (query.name === 'Pro') return { element: { name: 'Pro' } };
        throw new Error('not found');
      }
    }
  });

  assert.equal(result.confirmed, true);
  assert.equal(focused.length >= 2, true);
  assert.equal(confirmed.length >= 1, true);
  assert.match(result.method, /focusEnter/);
  assert.equal(result.proof, 'modeActivatedAndConfirmed');
});

test('selectDesktopMode skips when the composer pill already indicates Pro', async () => {
  const result = await selectDesktopMode({
    handle: 1,
    stepDelayMs: 0,
    calibration: createCalibration(),
    windowBounds: createCalibration().window.targetBounds,
    profile: createProfile(),
    modeResolved: 'pro',
    deps: {
      async clickPoint() { throw new Error('should not click when already selected'); },
      async delay() {},
      async pressEnter() { throw new Error('should not press enter when already selected'); },
      async uiaInvoke() { throw new Error('should not invoke when already selected'); },
      async uiaQuery(_target, query) {
        if (query.automationId === 'prompt-textarea') {
          return { element: { rect: { x: 472, y: 877, width: 584, height: 33 } } };
        }
        throw new Error('not used');
      },
      async uiaSetFocus() { throw new Error('should not focus when already selected'); },
      async uiaElementFromPoint() {
        return {
          element: {
            name: 'Pro 확장 모드',
            role: 'ControlType.Button',
            className: '__composer-pill group/pill',
            rect: { x: 493, y: 909, width: 122, height: 30 }
          }
        };
      }
    }
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.proof, 'modeSelectionSkippedAlreadySelected');
  assert.match(result.method, /composerModeControl/);
});

test('selectDesktopMode clicks queried option when invoke and focus fail', async () => {
  const clicks = [];
  const result = await selectDesktopMode({
    handle: 1,
    stepDelayMs: 0,
    calibration: createCalibration(),
    windowBounds: createCalibration().window.targetBounds,
    profile: createProfile(),
    modeResolved: 'pro',
    deps: {
      async clickPoint(point) { clicks.push(point); },
      async delay() {},
      async pressEnter() {},
      async uiaElementFromPoint() {
        return {
          element: {
            name: '최신 모드',
            role: 'ControlType.Button',
            className: '__composer-pill group/pill',
            rect: { x: 493, y: 909, width: 122, height: 30 }
          }
        };
      },
      async uiaInvoke() { throw new Error('invoke unavailable'); },
      async uiaQuery(_target, query) {
        if (query.automationId === 'prompt-textarea') {
          return { element: { rect: { x: 472, y: 877, width: 584, height: 33 } } };
        }
        if (query.name === 'Pro 확장 모드') {
          throw new Error('not selected yet');
        }
        if (query.name === 'Pro') {
          return { element: { name: 'Pro', rect: { x: 560, y: 760, width: 120, height: 28 } } };
        }
        throw new Error('not found');
      },
      async uiaSetFocus() { throw new Error('focus unavailable'); }
    }
  });

  assert.equal(clicks.length >= 2, true);
  assert.match(result.method, /uiaQueryClick/);
  assert.equal(result.proof, 'modeActivatedAndConfirmed');
});

test('selectDesktopMode fails when option activation is unavailable', async () => {
  await assert.rejects(async () => {
    await selectDesktopMode({
      handle: 1,
      stepDelayMs: 0,
      calibration: createCalibration(),
      windowBounds: createCalibration().window.targetBounds,
      profile: createProfile(),
      modeResolved: 'pro',
      deps: {
        async clickPoint() {},
        async delay() {},
        async pressEnter() {},
        async uiaElementFromPoint() { throw new Error('no scan'); },
        async uiaInvoke() { throw new Error('no invoke'); },
        async uiaQuery(_target, query) {
          if (query.automationId === 'prompt-textarea') {
            return { element: { rect: { x: 472, y: 877, width: 584, height: 33 } } };
          }
          throw new Error('no query');
        },
        async uiaSetFocus() { throw new Error('no focus'); }
      }
    });
  }, (error) => {
    assert.equal(error instanceof StepError, true);
    assert.equal(error.code, 'MODE_SELECTION_FAILED');
    return true;
  });
});

test('locateModeControlFromComposer finds a button near the composer', async () => {
  const result = await __desktopActionInternals.locateModeControlFromComposer(1, 'pro', {
    async uiaQuery() {
      return { element: { rect: { x: 472, y: 877, width: 584, height: 33 } } };
    },
    async uiaElementFromPoint(x, y) {
      if (x === 574 && y === 918) {
        return {
          element: {
            name: 'Pro 확장 모드',
            role: 'ControlType.Button',
            className: '__composer-pill group/pill',
            rect: { x: 493, y: 909, width: 122, height: 30 }
          }
        };
      }
      return {
        element: {
          name: '',
          role: 'ControlType.Group',
          className: '',
          rect: { x: 0, y: 0, width: 0, height: 0 }
        }
      };
    }
  });

  assert.equal(result.matchesRequestedMode, true);
  assert.equal(result.clickPoint.x, 554);
  assert.equal(result.clickPoint.y, 924);
});
