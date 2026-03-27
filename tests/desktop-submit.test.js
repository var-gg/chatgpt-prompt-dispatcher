import test from 'node:test';
import assert from 'node:assert/strict';
import { StepError } from '../src/errors.js';
import { __desktopSubmitInternals } from '../src/desktop/submit-desktop-chatgpt.js';

const {
  isLikelyOmniboxElement,
  ensurePromptTargetLooksCredible,
  looksLikeComposerElement,
  looksLikePromptEcho,
  buildCoordinateInsertionProof,
  buildPromptMarkers,
  looksLikeComposerPlaceholderText,
  looksLikeVisualComposerPlaceholder,
  normalizePromptForSubmission,
  normalizeMarkerText,
  isLongPrompt,
  shouldTrustFocusSafeHashProof,
  hasCredibleComposerFocus,
  shouldTrustValidatedPromptForSubmit,
  shouldReprimePromptBeforeSubmit,
  assessComposerVisualPromptEvidence,
  computeComposerCropRect,
  countPromptMarkers,
  deriveSubmitProof,
  hasVisibleSendStateTransition,
  buildSubmitAttemptOrder,
  shouldUseFastEnterSubmitPath,
  shouldUseTypedInsertFallback,
  shouldAttemptValueSetInsert,
  shouldUseChunkedClipboardInsert,
  shouldUseChunkedTypedInsert,
  splitPromptIntoChunks,
  looksLikeStopButton,
  hashText,
  normalizeAddressValue,
  isChatGptHomeUrl,
  extractChatGptConversationId,
  isChatGptConversationUrl,
  extractConversationUrlFromOcrText,
  assessStrictPreSubmitSurface,
  assessStrictPostSubmitEvidence,
  pickOpenedBrowserWindow,
  resolveDesktopScreenshotPath,
  resolveStrictBaselineScreenshotPath,
  isRectClose,
  classifyDesktopFailure,
  phaseForDesktopStep,
  isSoftRecoveryEligible
} = __desktopSubmitInternals;

test('isLikelyOmniboxElement rejects Chrome address bar candidates', () => {
  assert.equal(isLikelyOmniboxElement({
    name: '주소창 및 검색창',
    role: 'ControlType.Edit',
    automationId: 'view_1012',
    className: 'OmniboxViewViews'
  }), true);

  assert.equal(isLikelyOmniboxElement({
    name: 'Message ChatGPT',
    role: 'ControlType.Document',
    automationId: 'prompt-textarea',
    className: 'ProseMirror'
  }), false);
});

test('ensurePromptTargetLooksCredible fails when validation drifted into omnibox', () => {
  assert.throws(() => ensurePromptTargetLooksCredible({
    promptFocus: {
      element: {
        name: '주소창 및 검색창',
        role: 'ControlType.Edit',
        automationId: 'view_1012',
        className: 'OmniboxViewViews'
      }
    },
    focusedElement: {
      name: 'auto-trader-bot - Chrome',
      role: 'ControlType.Document',
      automationId: 'RootWebArea'
    },
    currentUrlAfterValidation: '안녕',
    prompt: '안녕',
    actualHash: hashText('안녕')
  }), (error) => {
    assert.equal(error instanceof StepError, true);
    assert.equal(error.code, 'PROMPT_TARGET_INVALID');
    return true;
  });
});

test('looksLikeComposerElement detects the ChatGPT composer', () => {
  assert.equal(looksLikeComposerElement({
    name: 'Message ChatGPT',
    role: 'ControlType.Document',
    automationId: 'prompt-textarea',
    className: 'ProseMirror'
  }), true);

  assert.equal(looksLikeComposerElement({
    name: 'ChatGPT',
    role: 'ControlType.Document',
    automationId: 'RootWebArea'
  }), false);
});

test('ensurePromptTargetLooksCredible accepts chatgpt URL with composer focus', () => {
  assert.doesNotThrow(() => ensurePromptTargetLooksCredible({
    promptFocus: {
      element: {
        name: 'Message ChatGPT',
        role: 'ControlType.Document',
        automationId: 'prompt-textarea',
        className: 'ProseMirror'
      }
    },
    focusedElement: {
      name: 'Message ChatGPT',
      role: 'ControlType.Document',
      automationId: 'prompt-textarea',
      className: 'ProseMirror-focused'
    },
    currentUrlAfterValidation: 'https://chatgpt.com/c/abc',
    prompt: '안녕',
    actualHash: hashText('안녕')
  }));
});

test('ensurePromptTargetLooksCredible tolerates stale omnibox prompt echo when composer focus is valid', () => {
  assert.doesNotThrow(() => ensurePromptTargetLooksCredible({
    promptFocus: {
      element: {
        name: '무엇이든 물어보세요 프롬프트',
        role: 'ControlType.Edit',
        automationId: 'prompt-textarea',
        className: 'ProseMirror'
      }
    },
    focusedElement: {
      name: '무엇이든 물어보세요 프롬프트',
      role: 'ControlType.Edit',
      automationId: 'prompt-textarea',
      className: 'ProseMirror ProseMirror-focused'
    },
    currentUrlAfterValidation: 'desktop live proof 2026-03-25 19:25',
    prompt: 'desktop live proof 2026-03-25 19:25',
    actualHash: hashText('desktop live proof 2026-03-25 19:25')
  }));
});

test('looksLikePromptEcho detects non-url omnibox echoes of the prompt', () => {
  assert.equal(looksLikePromptEcho('desktop live proof 2026-03-25 19:25', 'desktop live proof 2026-03-25 19:25'), true);
  assert.equal(looksLikePromptEcho('https://chatgpt.com/', 'desktop live proof 2026-03-25 19:25'), false);
});

test('hasVisibleSendStateTransition requires a real idle-to-send UI change', () => {
  assert.equal(hasVisibleSendStateTransition(
    { sendable: false, stopVisible: false, submitSignature: '' },
    { sendable: true, stopVisible: false, submitSignature: '{"name":"Send"}' }
  ), true);

  assert.equal(hasVisibleSendStateTransition(
    { sendable: true, stopVisible: false, submitSignature: '{"name":"Send"}' },
    { sendable: true, stopVisible: false, submitSignature: '{"name":"Send"}' }
  ), false);
});

test('buildSubmitAttemptOrder prefers practical enter fallback when send button is not proven', () => {
  assert.deepEqual(buildSubmitAttemptOrder('click', null), ['enter', 'click']);
  assert.deepEqual(buildSubmitAttemptOrder('click', { name: 'Send', isEnabled: true }), ['click', 'enter']);
  assert.deepEqual(buildSubmitAttemptOrder('enter', { name: 'Send', isEnabled: true }), ['click', 'enter']);
});

test('deriveSubmitProof prefers strong post-submit UI signals', () => {
  assert.equal(deriveSubmitProof(
    { composerText: 'hello', submitButton: { name: 'Send' }, stopButton: null },
    { composerText: 'hello', submitButton: { name: 'Stop' }, stopButton: { name: 'Stop' } },
    'hello'
  ), 'stopButtonAppeared');

  assert.equal(deriveSubmitProof(
    { composerText: 'hello', submitButton: { name: 'Send' }, stopButton: null },
    { composerText: '', submitButton: { name: 'Send' }, stopButton: null },
    'hello'
  ), 'composerClearedOrPromptGoneAfterSubmit');

  assert.equal(deriveSubmitProof(
    { composerText: 'hello', submitButton: { name: 'Send', isEnabled: true }, stopButton: null },
    { composerText: 'hello', submitButton: { name: 'Send', isEnabled: false }, stopButton: null },
    'hello'
  ), 'submitButtonStateChanged');
});

test('looksLikeStopButton distinguishes streaming stop state from send state', () => {
  assert.equal(looksLikeStopButton({
    name: '응답 중지',
    automationId: 'composer-submit-button',
    className: 'composer-submit-btn'
  }), true);

  assert.equal(looksLikeStopButton({
    name: '프롬프트 보내기',
    automationId: 'composer-submit-button',
    className: 'composer-submit-btn'
  }), false);
});

test('buildCoordinateInsertionProof accepts composer proof even when clipboard roundtrip drifts', () => {
  const result = buildCoordinateInsertionProof({
    prompt: '2026년 4월 나스닥 전망에 대해 분석',
    composerText: '2026년 4월 나스닥 전망에 대해 분석',
    copiedText: '',
    composerElement: { automationId: 'prompt-textarea' },
    focusedElement: { automationId: 'prompt-textarea' }
  });

  assert.equal(result.method, 'coordinate-click+clipboard-paste+composer-proof');
  assert.equal(result.proof, 'coordinateComposerProofContainsPrompt');
  assert.equal(result.actualHash, hashText('2026년 4월 나스닥 전망에 대해 분석'));
});

test('buildCoordinateInsertionProof degrades instead of failing hard when coordinate roundtrip is unconfirmed', () => {
  const result = buildCoordinateInsertionProof({
    prompt: 'desktop install dry-run',
    composerText: '',
    copiedText: 'Message ChatGPT',
    composerElement: { automationId: 'prompt-textarea' },
    focusedElement: { automationId: 'prompt-textarea' }
  });

  assert.equal(result.method, 'coordinate-click+clipboard-paste+degraded-proof');
  assert.equal(result.proof, 'coordinateClipboardRoundtripUnconfirmed');
  assert.equal(result.actualHash, hashText('Message ChatGPT'));
});

test('isLongPrompt prefers the dedicated fast path for multiline or large prompts', () => {
  assert.equal(isLongPrompt('짧은 요청'), false);
  assert.equal(isLongPrompt('line1\nline2'), true);
  assert.equal(isLongPrompt('x'.repeat(900)), true);
});

test('shouldAttemptValueSetInsert stays enabled for long prompts before clipboard fallback', () => {
  assert.equal(shouldAttemptValueSetInsert('짧은 요청'), true);
  assert.equal(shouldAttemptValueSetInsert('x'.repeat(1500)), true);
  assert.equal(shouldAttemptValueSetInsert('   '), false);
});

test('shouldUseChunkedClipboardInsert only activates for genuinely large multiline prompts', () => {
  assert.equal(shouldUseChunkedClipboardInsert('짧은 요청'), false);
  assert.equal(shouldUseChunkedClipboardInsert('줄1\n줄2\n줄3'), false);
  assert.equal(shouldUseChunkedClipboardInsert('x'.repeat(950)), true);
  assert.equal(shouldUseChunkedClipboardInsert(Array.from({ length: 24 }, (_, index) => `줄 ${index + 1}`).join('\n')), true);
  assert.equal(shouldUseChunkedTypedInsert('x'.repeat(950)), true);
});

test('splitPromptIntoChunks preserves content while respecting the requested chunk size', () => {
  const prompt = '가나다라마바사아자차카타파하'.repeat(20);
  const chunks = splitPromptIntoChunks(prompt, 25);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 25));
  assert.equal(chunks.join(''), prompt);
});

test('looksLikeComposerPlaceholderText rejects composer labels as real prompt text', () => {
  assert.equal(looksLikeComposerPlaceholderText('ChatGPT와 채팅', {
    name: 'ChatGPT와 채팅'
  }), true);

  assert.equal(looksLikeComposerPlaceholderText('2026년 4월 나스닥 전망에 대해 분석', {
    name: 'ChatGPT와 채팅'
  }), false);
});

test('normalizePromptForSubmission trims trailing file newline without stripping leading intent', () => {
  assert.equal(
    normalizePromptForSubmission('  line1\nline2\r\n'),
    '  line1\nline2'
  );
});

test('shouldTrustValidatedPromptForSubmit allows submit without button discovery once prompt hash is locked', () => {
  const promptFocus = {
    focusedElement: {
      automationId: 'prompt-textarea',
      className: 'ProseMirror'
    }
  };

  assert.equal(hasCredibleComposerFocus(promptFocus), true);
  assert.equal(shouldTrustValidatedPromptForSubmit(true, promptFocus), true);
  assert.equal(shouldTrustValidatedPromptForSubmit(false, promptFocus), false);
  assert.equal(shouldTrustValidatedPromptForSubmit({
    validationLevel: 'visual'
  }, promptFocus), true);
  assert.equal(shouldTrustValidatedPromptForSubmit({
    validationLevel: 'none',
    submitAllowed: true
  }, promptFocus), true);
});

test('shouldTrustFocusSafeHashProof rejects value-only insertion but accepts roundtrip-backed proof', () => {
  assert.equal(shouldTrustFocusSafeHashProof({
    method: 'uia-focus+value-set+submit-attempt-ready',
    proof: 'uia-focus+value-set+composerTextPending',
    visibleSendStateProven: false,
    afterSubmitState: { sendable: true }
  }), false);

  assert.equal(shouldTrustFocusSafeHashProof({
    method: 'uia-focus+slow-clipboard-roundtrip+submit-attempt-ready',
    proof: 'recoveredBySlowClipboardRoundtrip',
    visibleSendStateProven: false,
    afterSubmitState: { sendable: false }
  }), false);

  assert.equal(shouldTrustFocusSafeHashProof({
    method: 'uia-focus+slow-clipboard-roundtrip+submit-attempt-ready',
    proof: 'recoveredBySlowClipboardRoundtrip',
    visibleSendStateProven: false,
    afterSubmitState: { sendable: true }
  }), true);
});

test('shouldReprimePromptBeforeSubmit forces a fresh paste after clipboard-based validation', () => {
  assert.equal(shouldReprimePromptBeforeSubmit(
    {
      method: 'uia-focus+slow-clipboard-paste+slow-clipboard-roundtrip-recovery',
      proof: 'recoveredBySlowClipboardRoundtrip'
    },
    { proof: 'validatedInputTrustedAndComposerCredible' },
    { submitButton: null }
  ), true);

  assert.equal(shouldReprimePromptBeforeSubmit(
    {
      method: 'uia-focus+value-set+light-composer-present-proof',
      proof: 'promptPresentComposerCredible'
    },
    { proof: 'validatedInputTrustedAndComposerCredible' },
    { submitButton: { name: 'Send', isEnabled: true } }
  ), false);

  assert.equal(shouldReprimePromptBeforeSubmit(
    {
      method: 'coordinate-click+clipboard-paste+composer-visual-proof',
      proof: 'composerVisualMarkersMatched',
      validationLevel: 'visual'
    },
    { proof: 'validatedInputTrustedAndComposerCredible' },
    { submitButton: null }
  ), false);

  assert.equal(shouldReprimePromptBeforeSubmit(
    {
      method: 'coordinate-click+clipboard-paste+bounded-visible-recovery',
      proof: 'visibleSendableRecoveryHint',
      validationLevel: 'none',
      submitAllowed: true
    },
    { proof: 'validatedInputTrustedAndComposerCredible' },
    { submitButton: null }
  ), false);
});

test('shouldUseFastEnterSubmitPath enables short post-submit wait for validated enter fallback', () => {
  assert.equal(shouldUseFastEnterSubmitPath(
    'enter',
    { proof: 'validatedInputTrustedAndComposerCredible' },
    { submitButton: null }
  ), true);

  assert.equal(shouldUseFastEnterSubmitPath(
    'click',
    { proof: 'validatedInputTrustedAndComposerCredible' },
    { submitButton: null }
  ), false);
});

test('shouldUseTypedInsertFallback only opens when the clipboard paste looks like a real no-op', () => {
  assert.equal(shouldUseTypedInsertFallback({
    prompt: '짧은 live check',
    promptProof: {
      text: 'ChatGPT와 채팅',
      element: { automationId: 'prompt-textarea', className: 'ProseMirror' },
      focusedElement: { automationId: 'prompt-textarea', className: 'ProseMirror-focused' }
    },
    visibleProof: {
      ok: false,
      submitState: { sendable: false }
    },
    visualProof: {
      ok: false,
      proof: 'composerVisualUnchanged'
    },
    composerTarget: { automationId: 'prompt-textarea', className: 'ProseMirror-focused' },
    promptFocus: { element: { automationId: 'prompt-textarea', className: 'ProseMirror' } }
  }), true);

  assert.equal(shouldUseTypedInsertFallback({
    prompt: '짧은 live check',
    promptProof: {
      text: '',
      element: { automationId: 'prompt-textarea', className: 'ProseMirror' },
      focusedElement: { automationId: 'prompt-textarea', className: 'ProseMirror-focused' }
    },
    visibleProof: {
      ok: false,
      submitState: { sendable: false }
    },
    visualProof: {
      ok: true,
      proof: 'composerVisualMarkersMatched'
    },
    composerTarget: { automationId: 'prompt-textarea', className: 'ProseMirror-focused' },
    promptFocus: { element: { automationId: 'prompt-textarea', className: 'ProseMirror' } }
  }), false);
});

test('buildPromptMarkers and marker counting prefer long-prompt anchors over full exact OCR', () => {
  const prompt = [
    '첫 줄 요약: 2026년 4월 나스닥 전망과 금리 이벤트를 함께 분석해줘.',
    '중간 본문: 금리, AI 밸류에이션, 매크로 이벤트를 반드시 포함해.',
    '마지막 줄 토큰: NASDAQ-LONG-END-202604'
  ].join('\n');
  const markerSpec = buildPromptMarkers(prompt);
  const ocrText = normalizeMarkerText('첫 줄 요약: 2026년 4월 나스닥 전망과 금리 이벤트를 함께 분석해줘. 마지막 줄 토큰: nasdaq-long-end-202604');

  assert.equal(markerSpec.requiredMatches, 2);
  assert.equal(countPromptMarkers(ocrText, markerSpec.markers) >= 2, true);
});

test('buildPromptMarkers uses a tolerant prefix anchor for short single-line prompts', () => {
  const prompt = 'LIVE TYPE FALLBACK 2026-03-27T10:19:00+09:00';
  const markerSpec = buildPromptMarkers(prompt);

  assert.equal(markerSpec.requiredMatches, 1);
  assert.equal(markerSpec.markers[0], normalizeMarkerText(prompt).slice(0, 32));
  assert.equal(
    countPromptMarkers('live type fallback 2026-03-27t10', markerSpec.markers),
    1
  );
});

test('looksLikeVisualComposerPlaceholder treats bare placeholder OCR as non-proof', () => {
  assert.equal(looksLikeVisualComposerPlaceholder('ChatGPT와 채팅'), true);
  assert.equal(looksLikeVisualComposerPlaceholder('Message ChatGPT'), true);
  assert.equal(looksLikeVisualComposerPlaceholder('실제 프롬프트 한 줄'), false);
});

test('assessComposerVisualPromptEvidence accepts marker matches and rejects unchanged placeholder states', () => {
  const prompt = '첫 줄 요약: 2026년 4월 나스닥 전망\n중간 줄: 금리 이벤트 반영\nLONG-END-TOKEN-202604-VERIFY';
  assert.deepEqual(
    assessComposerVisualPromptEvidence({
      prompt,
      composerOcrTextSample: '첫 줄 요약: 2026년 4월 나스닥 전망 LONG-END-TOKEN-202604-VERIFY',
      normalizedOcrText: normalizeMarkerText('첫 줄 요약: 2026년 4월 나스닥 전망 LONG-END-TOKEN-202604-VERIFY'),
      baselineHash: 'before',
      composerHash: 'after',
      focusCredible: true
    }),
    {
      ok: true,
      proof: 'composerVisualMarkersMatched',
      validationLevel: 'visual',
      markersMatched: 2,
      requiredMatches: 2
    }
  );

  assert.deepEqual(
    assessComposerVisualPromptEvidence({
      prompt,
      composerOcrTextSample: 'ChatGPT와 채팅',
      normalizedOcrText: normalizeMarkerText('ChatGPT와 채팅'),
      baselineHash: 'same',
      composerHash: 'same',
      focusCredible: true
    }),
    {
      ok: false,
      proof: 'composerVisualStillPlaceholder',
      validationLevel: 'none',
      markersMatched: 0,
      requiredMatches: 2
    }
  );
});

test('assessComposerVisualPromptEvidence allows changed non-placeholder composer crop even with weak OCR', () => {
  const result = assessComposerVisualPromptEvidence({
    prompt: '첫 줄\n중간 줄\n마지막 줄 토큰 202604',
    composerOcrTextSample: '중간 줄 일부만 OCR 됨',
    normalizedOcrText: normalizeMarkerText('중간 줄 일부만 OCR 됨'),
    baselineHash: 'before',
    composerHash: 'after',
    focusCredible: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.proof, 'composerVisualChangedWithoutPlaceholder');
  assert.equal(result.validationLevel, 'visual');
});

test('computeComposerCropRect clamps the crop within the current window bounds', () => {
  assert.deepEqual(
    computeComposerCropRect(
      { x: 100, y: 80, width: 800, height: 600 },
      { x: 120, y: 500, width: 500, height: 33 }
    ),
    { x: 0, y: 400, width: 548, height: 200 }
  );
});

test('normalizeAddressValue canonicalizes chatgpt URLs for omnibox verification', () => {
  assert.equal(normalizeAddressValue('https://chatgpt.com'), normalizeAddressValue('https://chatgpt.com'));
  assert.equal(normalizeAddressValue('HTTPS://CHATGPT.COM///'), normalizeAddressValue('https://chatgpt.com/'));
  assert.equal(normalizeAddressValue(' https://chatgpt.com/c/abc/ '), normalizeAddressValue('https://chatgpt.com/c/abc/'));
});

test('conversation URL helpers distinguish ChatGPT home and dedicated conversations', () => {
  assert.equal(isChatGptHomeUrl('https://chatgpt.com/'), true);
  assert.equal(isChatGptHomeUrl('https://chatgpt.com/?model=auto'), true);
  assert.equal(isChatGptHomeUrl('https://chatgpt.com/c/abc123'), false);

  assert.equal(extractChatGptConversationId('https://chatgpt.com/c/abc123'), 'abc123');
  assert.equal(extractChatGptConversationId('https://chatgpt.com/'), '');
  assert.equal(isChatGptConversationUrl('https://chatgpt.com/c/abc123'), true);
  assert.equal(isChatGptConversationUrl('https://chatgpt.com/'), false);
  assert.equal(
    extractConversationUrlFromOcrText('chatgpt.com/c/69C4e978-Of8c-83aa-b960-c52f68f88897 some more OCR noise'),
    'https://chatgpt.com/c/69C4e978-0f8c-83aa-b960-c52f68f88897'
  );
  assert.equal(
    extractConversationUrlFromOcrText('chatgpt.com/c/69c4ed24-18f8-83ab-940b noise block -ee42518a9678 more noise'),
    'https://chatgpt.com/c/69c4ed24-18f8-83ab-940b-ee42518a9678'
  );
});

test('strict pre-submit surface assessment rejects visible conversation reuse', () => {
  assert.deepEqual(
    assessStrictPreSubmitSurface({
      currentUrl: 'https://chatgpt.com/',
      windowTitle: 'ChatGPT - Chrome',
      ocrText: ''
    }),
    {
      ok: true,
      proof: 'preSubmitHomeUrlConfirmed',
      currentUrl: 'https://chatgpt.com/',
      conversationUrl: '',
      conversationId: '',
      titleLooksFresh: true,
      homeUrlConfirmed: true
    }
  );

  assert.equal(
    assessStrictPreSubmitSurface({
      currentUrl: '',
      windowTitle: 'desktop install dry-run - Chrome',
      ocrText: 'chatgpt.com/c/69c4ed24-18f8-83ab-940b-ee42518a9678'
    }).ok,
    false
  );
});

test('strict post-submit assessment requires a new conversation and changed screenshot', () => {
  assert.equal(assessStrictPostSubmitEvidence({
    preSubmitConversationId: '',
    conversationUrl: 'https://chatgpt.com/c/new-id',
    preSubmitScreenshotHash: 'before',
    postSubmitScreenshotHash: 'after'
  }).ok, true);

  assert.equal(assessStrictPostSubmitEvidence({
    preSubmitConversationId: '',
    conversationUrl: 'https://chatgpt.com/c/new-id',
    preSubmitScreenshotHash: 'same',
    postSubmitScreenshotHash: 'same'
  }).ok, false);
});

test('pickOpenedBrowserWindow only accepts a genuinely new top-level handle', () => {
  const before = [
    { handle: '101', title: 'ChatGPT - Chrome' },
    { handle: '202', title: 'Other - Chrome' }
  ];
  const after = [
    ...before,
    { handle: '303', title: 'New Tab - Chrome' }
  ];

  assert.deepEqual(
    pickOpenedBrowserWindow(before, after, { handle: '303', title: 'New Tab - Chrome' }),
    { handle: '303', title: 'New Tab - Chrome' }
  );
  assert.equal(pickOpenedBrowserWindow(before, before, { handle: '101' }), null);
});

test('resolveDesktopScreenshotPath creates deterministic artifact paths when none are provided', () => {
  const explicit = resolveDesktopScreenshotPath('artifacts/custom-shot.png', 'default');
  assert.ok(explicit.endsWith('artifacts\\custom-shot.png') || explicit.endsWith('artifacts/custom-shot.png'));

  const generated = resolveDesktopScreenshotPath(null, 'default');
  assert.ok(generated.includes('artifacts'));
  assert.ok(generated.includes('screenshots'));
  assert.ok(generated.includes('desktop-submit-default-'));
  assert.ok(generated.endsWith('.png'));

  const baseline = resolveStrictBaselineScreenshotPath(generated);
  assert.ok(baseline.includes('.pre-submit'));
  assert.ok(baseline.endsWith('.png'));

  const runScoped = resolveDesktopScreenshotPath(null, 'default', 'artifacts/runs/example/screenshots');
  assert.ok(runScoped.includes('artifacts'));
  assert.ok(runScoped.includes('runs'));
  assert.ok(runScoped.includes('screenshots'));
});

test('isRectClose tolerates small window settling drift only', () => {
  assert.equal(isRectClose(
    { x: 101, y: 99, width: 1202, height: 797 },
    { x: 100, y: 100, width: 1200, height: 800 },
    3
  ), true);

  assert.equal(isRectClose(
    { x: 110, y: 100, width: 1200, height: 800 },
    { x: 100, y: 100, width: 1200, height: 800 },
    3
  ), false);
});

test('phaseForDesktopStep maps high-level steps into stable diagnostic phases', () => {
  assert.equal(phaseForDesktopStep('select-window'), 'seed-window');
  assert.equal(phaseForDesktopStep('focus-prompt'), 'prompt-focus');
  assert.equal(phaseForDesktopStep('validate-prompt'), 'prompt-validate');
  assert.equal(phaseForDesktopStep('submit-prompt'), 'submit-attempt');
  assert.equal(phaseForDesktopStep('strict-submit-proof'), 'strict-proof');
});

test('classifyDesktopFailure groups failure causes for summary.json output', () => {
  assert.equal(classifyDesktopFailure(new StepError('PROMPT_VALIDATION_FAILED', 'validate-prompt', 'bad')), 'prompt-validation-failed');
  assert.equal(classifyDesktopFailure(new StepError('SUBMIT_PRECHECK_FAILED', 'submit-prompt-precheck', 'bad')), 'submit-gate-failed');
  assert.equal(classifyDesktopFailure(new StepError('STRICT_PROOF_FAILED', 'strict-submit-proof', 'bad')), 'strict-proof-failed');
});

test('isSoftRecoveryEligible only allows a single bounded recovery class of failures', () => {
  assert.equal(isSoftRecoveryEligible(new StepError('PROMPT_VALIDATION_FAILED', 'validate-prompt', 'bad')), true);
  assert.equal(isSoftRecoveryEligible(new StepError('SUBMIT_PRECHECK_FAILED', 'submit-prompt-precheck', 'bad')), true);
  assert.equal(isSoftRecoveryEligible(new StepError('STRICT_PROOF_FAILED', 'strict-submit-proof', 'bad')), false);
});
