import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createFailureReceipt, createReceipt } from '../receipt.js';
import { StepError, ERROR_CODES } from '../errors.js';
import { parseDesktopSubmitArgs } from '../args.js';
import { writeJsonlLogs } from '../logger.js';
import { loadProfile } from '../profile-loader.js';
import { validateConfig } from '../config-schema.js';
import {
  buildDesktopRunSummary,
  createDesktopRunArtifacts,
  ensureDesktopRunArtifacts,
  writeFailedPromptArtifact,
  writeRunReceiptArtifacts
} from '../run-artifacts.js';
import { loadCalibrationProfile } from './calibration-store.js';
import { getStandardWindowBounds, resolveAnchorPoint } from './geometry.js';
import { selectDesktopMode, startDesktopNewChat } from './chatgpt-desktop-actions.js';
import { configureDesktopWorker, shutdownDesktopWorker } from './powershell.js';
import {
  captureWindowScreenshot,
  clickPoint,
  cropImage,
  delay,
  focusWindow,
  getClipboardText,
  getForegroundWindow,
  getUrlViaOmnibox,
  getWindowRect,
  listChromeWindows,
  ocrImageText,
  openBrowserWindow,
  pasteClipboard,
  pressEnter,
  resizeWindow,
  sendKeys,
  sendText,
  setClipboardText,
  uiaGetFocusedElement,
  uiaInvoke,
  uiaQuery,
  uiaReadFocusedText,
  uiaReadText,
  uiaSetFocusedValue,
  uiaSetFocus
} from './windows-input.js';
import { chooseVerifiedChatGptWindow, isChatGptUrl } from './window-targeting.js';

const CHATGPT_URL = 'https://chatgpt.com/';
const CHATGPT_HOST = 'chatgpt.com';
const COMPOSER_FOCUS_SETTLE_MS = 220;
const PASTE_KEY_DELAY_MS = 90;
const POST_PASTE_SETTLE_MS = 320;
const LONG_PROMPT_PASTE_SETTLE_MS = 900;
const SELECT_ALL_SETTLE_MS = 250;
const CLIPBOARD_COPY_SETTLE_MS = 400;
const NEW_WINDOW_DETECT_ATTEMPTS = 18;
const STRICT_CONVERSATION_WAIT_ATTEMPTS = 20;
const STRICT_OCR_WAIT_ATTEMPTS = 12;
const COMPOSER_CROP_PADDING_X = 24;
const COMPOSER_CROP_PADDING_TOP = 20;
const COMPOSER_CROP_PADDING_BOTTOM = 220;
const COMPOSER_CROP_MIN_HEIGHT = 220;
const OMNIBOX_HINTS = [
  '주소창',
  'address',
  'search',
  'omnibox',
  'url',
  'view_1012',
  'omniboxviewviews'
];

function enforceDesktopFirstConstraints(args) {
  if (args.project) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport does not support --project yet. Use submit-browser-chatgpt or --transport=browser.');
  }
  if (args.attachments?.length) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport does not support --attachment yet. Use submit-browser-chatgpt or --transport=browser.');
  }
  if (!['auto', 'pro'].includes(args.mode || 'auto')) {
    throw new StepError(ERROR_CODES.INVALID_ARGS, 'desktop-constraints', 'Desktop transport currently supports only --mode auto or --mode pro. Use submit-browser-chatgpt or --transport=browser for other browser-side mode selection.');
  }
}

export async function submitDesktopChatgpt(argv = []) {
  let lastStep = 'start';
  let currentUrl = CHATGPT_URL;
  let conversationUrl = null;
  let lastWindow = null;
  let lastFocusedElement = null;
  let clipboardHash = null;
  let logPath = null;
  let screenshotPath = null;
  let capturedScreenshotPath = null;
  let targetWindowHandle = null;
  let modeResolved = 'auto';
  let surface = 'same-window';
  let proofLevel = 'fast';
  let strictPreSubmitBaseline = null;
  let composerVisualBaseline = null;
  let debugArtifacts = null;
  let prompt = '';
  let promptFocus = null;
  let insertion = null;
  let validation = null;
  let args = null;
  let submitAttempted = false;
  let submitAttemptMethod = null;
  let finalAction = 'submit-withheld';
  let failureClass = null;
  let failureReason = null;
  let attemptCount = 1;
  let currentAttemptIndex = 1;
  const notes = [];
  const runArtifacts = createDesktopRunArtifacts();
  const submitLogPaths = [runArtifacts.submitLogPath, runArtifacts.aggregateSubmitLogPath];

  const logSubmitEvent = async (event = {}) => {
    const step = event.step || lastStep;
    await writeJsonlLogs(submitLogPaths, {
      runId: runArtifacts.runId,
      artifactDir: runArtifacts.artifactDir,
      phase: event.phase || phaseForDesktopStep(step),
      attemptIndex: event.attemptIndex || currentAttemptIndex,
      targetWindowHandle,
      ...event
    });
  };

  const syncAutomationContext = async (step = lastStep, phase = null, attemptIndex = currentAttemptIndex) => {
    await configureDesktopWorker({
      logPath: runArtifacts.workerClientLogPath,
      workerLogPath: runArtifacts.workerLogPath,
      automationContext: {
        runId: runArtifacts.runId,
        attemptIndex,
        phase: phase || phaseForDesktopStep(step),
        step,
        targetWindowHandle
      }
    });
  };

  const finalizeReceipt = async (receipt) => {
    const summary = buildDesktopRunSummary({
      receipt,
      runId: runArtifacts.runId,
      artifactDir: runArtifacts.artifactDir,
      finalAction,
      attemptCount,
      submitAttempted,
      submitAttemptMethod,
      failureClass,
      failureReason,
      debugArtifacts,
      targetWindowHandle,
      conversationUrl,
      logPaths: {
        submitLogPath: runArtifacts.submitLogPath,
        workerClientLogPath: runArtifacts.workerClientLogPath,
        workerLogPath: runArtifacts.workerLogPath,
        aggregateSubmitLogPath: runArtifacts.aggregateSubmitLogPath
      }
    });
    await writeRunReceiptArtifacts(runArtifacts, receipt, summary).catch(() => {});
    return receipt;
  };

  await ensureDesktopRunArtifacts(runArtifacts).catch(() => {});

  try {
    args = await parseDesktopSubmitArgs(argv);
    prompt = normalizePromptForSubmission(args.prompt);
    enforceDesktopFirstConstraints(args);
    modeResolved = args.mode || 'auto';
    surface = args.surface || 'same-window';
    proofLevel = args.proofLevel || 'fast';
    logPath = runArtifacts.submitLogPath;

    await shutdownDesktopWorker().catch(() => {});
    await syncAutomationContext('init', 'init');

    lastStep = 'load-ui-profile';
    const uiProfile = validateConfig(await loadProfile(args.profile));

    lastStep = 'load-calibration-profile';
    const calibration = await loadCalibrationProfile(args.calibrationProfile, {
      baseDir: args.calibrationDir
    });
    const targetBounds = getStandardWindowBounds(calibration);
    const titleHint = args.windowTitle || calibration?.window?.titleHint || 'ChatGPT';
    const promptPoint = resolveAnchorPoint(calibration, 'promptInput', targetBounds);
    const submitPoint = resolveAnchorPoint(calibration, 'submitButton', targetBounds);
    screenshotPath = resolveDesktopScreenshotPath(
      args.screenshotPath,
      args.calibrationProfile,
      runArtifacts.screenshotsDir
    );

    notes.push('transport=desktop');
    notes.push('transportStatus=default');
    notes.push('fallbackOrder=UIA>focus-enter>calibrated-coordinates');
    notes.push('desktopMode=deterministic-desktop-pro-handoff');
    notes.push(`runId=${runArtifacts.runId}`);
    notes.push(`artifactDir=${runArtifacts.artifactDir}`);
    notes.push(`profile=${uiProfile.profileName}`);
    notes.push(`uiTier=${uiProfile.chatgpt?.uiTier || 'unknown'}`);
    notes.push(`modeResolved=${modeResolved}`);
    notes.push(`newChat=${args.newChat === true}`);
    notes.push(`surface=${surface}`);
    notes.push(`proofLevel=${proofLevel}`);
    notes.push(`calibrationProfile=${args.calibrationProfile}`);
    notes.push(`titleHint=${titleHint}`);
    notes.push(`targetBounds=${targetBounds.x},${targetBounds.y},${targetBounds.width},${targetBounds.height}`);
    notes.push(`promptPoint=${promptPoint.x},${promptPoint.y}`);
    notes.push(`submitPoint=${submitPoint.x},${submitPoint.y}`);
    notes.push(`plannedScreenshotPath=${screenshotPath}`);
    notes.push(`logPath=${logPath}`);
    notes.push(`aggregateLogPath=${runArtifacts.aggregateSubmitLogPath}`);
    notes.push(`workerTracePath=${runArtifacts.workerLogPath}`);

    await logSubmitEvent({
      step: 'init',
      profile: args.profile,
      modeResolved,
      surface,
      proofLevel,
      newChat: args.newChat,
      dryRun: args.dryRun,
      submit: args.submit,
      screenshotPath,
      calibrationProfile: args.calibrationProfile,
      titleHint,
      targetBounds
    });

    if (process.env.SKIP_DESKTOP_AUTOMATION === '1' || process.env.SKIP_BROWSER_AUTOMATION === '1') {
      notes.push('desktopAutomation=skipped');
      notes.push(`promptHash=${hashText(prompt)}`);
      return finalizeReceipt(createReceipt({
        submitted: false,
        modeResolved,
        projectResolved: null,
        url: CHATGPT_URL,
        runId: runArtifacts.runId,
        artifactDir: runArtifacts.artifactDir,
        surface,
        proofLevel,
        screenshotPath: capturedScreenshotPath,
        submitAttempted,
        submitAttemptMethod,
        failureClass,
        failureReason,
        attemptCount,
        finalAction,
        debugArtifacts,
        notes
      }));
    }

    lastStep = 'select-window';
    await syncAutomationContext(lastStep);
    const windowSelection = await chooseVerifiedChatGptWindow(titleHint);
    const seedWindow = windowSelection.selectedWindow;
    let selectedWindow = seedWindow;
    lastWindow = seedWindow;
    targetWindowHandle = seedWindow.handle;
    notes.push(`seedWindowHandle=${seedWindow.handle}`);
    notes.push(`seedWindowTitle=${seedWindow.title}`);
    if (windowSelection.evidence?.reasons?.length) {
      notes.push(`seedTargetEvidence=${windowSelection.evidence.reasons.join('+')}`);
    }
    await syncAutomationContext(lastStep);
    await logSubmitEvent({ step: lastStep, seedWindow, targetEvidence: windowSelection.evidence, candidates: windowSelection.candidates });

    if (surface === 'new-window') {
      lastStep = 'create-surface';
      await syncAutomationContext(lastStep);
      const surfaceResult = await createDedicatedWindowSurface({
        seedWindow,
        stepDelayMs: args.stepDelayMs
      });
      selectedWindow = surfaceResult.window;
      lastWindow = selectedWindow;
      targetWindowHandle = selectedWindow.handle;
      notes.push(`surfaceWindowHandle=${selectedWindow.handle}`);
      notes.push(`surfaceWindowTitle=${selectedWindow.title}`);
      notes.push(`surfaceCreationProof=${surfaceResult.proof}`);
      await syncAutomationContext(lastStep);
      await logSubmitEvent({ step: lastStep, surfaceResult });
    } else {
      notes.push(`surfaceWindowHandle=${selectedWindow.handle}`);
      notes.push(`surfaceWindowTitle=${selectedWindow.title}`);
    }

    lastStep = 'focus-window';
    await syncAutomationContext(lastStep);
    const focusWindowResult = await stabilizeWindowFocus(selectedWindow.handle, args.stepDelayMs);
    await logSubmitEvent({ step: lastStep, handle: selectedWindow.handle, focusWindowResult });
    notes.push(`windowFocusProof=${focusWindowResult.proof}`);

    lastStep = 'normalize-window';
    await syncAutomationContext(lastStep);
    await resizeWindow(targetBounds, selectedWindow.handle);
    const normalizedWindow = await waitForWindowRectStability(selectedWindow.handle, targetBounds, args.stepDelayMs);
    lastWindow = normalizedWindow.window;
    await logSubmitEvent({ step: lastStep, window: lastWindow, normalizedWindow });

    lastStep = 'navigate-chatgpt';
    await syncAutomationContext(lastStep);
    const navigation = await navigateToChatGpt(selectedWindow.handle, CHATGPT_URL, args.stepDelayMs);
    currentUrl = navigation.currentUrl;
    await logSubmitEvent({ step: lastStep, navigation });
    notes.push(`navigationProof=${navigation.proof}`);

    lastStep = 'verify-url-after-navigation';
    await syncAutomationContext(lastStep);
    const urlCheck = await readCurrentUrl(selectedWindow.handle).catch(() => '');
    currentUrl = String(urlCheck || '').trim() || currentUrl || CHATGPT_URL;
    const currentUrlLooksValid = isChatGptUrl(currentUrl);
    await logSubmitEvent({ step: lastStep, currentUrl, currentUrlLooksValid });
    if (!currentUrlLooksValid) {
      notes.push(`staleOmniboxUrl=${truncateForNote(currentUrl)}`);
      notes.push('urlVerificationDegraded=ignored-non-url-omnibox-echo');
      currentUrl = CHATGPT_URL;
    }

    if (proofLevel === 'strict' && surface === 'new-window') {
      lastStep = 'verify-fresh-surface';
      await syncAutomationContext(lastStep);
      const surfaceReady = await verifyStrictFreshSurface({
        handle: selectedWindow.handle,
        currentUrl,
        stepDelayMs: args.stepDelayMs
      });
      currentUrl = surfaceReady.currentUrl || currentUrl;
      notes.push(`surfaceReadyProof=${surfaceReady.proof}`);
      await logSubmitEvent({ step: lastStep, surfaceReady });
    }

    lastStep = 'dismiss-interstitials';
    await syncAutomationContext(lastStep);
    const dismissal = await dismissInterferingUi(selectedWindow.handle, args.stepDelayMs);
    if (dismissal?.acted) {
      notes.push(`dismissedUi=${dismissal.method}`);
    }
    await logSubmitEvent({ step: lastStep, dismissal });

    lastStep = 'normalize-zoom';
    await syncAutomationContext(lastStep);
    await sendKeys('0', ['ctrl']);
    await delay(args.stepDelayMs);
    await logSubmitEvent({ step: lastStep });

    if (args.newChat) {
      if (surface === 'new-window' && proofLevel === 'strict' && isChatGptHomeUrl(currentUrl)) {
        notes.push('newChatSkipped=freshWindowAlreadyAtHome');
      } else {
        lastStep = 'start-new-chat';
        await syncAutomationContext(lastStep);
        const newChatResult = await startDesktopNewChat({
          handle: selectedWindow.handle,
          stepDelayMs: args.stepDelayMs,
          calibration,
          windowBounds: targetBounds,
          profile: uiProfile
        });
        notes.push(`newChatProof=${newChatResult.proof}`);
        notes.push(`newChatMethod=${newChatResult.method}`);
        await logSubmitEvent({ step: lastStep, newChatResult });
      }
    }

    if (modeResolved !== 'auto') {
      lastStep = 'select-mode';
      await syncAutomationContext(lastStep);
      const modeResult = await selectDesktopMode({
        handle: selectedWindow.handle,
        stepDelayMs: args.stepDelayMs,
        calibration,
        windowBounds: targetBounds,
        profile: uiProfile,
        modeResolved,
        allowPointClick: false,
        allowAnchorFallback: args.allowModeAnchorFallback === true
      });
      notes.push(`modeSelectionProof=${modeResult.proof}`);
      notes.push(`modeSelectionMethod=${modeResult.method}`);
      notes.push(`modeConfirmed=${modeResult.confirmed !== false}`);
      await logSubmitEvent({ step: lastStep, modeResult });
    }

    lastStep = 'focus-prompt';
    currentAttemptIndex = 1;
    await syncAutomationContext(lastStep);
    promptFocus = await focusPromptBox(selectedWindow.handle, promptPoint, args.stepDelayMs);
    lastFocusedElement = promptFocus.focusedElement ?? null;
    notes.push(`promptFocusVia=${promptFocus.via}`);
    if (promptFocus.omniboxRejected) {
      notes.push('omniboxRejected=true');
    }
    if (promptFocus.readinessProof) {
      notes.push(`composerReadiness=${promptFocus.readinessProof}`);
    }
    await logSubmitEvent({ step: lastStep, promptFocus });

    if (proofLevel === 'strict') {
      lastStep = 'capture-strict-baseline';
      await syncAutomationContext(lastStep);
      strictPreSubmitBaseline = await capturePassiveStrictPreSubmitBaseline({
        handle: selectedWindow.handle,
        currentUrl,
        screenshotPath,
        stepDelayMs: args.stepDelayMs
      });
      capturedScreenshotPath = strictPreSubmitBaseline.screenshotPath || capturedScreenshotPath;
      notes.push(`strictPreSubmit=${strictPreSubmitBaseline.proof}`);
      notes.push(`strictPreSubmitTitle=${strictPreSubmitBaseline.windowTitle}`);
      await logSubmitEvent({ step: lastStep, strictPreSubmitBaseline });
    }

      if (proofLevel === 'strict' && screenshotPath) {
        lastStep = 'capture-composer-baseline';
        await syncAutomationContext(lastStep);
        composerVisualBaseline = await collectComposerVisualBaseline({
          handle: selectedWindow.handle,
        screenshotPath,
        promptFocus,
        prompt,
        stepDelayMs: args.stepDelayMs,
        windowRect: lastWindow?.rect || null
      }).catch(() => null);
      if (composerVisualBaseline?.debugArtifacts) {
        debugArtifacts = mergeDebugArtifacts(debugArtifacts, composerVisualBaseline.debugArtifacts);
      }
      await logSubmitEvent({ step: lastStep, composerVisualBaseline });
    }

    lastStep = 'insert-prompt';
    await syncAutomationContext(lastStep);
      insertion = await insertPrompt(selectedWindow.handle, prompt, promptFocus, args.stepDelayMs, {
        screenshotPath,
        windowRect: lastWindow?.rect || null,
        baseline: composerVisualBaseline
      });
    clipboardHash = insertion.actualHash;
    lastFocusedElement = insertion.focusedElement ?? lastFocusedElement;
    notes.push(`promptHash=${insertion.expectedHash}`);
    notes.push(`insertionMethod=${insertion.method}`);
    await logSubmitEvent({ step: lastStep, insertion });

    lastStep = 'validate-prompt';
    await syncAutomationContext(lastStep);
    try {
      validation = await validatePromptInput(
        selectedWindow.handle,
        prompt,
        promptFocus,
        insertion,
        args.stepDelayMs,
        {
          screenshotPath,
          windowRect: lastWindow?.rect || null,
          baseline: composerVisualBaseline,
          allowDestructiveFallback: args.allowRecovery === true
        }
      );
    } catch (validationError) {
      if (!args.allowRecovery) {
        throw validationError;
      }
      attemptCount = Math.max(attemptCount, 2);
      currentAttemptIndex = 2;
      const recovery = await attemptBoundedVisiblePasteRecovery({
        handle: selectedWindow.handle,
        prompt,
        promptFocus,
        insertion,
        stepDelayMs: args.stepDelayMs,
        screenshotPath,
        windowRect: lastWindow?.rect || null,
        baseline: composerVisualBaseline,
        error: validationError,
        targetWindowHandle,
        attemptIndex: 2,
        logEvent: logSubmitEvent,
        syncAutomationContext
      });
      if (!recovery?.ok) {
        throw validationError;
      }
      finalAction = 'submit-withheld';
      notes.push('selfHealRetry=1');
      notes.push(`retryRecoveryProof=${recovery.validation.proof}`);
      validation = recovery.validation;
    }
    clipboardHash = validation.clipboardHash;
    lastFocusedElement = validation.focusedElement ?? lastFocusedElement;
    attemptCount = Math.max(attemptCount, validation.recoveryTriggered ? 2 : 1);
    notes.push(`validationMethod=${validation.method}`);
    notes.push(`validationLevel=${validation.validationLevel || 'none'}`);
    notes.push(`promptValidated=${validation.promptValidated === true}`);
    notes.push(`submitAllowed=${validation.submitAllowed === true}`);
    if (validation.proof) {
      notes.push(`inputProof=${validation.proof}`);
    }
    if (validation.debugArtifacts) {
      debugArtifacts = mergeDebugArtifacts(debugArtifacts, validation.debugArtifacts);
    }
    await logSubmitEvent({ step: lastStep, validation, attemptIndex: validation.recoveryTriggered ? 2 : currentAttemptIndex });

    if (args.dryRun || !args.submit) {
      lastStep = 'dry-run-ready';
      await logSubmitEvent({ step: lastStep, currentUrl, window: lastWindow, focusedElement: lastFocusedElement, clipboardHash });
      if (!args.submit) {
        notes.push('submit=false');
      }
      return finalizeReceipt(createReceipt({
        submitted: false,
        modeResolved,
        projectResolved: null,
        url: currentUrl,
        runId: runArtifacts.runId,
        artifactDir: runArtifacts.artifactDir,
        surface,
        proofLevel,
        targetWindowHandle,
        conversationUrl,
        screenshotPath: proofLevel === 'strict' ? capturedScreenshotPath : null,
        submitAttempted,
        submitAttemptMethod,
        failureClass,
        failureReason,
        attemptCount,
        finalAction,
        debugArtifacts,
        notes
      }));
    }

    lastStep = 'submit-prompt';
    await syncAutomationContext(lastStep, 'submit-attempt');
    let submitResult;
    try {
      submitResult = await submitPrompt(
        selectedWindow.handle,
        submitPoint,
        args.stepDelayMs,
        prompt,
        promptFocus,
        args.submitMethod,
        validation,
        args.allowRecovery === true
      );
    } catch (submitError) {
      if (!args.allowRecovery) {
        throw submitError;
      }
      attemptCount = Math.max(attemptCount, 2);
      currentAttemptIndex = 2;
      const recovery = await attemptBoundedVisiblePasteRecovery({
        handle: selectedWindow.handle,
        prompt,
        promptFocus,
        insertion,
        stepDelayMs: args.stepDelayMs,
        screenshotPath,
        windowRect: lastWindow?.rect || null,
        baseline: composerVisualBaseline,
        error: submitError,
        targetWindowHandle,
        attemptIndex: attemptCount >= 2 ? attemptCount : 2,
        logEvent: logSubmitEvent,
        syncAutomationContext
      });
      if (!recovery?.ok) {
        throw submitError;
      }
      validation = recovery.validation;
      notes.push('selfHealRetry=1');
      notes.push(`retryRecoveryProof=${recovery.validation.proof}`);
      if (validation.debugArtifacts) {
        debugArtifacts = mergeDebugArtifacts(debugArtifacts, validation.debugArtifacts);
      }
      lastStep = 'submit-prompt';
      await syncAutomationContext(lastStep, 'submit-attempt');
      submitResult = await submitPrompt(
        selectedWindow.handle,
        submitPoint,
        args.stepDelayMs,
        prompt,
        promptFocus,
        'enter',
        validation,
        args.allowRecovery === true
      );
    }
    submitAttempted = Boolean(submitResult?.submitAttempted);
    submitAttemptMethod = submitResult?.method || null;
    finalAction = submitAttemptMethod === 'enter'
      ? 'enter-attempted'
      : (submitAttemptMethod === 'click' ? 'click-attempted' : finalAction);
    await logSubmitEvent({ step: lastStep, submitResult, attemptIndex: currentAttemptIndex });
    notes.push(`submitMethod=${submitResult.method}`);
    if (submitResult.proof) {
      notes.push(`submitProof=${submitResult.proof}`);
    }

    if (proofLevel === 'strict') {
      lastStep = 'strict-submit-proof';
      await syncAutomationContext(lastStep);
      const strictProof = await collectStrictSubmitProof({
        handle: selectedWindow.handle,
        prompt,
        promptHash: validation.expectedHash || hashText(prompt),
        preSubmitUrl: currentUrl,
        preSubmitBaseline: strictPreSubmitBaseline,
        screenshotPath,
        stepDelayMs: args.stepDelayMs
      });
      conversationUrl = strictProof.conversationUrl;
      currentUrl = strictProof.conversationUrl;
      screenshotPath = strictProof.screenshotPath;
      capturedScreenshotPath = strictProof.screenshotPath || capturedScreenshotPath;
      notes.push(`strictProof=${strictProof.proof}`);
      notes.push(`conversationUrl=${conversationUrl}`);
      notes.push(`screenshotCaptured=${screenshotPath}`);
      await logSubmitEvent({ step: lastStep, strictProof });
    }

    finalAction = 'submitted-confirmed';
    return finalizeReceipt(createReceipt({
      submitted: true,
      modeResolved,
      projectResolved: null,
      url: conversationUrl || currentUrl,
      runId: runArtifacts.runId,
      artifactDir: runArtifacts.artifactDir,
      surface,
      proofLevel,
      targetWindowHandle,
      conversationUrl,
      screenshotPath: proofLevel === 'strict' ? capturedScreenshotPath : null,
      submitAttempted,
      submitAttemptMethod,
      failureClass,
      failureReason,
      attemptCount,
      finalAction,
      debugArtifacts,
      notes
    }));
  } catch (error) {
    const normalizedError = error instanceof StepError
      ? error
      : new StepError(error?.code || ERROR_CODES.SUBMIT_FAILED, error?.step || lastStep, error?.message || String(error));
    const failureNotes = [...notes, `lastStep=${lastStep}`];
    if (currentUrl) failureNotes.push(`lastUrl=${currentUrl}`);
    if (lastWindow?.rect) failureNotes.push(`windowRect=${JSON.stringify(lastWindow.rect)}`);
    if (lastFocusedElement) failureNotes.push(`focusedElement=${JSON.stringify(lastFocusedElement)}`);
    if (clipboardHash) failureNotes.push(`clipboardHash=${clipboardHash}`);
    failureClass = classifyDesktopFailure(normalizedError, lastStep);
    failureReason = normalizedError.message;
    if (!submitAttempted) {
      finalAction = normalizedError.code === ERROR_CODES.STRICT_PROOF_FAILED
        ? 'strict-proof-failed'
        : 'submit-withheld';
    }
    debugArtifacts = mergeDebugArtifacts(
      debugArtifacts,
      extractDebugArtifactsFromError(normalizedError)
    );
    if (prompt) {
      const promptArtifactPath = await writeFailedPromptArtifact(runArtifacts, prompt).catch(() => null);
      debugArtifacts = mergeDebugArtifacts(debugArtifacts, {
        promptArtifactPath,
        workerTracePath: runArtifacts.workerLogPath
      });
    }
    if (logPath) {
      await logSubmitEvent({
        step: 'failure',
        lastStep,
        error: { code: normalizedError.code, message: normalizedError.message },
        currentUrl,
        window: lastWindow,
        focusedElement: lastFocusedElement,
        clipboardHash,
        finalAction,
        failureClass
      });
    }
    return finalizeReceipt(createFailureReceipt({
      error: normalizedError,
      url: currentUrl || CHATGPT_URL,
      runId: runArtifacts.runId,
      artifactDir: runArtifacts.artifactDir,
      surface,
      proofLevel,
      targetWindowHandle,
      conversationUrl,
      screenshotPath: null,
      submitAttempted,
      submitAttemptMethod,
      failureClass,
      failureReason,
      attemptCount,
      finalAction,
      debugArtifacts,
      notes: failureNotes
    }));
  }
}

function resolveDesktopScreenshotPath(explicitPath, calibrationProfile = 'default', screenshotsDir = path.resolve('artifacts', 'screenshots')) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(screenshotsDir, `desktop-submit-${calibrationProfile}-${stamp}.png`);
}

async function createDedicatedWindowSurface({ seedWindow, stepDelayMs }) {
  const beforeWindows = await listChromeWindows();
  await stabilizeWindowFocus(seedWindow.handle, stepDelayMs).catch(() => {});
  await delay(stepDelayMs);
  await sendKeys('n', ['ctrl']);

  const ctrlNResult = await waitForNewBrowserWindowFromBaseline(beforeWindows, {
    step: 'create-surface',
    stepDelayMs,
    attempts: 6,
    throwOnFailure: false
  });

  let result = ctrlNResult;
  if (!result?.ok) {
    await openBrowserWindow(seedWindow.handle, CHATGPT_URL);
    result = await waitForNewBrowserWindowFromBaseline(beforeWindows, {
      step: 'create-surface',
      stepDelayMs,
      attempts: NEW_WINDOW_DETECT_ATTEMPTS
    });
    result.proof = 'newTopLevelBrowserWindowDetectedAfterProcessLaunch';
  }

  await stabilizeWindowFocus(result.window.handle, stepDelayMs).catch(() => {});
  return result;
}

async function waitForNewBrowserWindowFromBaseline(
  beforeWindows,
  {
    step = 'create-surface',
    stepDelayMs,
    attempts = NEW_WINDOW_DETECT_ATTEMPTS,
    throwOnFailure = true
  } = {}
) {
  return waitForCondition({
    step,
    attempts,
    delayMs: Math.max(stepDelayMs * 2, 250),
    verify: async () => {
      const afterWindows = await listChromeWindows();
      const foreground = await getForegroundWindow().catch(() => null);
      const window = pickOpenedBrowserWindow(beforeWindows, afterWindows, foreground?.window || null);
      return {
        ok: Boolean(window),
        proof: window ? 'newTopLevelBrowserWindowDetected' : 'newTopLevelBrowserWindowPending',
        window,
        beforeCount: beforeWindows.length,
        afterCount: afterWindows.length,
        foreground: foreground?.window || null
      };
    },
    throwOnFailure,
    failureCode: ERROR_CODES.WINDOW_SURFACE_FAILED,
    failureMessage: 'Dedicated new ChatGPT browser window was not detected.'
  });
}

async function verifyStrictFreshSurface({ handle, currentUrl, stepDelayMs }) {
  return waitForCondition({
    step: 'verify-fresh-surface',
    attempts: 8,
    delayMs: Math.max(stepDelayMs * 2, 250),
    verify: async () => {
      const observedUrl = await readCurrentUrl(handle).catch(() => '');
      const resolvedUrl = isChatGptUrl(observedUrl) ? observedUrl : currentUrl;
      const composerElement = await queryComposerElement(handle, 1200).catch(() => null);
      const ok = isChatGptHomeUrl(resolvedUrl) && looksLikeComposerElement(composerElement);
      return {
        ok,
        proof: ok ? 'chatgptHomeUrlAndComposerReady' : 'chatgptHomeOrComposerPending',
        currentUrl: resolvedUrl || currentUrl,
        composerElement
      };
    },
    failureCode: ERROR_CODES.WINDOW_SURFACE_FAILED,
    failureMessage: 'Dedicated surface did not reach a fresh ChatGPT home composer state.'
  });
}

async function collectStrictSubmitProof({
  handle,
  prompt,
  promptHash,
  preSubmitUrl,
  preSubmitBaseline = null,
  screenshotPath,
  stepDelayMs
}) {
  if (!promptHash || promptHash !== hashText(prompt)) {
    throw new StepError(
      ERROR_CODES.STRICT_PROOF_FAILED,
      'strict-submit-proof',
      'Strict proof requires a validated prompt hash before submit.'
    );
  }

  const preSubmitConversationId = preSubmitBaseline?.conversationId || extractChatGptConversationId(preSubmitUrl);
  const conversationProof = await waitForCondition({
    step: 'strict-submit-proof',
    attempts: STRICT_CONVERSATION_WAIT_ATTEMPTS,
    delayMs: Math.max(stepDelayMs * 2, 300),
    verify: async () => {
      const observedUrl = await readCurrentUrl(handle).catch(() => '');
      const conversationId = extractChatGptConversationId(observedUrl);
      const ok = Boolean(conversationId) && conversationId !== preSubmitConversationId;
      return {
        ok,
        proof: ok ? 'conversationUrlCreated' : 'conversationUrlPending',
        currentUrl: observedUrl,
        conversationId
      };
    },
    throwOnFailure: false
  });

  const screenshotCapture = await captureStrictProofScreenshot(handle, screenshotPath, stepDelayMs);
  const ocrProof = conversationProof.ok
    ? null
    : await waitForConversationUrlViaScreenshotOcr({
      handle,
      screenshotPath: screenshotCapture.screenshotPath,
      preSubmitConversationId,
      stepDelayMs
    });

  const conversationUrl = conversationProof.ok
    ? conversationProof.currentUrl
    : (ocrProof?.conversationUrl || '');
  const conversationId = extractChatGptConversationId(conversationUrl);
  const postSubmitScreenshotPath = ocrProof?.screenshotPath || screenshotCapture.screenshotPath;
  const postSubmitScreenshotHash = await hashFile(postSubmitScreenshotPath).catch(() => '');
  const postSubmitAssessment = assessStrictPostSubmitEvidence({
    preSubmitConversationId,
    conversationUrl,
    preSubmitScreenshotHash: preSubmitBaseline?.screenshotHash || '',
    postSubmitScreenshotHash
  });

  if (!conversationId || conversationId === preSubmitConversationId || !postSubmitAssessment.ok) {
    throw new StepError(
      ERROR_CODES.STRICT_PROOF_FAILED,
      'strict-submit-proof',
      postSubmitAssessment.ok
        ? 'Strict proof could not verify a new ChatGPT conversation URL after submit.'
        : 'Strict proof could not verify a visible post-submit state change after submit.',
      {
        preSubmitUrl,
        preSubmitBaseline,
        conversationProof,
        ocrProof,
        screenshotPath: postSubmitScreenshotPath,
        postSubmitAssessment
      }
    );
  }

  return {
    proof: conversationProof.ok
      ? 'conversationUrlCreated+screenshotCaptured+screenshotChanged'
      : 'conversationUrlRecoveredFromWindowOcr+screenshotCaptured+screenshotChanged',
    conversationUrl,
    conversationId,
    screenshotPath: postSubmitScreenshotPath,
    rect: screenshotCapture.rect || null,
    ocrTextSample: String(ocrProof?.ocrText || '').slice(0, 240)
  };
}

async function collectStrictPreSubmitBaseline({
  handle,
  currentUrl,
  screenshotPath,
  stepDelayMs
}) {
  const observedUrl = await readCurrentUrl(handle).catch(() => '');
  const windowTitle = await readWindowTitle(handle).catch(() => '');
  const baselineScreenshotPath = resolveStrictBaselineScreenshotPath(screenshotPath);
  const screenshotCapture = await captureStrictProofScreenshot(handle, baselineScreenshotPath, stepDelayMs);
  const screenshotHash = await hashFile(screenshotCapture.screenshotPath).catch(() => '');
  const ocrResult = await ocrImageText(screenshotCapture.screenshotPath).catch(() => ({ text: '' }));
  const ocrText = String(ocrResult?.text || '');
  const assessment = assessStrictPreSubmitSurface({
    currentUrl: observedUrl || currentUrl || '',
    windowTitle,
    ocrText
  });

  if (!assessment.ok) {
    throw new StepError(
      ERROR_CODES.STRICT_PROOF_FAILED,
      'strict-pre-submit-baseline',
      'Strict proof baseline did not confirm a fresh ChatGPT home surface before submit.',
      {
        observedUrl,
        currentUrl,
        windowTitle,
        ocrTextSample: ocrText.slice(0, 240),
        screenshotPath: screenshotCapture.screenshotPath,
        assessment
      }
    );
  }

  return {
    ...assessment,
    currentUrl: assessment.currentUrl || currentUrl || CHATGPT_URL,
    windowTitle,
    screenshotPath: screenshotCapture.screenshotPath,
    screenshotHash,
    rect: screenshotCapture.rect || null,
    ocrTextSample: ocrText.slice(0, 240)
  };
}

async function capturePassiveStrictPreSubmitBaseline({
  handle,
  currentUrl,
  screenshotPath,
  stepDelayMs
}) {
  const windowTitle = await readWindowTitle(handle).catch(() => '');
  const baselineScreenshotPath = resolveStrictBaselineScreenshotPath(screenshotPath);
  const screenshotCapture = await captureStrictProofScreenshot(handle, baselineScreenshotPath, stepDelayMs);
  const screenshotHash = await hashFile(screenshotCapture.screenshotPath).catch(() => '');
  const ocrResult = await ocrImageText(screenshotCapture.screenshotPath).catch(() => ({ text: '' }));
  const ocrText = String(ocrResult?.text || '');
  const assessment = assessStrictPreSubmitSurface({
    currentUrl: currentUrl || CHATGPT_URL,
    windowTitle,
    ocrText
  });

  if (!assessment.ok) {
    throw new StepError(
      ERROR_CODES.STRICT_PROOF_FAILED,
      'capture-strict-baseline',
      'Strict proof baseline did not confirm a fresh ChatGPT home surface before prompt insertion.',
      {
        currentUrl,
        windowTitle,
        ocrTextSample: ocrText.slice(0, 240),
        screenshotPath: screenshotCapture.screenshotPath,
        assessment
      }
    );
  }

  return {
    ...assessment,
    currentUrl: assessment.currentUrl || currentUrl || CHATGPT_URL,
    windowTitle,
    screenshotPath: screenshotCapture.screenshotPath,
    screenshotHash,
    rect: screenshotCapture.rect || null,
    ocrTextSample: ocrText.slice(0, 240)
  };
}

async function captureStrictProofScreenshot(handle, screenshotPath, stepDelayMs) {
  await delay(stepDelayMs);
  await mkdir(path.dirname(screenshotPath), { recursive: true });

  try {
    const screenshotResult = await captureWindowScreenshot(handle, screenshotPath);
    return {
      screenshotPath: path.resolve(screenshotResult?.screenshotPath || screenshotPath),
      rect: screenshotResult?.rect || null
    };
  } catch (error) {
    throw new StepError(
      ERROR_CODES.SCREENSHOT_FAILED,
      'capture-screenshot',
      error?.message || 'Failed to capture the strict-proof target window screenshot.',
      { handle, screenshotPath }
    );
  }
}

async function waitForConversationUrlViaScreenshotOcr({
  handle,
  screenshotPath,
  preSubmitConversationId,
  stepDelayMs
}) {
  return waitForCondition({
    step: 'strict-submit-proof-ocr',
    attempts: STRICT_OCR_WAIT_ATTEMPTS,
    delayMs: Math.max(stepDelayMs * 8, 2000),
    throwOnFailure: false,
    verify: async () => {
      const screenshotCapture = await captureStrictProofScreenshot(handle, screenshotPath, stepDelayMs);
      const ocrResult = await ocrImageText(screenshotCapture.screenshotPath).catch(() => ({ text: '' }));
      const ocrText = String(ocrResult?.text || '');
      const conversationUrl = extractConversationUrlFromOcrText(ocrText);
      const conversationId = extractChatGptConversationId(conversationUrl);
      const ok = Boolean(conversationId) && conversationId !== preSubmitConversationId;
      return {
        ok,
        proof: ok ? 'conversationUrlRecoveredFromWindowOcr' : 'conversationUrlStillUnavailableInWindowOcr',
        conversationUrl,
        conversationId,
        ocrText,
        screenshotPath: screenshotCapture.screenshotPath,
        rect: screenshotCapture.rect || null
      };
    }
  });
}

async function readCurrentUrl(handle, stepDelayMs = 150) {
  const firstPass = await getUrlViaOmnibox({ handle }).catch(() => ({ url: '' }));
  const firstUrl = String(firstPass.url || '').trim();
  if (isChatGptUrl(firstUrl)) {
    return firstUrl;
  }

  const omniboxFocus = await focusOmniboxAndVerify(handle, stepDelayMs).catch(() => null);
  if (!omniboxFocus?.ok) {
    return firstUrl;
  }

  const focusedText = await uiaReadFocusedText()
    .then((result) => String(result?.text || '').trim())
    .catch(() => '');
  if (isChatGptUrl(focusedText)) {
    return focusedText;
  }

  const secondPass = await getUrlViaOmnibox({ handle }).catch(() => ({ url: firstUrl }));
  return String(secondPass.url || firstUrl || '').trim();
}

async function stabilizeWindowFocus(handle, stepDelayMs) {
  return waitForCondition({
    step: 'focus-window',
    attempts: 4,
    delayMs: stepDelayMs,
    action: async () => {
      await focusWindow(handle);
    },
    verify: async () => {
      const foreground = await getForegroundWindow().catch(() => null);
      const verified = Number(foreground?.window?.handle) === Number(handle);
      return {
        ok: verified,
        proof: verified ? 'foregroundWindowMatchedTarget' : 'foregroundWindowMismatch',
        foreground: foreground?.window || null
      };
    }
  });
}

async function waitForWindowRectStability(handle, targetBounds, stepDelayMs) {
  return waitForCondition({
    step: 'normalize-window',
    attempts: 6,
    delayMs: stepDelayMs,
    verify: async () => {
      const sample = await getWindowRect(handle);
      const window = sample?.window || null;
      const rect = window?.rect || {};
      const withinTolerance = isRectClose(rect, targetBounds, 3);
      return {
        ok: withinTolerance,
        proof: withinTolerance ? 'windowRectMatchedTargetBounds' : 'windowRectStillSettling',
        window
      };
    }
  });
}

async function navigateToChatGpt(handle, targetUrl, stepDelayMs) {
  const omnibox = await focusOmniboxAndVerify(handle, stepDelayMs);
  const urlEntry = await enterAddressAndVerify(handle, targetUrl, stepDelayMs);
  const ready = await waitForChatGptReady(handle, stepDelayMs, targetUrl);
  return {
    ...ready,
    omnibox,
    urlEntry,
    proof: `${omnibox.proof}>${urlEntry.proof}>${ready.proof}`
  };
}

async function focusOmniboxAndVerify(handle, stepDelayMs) {
  const ctrlLResult = await waitForCondition({
    step: 'focus-omnibox',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      await sendKeys('l', ['ctrl']);
    },
    verify: async () => {
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      const ok = isLikelyOmniboxElement(focusedElement);
      return {
        ok,
        proof: ok ? 'omniboxFocusedAfterCtrlL' : 'omniboxNotFocusedYet',
        focusedElement
      };
    },
    throwOnFailure: false
  });

  if (ctrlLResult.ok) {
    return ctrlLResult;
  }

  return waitForCondition({
    step: 'focus-omnibox',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      const focusAttempt = await uiaSetFocus({ handle }, {
        className: 'OmniboxViewViews',
        role: 'Edit',
        timeoutMs: 1500
      }).catch(() => null);
      if (!focusAttempt?.element?.rect) {
        await sendKeys('l', ['ctrl']);
        return;
      }
      await clickPoint({
        x: focusAttempt.element.rect.x + Math.max(16, Math.round(focusAttempt.element.rect.width / 4)),
        y: focusAttempt.element.rect.y + Math.max(8, Math.round(focusAttempt.element.rect.height / 2))
      });
    },
    verify: async () => {
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      const ok = isLikelyOmniboxElement(focusedElement);
      return {
        ok,
        proof: ok ? 'omniboxFocusedViaUiaOrClick' : 'omniboxStillNotFocused',
        focusedElement
      };
    }
  });
}

async function enterAddressAndVerify(handle, targetUrl, stepDelayMs) {
  const expectedValue = normalizeAddressValue(targetUrl);

  const unicodeAttempt = await waitForCondition({
    step: 'enter-address',
    attempts: 2,
    delayMs: stepDelayMs,
    action: async () => {
      await sendKeys('a', ['ctrl']);
      await delay(stepDelayMs);
      await sendText(targetUrl);
    },
    verify: async () => {
      const currentValue = await readCurrentUrl(handle).catch(() => '');
      const ok = normalizeAddressValue(currentValue) === expectedValue;
      return {
        ok,
        proof: ok ? 'omniboxValueMatchedTargetUrlViaUnicode' : 'omniboxValueMismatchAfterUnicode',
        currentValue
      };
    },
    throwOnFailure: false
  });

  if (unicodeAttempt.ok) {
    return unicodeAttempt;
  }

  return waitForCondition({
    step: 'enter-address',
    attempts: 3,
    delayMs: stepDelayMs,
    action: async () => {
      await sendKeys('a', ['ctrl']);
      await delay(stepDelayMs);
      await setClipboardText(targetUrl);
      await delay(stepDelayMs);
      await pasteClipboard();
    },
    verify: async () => {
      const currentValue = await readCurrentUrl(handle).catch(() => '');
      const ok = normalizeAddressValue(currentValue) === expectedValue;
      return {
        ok,
        proof: ok ? 'omniboxValueMatchedTargetUrlViaClipboard' : 'omniboxValueMismatchAfterClipboard',
        currentValue
      };
    }
  });
}

async function waitForChatGptReady(handle, stepDelayMs, targetUrl) {
  await pressEnter();
  return waitForCondition({
    step: 'wait-chatgpt-ready',
    attempts: 10,
    delayMs: stepDelayMs * 2,
    verify: async () => {
      const currentUrl = await readCurrentUrl(handle).catch(() => '');
      const urlOk = isChatGptUrl(currentUrl) || normalizeAddressValue(currentUrl) === normalizeAddressValue(targetUrl);
      const composerElement = await queryComposerElement(handle, 1200).catch(() => null);
      const ready = urlOk && looksLikeComposerElement(composerElement);
      return {
        ok: ready,
        proof: ready ? 'chatgptUrlAndComposerReady' : (urlOk ? 'chatgptUrlReadyComposerPending' : 'chatgptUrlPending'),
        currentUrl: currentUrl || targetUrl,
        composerElement
      };
    }
  });
}

async function dismissInterferingUi(handle, stepDelayMs) {
  const buttonNames = ['모두 허용', 'Allow all', 'Accept all', '확인'];
  for (const name of buttonNames) {
    try {
      await uiaInvoke({ handle }, { name, role: 'Button', timeoutMs: 600 });
      await delay(stepDelayMs * 2);
      return { acted: true, method: `uia-invoke:${name}` };
    } catch {
      // try next label
    }
  }

  try {
    await sendKeys('escape');
    await delay(stepDelayMs);
    return { acted: true, method: 'escape' };
  } catch {
    // ignore; some dialogs do not respond to escape
  }

  return { acted: false, method: 'none' };
}

async function focusPromptBox(handle, fallbackPoint, stepDelayMs) {
  let via = 'uia-focus-prompt-textarea';
  let element = null;
  let omniboxRejected = false;

  try {
    const ready = await waitForComposerReady(handle, stepDelayMs, {
      timeoutAttempts: 6,
      fallbackPoint
    });
    element = ready.element;
    via = ready.via;
  } catch {
    via = 'calibrated-fallback';
    await clickPoint(fallbackPoint);
    await delay(stepDelayMs);
    const retry = await waitForComposerReady(handle, stepDelayMs, {
      timeoutAttempts: 4,
      fallbackPoint,
      preferFallback: true
    }).catch(() => null);
    element = retry?.element || null;
    if (retry?.via) via = retry.via;
  }

  await delay(stepDelayMs);
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  if (isLikelyOmniboxElement(focusedElement) || isLikelyOmniboxElement(element)) {
    omniboxRejected = true;
  }
  return {
    via,
    focusedElement,
    element,
    omniboxRejected,
    readinessProof: looksLikeComposerElement(focusedElement) || looksLikeComposerElement(element)
      ? 'composerFocusedAndDetected'
      : 'composerDetectionDegraded'
  };
}

async function waitForComposerReady(handle, stepDelayMs, options = {}) {
  const attempts = options.timeoutAttempts || 6;
  const fallbackPoint = options.fallbackPoint;
  const preferFallback = options.preferFallback === true;
  return waitForCondition({
    step: 'focus-prompt',
    attempts,
    delayMs: stepDelayMs,
    action: async () => {
      if (!preferFallback) {
        const focused = await uiaSetFocus({ handle }, {
          automationId: 'prompt-textarea',
          className: 'ProseMirror',
          timeoutMs: 1800
        }).catch(() => null);
        if (focused?.element) {
          await clickComposerCenter(focused.element, fallbackPoint);
          return;
        }
      }
      if (fallbackPoint) {
        await clickPoint(fallbackPoint);
      }
    },
    verify: async () => {
      const element = await queryComposerElement(handle, 1200).catch(() => null);
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      const focusedLooksValid = looksLikeComposerElement(focusedElement);
      const elementLooksValid = looksLikeComposerElement(element);
      const ok = (focusedLooksValid || elementLooksValid) && !isLikelyOmniboxElement(focusedElement);
      return {
        ok,
        proof: ok ? 'composerFocusedAndDetected' : 'composerNotReadyYet',
        element,
        focusedElement,
        via: focusedLooksValid || elementLooksValid ? (preferFallback ? 'calibrated-fallback' : 'uia-focus-prompt-textarea') : null
      };
    }
  });
}

async function insertPrompt(handle, prompt, promptFocus, stepDelayMs, visualContext = null) {
  const expectedHash = hashText(prompt);
  const beforeSubmitState = await sampleVisibleSubmitState(handle);
  const coordinateFallbackPoint = pointFromElementRect(promptFocus?.focusedElement?.rect)
    || pointFromElementRect(promptFocus?.element?.rect)
    || null;

  if (!isLongPrompt(prompt)) {
    try {
      const composerTarget = await refocusComposer(handle, promptFocus, stepDelayMs);
      await clickComposerCenter(composerTarget, pointFromElementRect(composerTarget?.rect));
      await settleAfterComposerFocus(stepDelayMs);
      const valueSetResult = await uiaSetFocusedValue(prompt);
      await settleAfterPaste(stepDelayMs, prompt);
      const directValueMatch = normalizeComposerText(valueSetResult?.text) === prompt;
      if (directValueMatch) {
        const visibleProof = await waitForVisibleSendState(handle, prompt, beforeSubmitState, stepDelayMs, 'uia-focus+value-set');
        return mergePromptInsertionProof({
          baseMethod: 'uia-focus+value-set',
          expectedHash,
          promptProof: {
            text: prompt,
            element: valueSetResult?.element || composerTarget || null,
            focusedElement: valueSetResult?.element || composerTarget || null,
            proof: 'uia-focus+value-set+focused-value-pattern'
          },
          visibleProof,
          beforeSubmitState
        });
      }
    } catch {
      // Fall through to the single visible paste path.
    }
  }

  const composerTarget = await refocusComposer(handle, promptFocus, stepDelayMs)
    .catch(() => promptFocus?.focusedElement || promptFocus?.element || null);
  if (!composerTarget && !coordinateFallbackPoint) {
    throw new StepError('PROMPT_TARGET_INVALID', 'insert-prompt', 'Prompt insertion could not resolve a credible composer target.');
  }

  await clickComposerCenter(composerTarget, coordinateFallbackPoint);
  await settleAfterComposerFocus(stepDelayMs);
  if (await shouldClearComposerBeforeInsert(handle, promptFocus)) {
    await clearComposer(stepDelayMs);
  }
  await setClipboardText(prompt);
  await waitForClipboardReady(prompt, stepDelayMs);
  await pasteClipboard({ slow: true, keyDelayMs: PASTE_KEY_DELAY_MS });
  await settleAfterPaste(stepDelayMs, prompt);

  const promptProof = await waitForPromptPresence(handle, prompt, stepDelayMs, 'uia-focus+single-clipboard-paste')
    .catch(() => null);
  const bestComposerProof = promptProof?.ok
    ? promptProof
    : await readComposerProof(handle).catch(() => ({
      text: '',
      element: composerTarget || promptFocus?.element || null,
      focusedElement: composerTarget || promptFocus?.focusedElement || null,
      proof: 'uia-focus+single-clipboard-paste+composerTextPending'
    }));
  const visibleProof = await waitForVisibleSendState(
    handle,
    prompt,
    beforeSubmitState,
    stepDelayMs,
    'uia-focus+single-clipboard-paste'
  );
  const postPasteVisualProof = await collectComposerVisualPromptEvidence({
    handle,
    prompt,
    promptFocus,
    insertion: {
      composerElement: bestComposerProof?.element || composerTarget || promptFocus?.element || null,
      focusedElement: bestComposerProof?.focusedElement || composerTarget || promptFocus?.focusedElement || null
    },
    stepDelayMs,
    screenshotPath: visualContext?.screenshotPath || null,
    windowRect: visualContext?.windowRect || null,
    baseline: visualContext?.baseline || null
  }).catch(() => null);

  if (shouldUseTypedInsertFallback({
    prompt,
    promptProof: bestComposerProof,
    visibleProof,
    visualProof: postPasteVisualProof,
    composerTarget,
    promptFocus
  })) {
    await clickComposerCenter(composerTarget, coordinateFallbackPoint);
    await settleAfterComposerFocus(stepDelayMs);
    await sendText(prompt);
    await settleAfterPaste(stepDelayMs, prompt);
    const typedPromptProof = await waitForPromptPresence(handle, prompt, stepDelayMs, 'uia-focus+single-clipboard-paste+unicode-type-fallback')
      .catch(() => null);
    const typedComposerProof = typedPromptProof?.ok
      ? typedPromptProof
      : await readComposerProof(handle).catch(() => ({
        text: '',
        element: composerTarget || promptFocus?.element || null,
        focusedElement: composerTarget || promptFocus?.focusedElement || null,
        proof: 'uia-focus+single-clipboard-paste+unicode-type-fallback+composerTextPending'
      }));
    const typedVisibleProof = await waitForVisibleSendState(
      handle,
      prompt,
      beforeSubmitState,
      stepDelayMs,
      'uia-focus+single-clipboard-paste+unicode-type-fallback'
    );
    return mergePromptInsertionProof({
      baseMethod: 'uia-focus+single-clipboard-paste+unicode-type-fallback',
      expectedHash,
      promptProof: {
        text: typedComposerProof?.text || '',
        element: typedComposerProof?.element || composerTarget || null,
        focusedElement: typedComposerProof?.focusedElement || composerTarget || null,
        proof: typedComposerProof?.proof || 'uia-focus+single-clipboard-paste+unicode-type-fallback+composerTextPending'
      },
      visibleProof: typedVisibleProof,
      beforeSubmitState
    });
  }

  return mergePromptInsertionProof({
    baseMethod: 'uia-focus+single-clipboard-paste',
    expectedHash,
    promptProof: {
      text: bestComposerProof?.text || '',
      element: bestComposerProof?.element || composerTarget || null,
      focusedElement: bestComposerProof?.focusedElement || composerTarget || null,
      proof: bestComposerProof?.proof || 'uia-focus+single-clipboard-paste+composerTextPending'
    },
    visibleProof,
    beforeSubmitState
  });
}

async function waitForPromptPresence(handle, prompt, stepDelayMs, method) {
  const result = await waitForCondition({
    step: 'insert-prompt',
    attempts: 5,
    delayMs: stepDelayMs,
    verify: async () => {
      const proof = await readComposerProof(handle);
      const ok = proof.text.includes(prompt);
      return {
        ok,
        proof: ok ? `${method}+composerTextContainsPrompt` : `${method}+composerTextPending`,
        ...proof
      };
    },
    throwOnFailure: false
  });
  return result;
}

function mergePromptInsertionProof({ baseMethod, expectedHash, promptProof, visibleProof, beforeSubmitState }) {
  const visibleTransitionProven = Boolean(visibleProof?.ok);
  const methodSuffix = visibleTransitionProven ? '+visible-send-state' : '+submit-attempt-ready';
  return {
    method: `${baseMethod}${methodSuffix}`,
    expectedHash,
    actualHash: hashText(promptProof?.text || ''),
    focusedElement: visibleProof?.focusedElement || promptProof?.focusedElement || null,
    composerElement: visibleProof?.composerElement || visibleProof?.element || promptProof?.composerElement || promptProof?.element || null,
    proof: visibleProof?.proof || promptProof?.proof || `${baseMethod}+composerTextContainsPrompt`,
    composerTextSample: String(promptProof?.text || promptProof?.composerTextSample || '').slice(0, 200),
    beforeSubmitState,
    afterSubmitState: visibleProof?.submitState || beforeSubmitState,
    visibleSendStateProven: visibleTransitionProven
  };
}

async function validatePromptInput(handle, prompt, promptFocus, insertion, stepDelayMs, visualContext = null) {
  const expectedHash = hashText(prompt);
  const insertionHashMatched = insertion?.actualHash === expectedHash;
  const promptFocusLooksCredible = looksLikeComposerElement(promptFocus?.focusedElement) || looksLikeComposerElement(promptFocus?.element);
  const allowDestructiveFallback = visualContext?.allowDestructiveFallback === true;

  if (insertionHashMatched && promptFocusLooksCredible && shouldTrustFocusSafeHashProof(insertion)) {
    return {
      method: `${insertion?.method || 'unknown'}+focus-safe-hash-proof`,
      expectedHash,
      actualHash: insertion.actualHash,
      clipboardHash: expectedHash,
      validationLevel: 'exact',
      promptValidated: true,
      submitAllowed: true,
      recoveryTriggered: false,
      focusedElement: insertion.focusedElement || promptFocus?.focusedElement || null,
      composerElement: insertion.composerElement || promptFocus?.element || null,
      proof: 'promptHashMatchedAfterFocusedPaste',
      composerTextSample: String(insertion?.composerTextSample || prompt).slice(0, 200),
      beforeSubmitState: insertion?.beforeSubmitState,
      afterSubmitState: insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
      visibleSendStateProven: Boolean(insertion?.visibleSendStateProven)
    };
  }

  let verifiedProof;
  try {
    verifiedProof = await waitForCondition({
      step: 'validate-prompt',
      attempts: 3,
      delayMs: stepDelayMs,
      action: async () => {
        await focusWindow(handle).catch(() => {});
        await refocusComposer(handle, promptFocus, stepDelayMs).catch(() => {});
      },
      verify: async () => {
        const proof = await readComposerProof(handle).catch((proofError) => {
          if (proofError instanceof StepError && proofError.code === 'PROMPT_TEXT_UNAVAILABLE') {
            return {
              text: '',
              element: insertion?.composerElement || promptFocus?.element || null,
              focusedElement: insertion?.focusedElement || promptFocus?.focusedElement || null
            };
          }
          throw proofError;
        });
        ensurePromptTargetLooksCredible({
          promptFocus,
          focusedElement: proof.focusedElement,
          currentUrlAfterValidation: CHATGPT_URL,
          prompt,
          actualHash: hashText(proof.text)
        });
        const submitState = await sampleVisibleSubmitState(handle).catch(() => null);
        const promptPresent = proof.text.includes(prompt);
        const sendable = hasVisibleSendableState(submitState);
        return {
          ok: promptPresent,
          proof: promptPresent
            ? (sendable ? 'promptPresentComposerCredibleAndSendable' : 'composerContainsPromptButNotSendable')
            : 'composerTextStillHydrating',
          ...proof,
          submitState: submitState || insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
          sendTransitionProven: Boolean(insertion?.visibleSendStateProven)
        };
      },
      failureCode: 'PROMPT_VALIDATION_FAILED',
      failureMessage: insertion?.proof === 'coordinateClipboardRoundtripUnconfirmed'
        ? 'Prompt could not be confirmed after coordinate fallback. Recalibrate promptInput and retry.'
        : 'Prompt was not confirmed in the ChatGPT composer.'
    });
  } catch (error) {
    if (error instanceof StepError && error.code === 'PROMPT_VALIDATION_FAILED') {
      const visualProof = await collectComposerVisualPromptEvidence({
        handle,
        prompt,
        promptFocus,
        insertion,
        stepDelayMs,
        screenshotPath: visualContext?.screenshotPath,
        windowRect: visualContext?.windowRect || null,
        baseline: visualContext?.baseline || null
      }).catch(() => null);
      if (visualProof?.ok) {
        return {
          method: `${insertion?.method || 'unknown'}+composer-visual-proof`,
          expectedHash,
          actualHash: insertion?.actualHash || '',
          clipboardHash: insertion?.actualHash || '',
          validationLevel: 'visual',
          promptValidated: true,
          submitAllowed: true,
          recoveryTriggered: false,
          focusedElement: visualProof.focusedElement || insertion?.focusedElement || promptFocus?.focusedElement || null,
          composerElement: visualProof.composerElement || insertion?.composerElement || promptFocus?.element || null,
          proof: visualProof.proof,
          composerTextSample: String(visualProof.composerOcrTextSample || insertion?.composerTextSample || '').slice(0, 200),
          beforeSubmitState: insertion?.beforeSubmitState,
          afterSubmitState: visualProof.submitState || insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
          visibleSendStateProven: Boolean(visualProof?.submitState?.sendable || insertion?.visibleSendStateProven),
          debugArtifacts: visualProof.debugArtifacts || null
        };
      }
      if (allowDestructiveFallback) {
        const recovery = await recoverPromptWithSlowClipboardRoundtrip(handle, prompt, promptFocus, stepDelayMs).catch(() => null);
        if (recovery?.ok && hasVisibleSendableState(recovery.submitState)) {
          return {
            method: `${insertion?.method || 'unknown'}+slow-clipboard-roundtrip-recovery`,
            expectedHash,
            actualHash: expectedHash,
            clipboardHash: expectedHash,
            validationLevel: 'exact',
            promptValidated: true,
            submitAllowed: true,
            recoveryTriggered: false,
            focusedElement: recovery.focusedElement,
            composerElement: recovery.composerElement,
            proof: recovery.proof,
            composerTextSample: prompt.slice(0, 200),
            beforeSubmitState: insertion?.beforeSubmitState,
            afterSubmitState: recovery.submitState || insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
            visibleSendStateProven: Boolean(recovery?.submitState?.sendable || insertion?.visibleSendStateProven)
          };
        }
      }
      throw new StepError(
        error.code,
        error.step,
        error.message,
        {
          ...(error.details || {}),
          debugArtifacts: visualProof?.debugArtifacts || null,
          validationProof: visualProof?.proof || insertion?.proof || 'promptValidationFailed',
          validationLevel: visualProof?.validationLevel || 'none',
          submitAllowed: false
        }
      );
    }
    throw error;
  }

  return {
    method: `${insertion?.method || 'unknown'}+light-composer-present-proof`,
    expectedHash,
    actualHash: hashText(verifiedProof.text),
    clipboardHash: expectedHash,
    validationLevel: 'exact',
    promptValidated: true,
    submitAllowed: true,
    recoveryTriggered: false,
    focusedElement: verifiedProof.focusedElement,
    composerElement: verifiedProof.element,
    proof: verifiedProof.proof,
    composerTextSample: verifiedProof.text.slice(0, 200),
    beforeSubmitState: insertion?.beforeSubmitState,
    afterSubmitState: verifiedProof.submitState,
    visibleSendStateProven: Boolean(verifiedProof.sendTransitionProven)
  };
}

function shouldTrustFocusSafeHashProof(insertion) {
  if (!insertion) return false;
  if (insertion.visibleSendStateProven) return true;
  if (!hasVisibleSendableState(insertion.afterSubmitState) && !hasVisibleSendableState(insertion.beforeSubmitState)) {
    return false;
  }

  const method = String(insertion.method || '').toLowerCase();
  const proof = String(insertion.proof || '').toLowerCase();
  const strongSignals = [
    'composertextcontainsprompt',
    'coordinatecomposerproofcontainsprompt',
    'coordinateclipboardroundtripmatchedprompt',
    'recoveredbyslowclipboardroundtrip',
    'clipboard-roundtrip',
    'roundtrip',
    'composer-proof'
  ];

  if (strongSignals.some((signal) => method.includes(signal) || proof.includes(signal))) {
    return true;
  }

  return !(method.includes('value-set') || proof.includes('value-set'));
}

async function recoverPromptWithSlowClipboardRoundtrip(handle, prompt, promptFocus, stepDelayMs) {
  const composerTarget = await refocusComposer(handle, promptFocus, stepDelayMs)
    .catch(() => promptFocus?.focusedElement || promptFocus?.element || null);
  if (!composerTarget) {
    return { ok: false };
  }

  await focusWindow(handle).catch(() => {});
  await clickComposerCenter(composerTarget, pointFromElementRect(composerTarget?.rect));
  await settleAfterComposerFocus(stepDelayMs);
  await setClipboardText(prompt);
  await delay(stepDelayMs);
  await pasteClipboard({ slow: true, keyDelayMs: PASTE_KEY_DELAY_MS });
  await settleAfterPaste(stepDelayMs, prompt);
  await sendKeys('a', ['ctrl']);
  await settleAfterSelectAll(stepDelayMs);
  const sentinel = `__codex_slow_roundtrip_probe_${crypto.randomUUID()}__`;
  await setClipboardText(sentinel);
  await delay(stepDelayMs);
  await sendKeys('c', ['ctrl']);
  await settleAfterCopy(stepDelayMs);
  const clipboard = await getClipboardText();
  const copied = normalizeComposerText(clipboard.text);
  const submitState = await sampleVisibleSubmitState(handle).catch(() => null);
  const copiedFromComposer = copied !== sentinel && copied === prompt;
  const sendable = hasVisibleSendableState(submitState);

  return {
    ok: copiedFromComposer && sendable,
    focusedElement: composerTarget,
    composerElement: composerTarget,
    proof: copiedFromComposer
      ? (sendable ? 'recoveredBySlowClipboardRoundtrip' : 'slowClipboardRoundtripCopiedPromptButNotSendable')
      : 'slowClipboardRoundtripStillUnconfirmed',
    copied,
    submitState: submitState ? {
      submitButton: submitState.submitButton || null,
      stopButton: submitState.stopButton || null,
      sendable: Boolean(submitState.sendable),
      stopVisible: Boolean(submitState.stopVisible),
      submitSignature: submitState.submitSignature || '',
      stopSignature: submitState.stopSignature || ''
    } : null
  };
}

async function refocusComposer(handle, promptFocus, stepDelayMs) {
  const result = await waitForCondition({
    step: 'refocus-composer',
    attempts: 4,
    delayMs: stepDelayMs,
    action: async () => {
      await uiaSetFocus({ handle }, {
        automationId: 'prompt-textarea',
        timeoutMs: 1800
      }).catch(() => null);
    },
    verify: async () => {
      const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
      if (isLikelyOmniboxElement(focusedElement)) {
        return {
          ok: false,
          proof: 'focusedElementRelapsedIntoOmnibox',
          focusedElement
        };
      }
      const ok = looksLikeComposerElement(focusedElement);
      return {
        ok,
        proof: ok ? 'composerRefocused' : 'composerRefocusPending',
        focusedElement
      };
    },
    failureCode: 'PROMPT_TARGET_INVALID',
    failureMessage: 'Focused element is not the ChatGPT composer after UIA refocus.',
    failureDetails: {
      promptFocus: promptFocus?.element || null
    }
  });
  return result.focusedElement;
}

async function clearComposer(stepDelayMs) {
  const clearedViaUia = await uiaSetFocusedValue('').then(() => true).catch(() => false);
  if (!clearedViaUia) {
    await sendKeys('a', ['ctrl']);
  }
  await delay(stepDelayMs);
}

async function waitForClipboardReady(expectedText, stepDelayMs) {
  const expectedHash = hashText(expectedText);
  await waitForCondition({
    step: 'clipboard-ready',
    attempts: 4,
    delayMs: Math.max(120, stepDelayMs),
    verify: async () => {
      const clipboardText = await getClipboardText().catch(() => '');
      return {
        ok: hashText(clipboardText) === expectedHash,
        proof: 'clipboardHashPending'
      };
    },
    throwOnFailure: false
  });
}

async function shouldClearComposerBeforeInsert(handle, promptFocus) {
  const focusedElement = promptFocus?.focusedElement || promptFocus?.element || null;
  try {
    const proof = await readComposerProof(handle);
    const text = normalizeComposerText(proof?.text);
    if (!text) return false;
    if (looksLikeComposerPlaceholderText(text, proof?.element || focusedElement)) return false;
    return !looksLikeVisualComposerPlaceholder(text);
  } catch {
    return false;
  }
}

function shouldUseTypedInsertFallback({
  prompt,
  promptProof = null,
  visibleProof = null,
  visualProof = null,
  composerTarget = null,
  promptFocus = null
}) {
  if (!String(prompt || '').trim()) return false;
  const focusCredible = hasCredibleComposerFocus({
    focusedElement: promptProof?.focusedElement || composerTarget || promptFocus?.focusedElement || null,
    element: promptProof?.element || composerTarget || promptFocus?.element || null
  });
  if (!focusCredible) return false;
  const normalizedText = normalizeComposerText(promptProof?.text);
  const textAlreadyPresent = normalizedText.includes(prompt);
  if (textAlreadyPresent) return false;
  if (hasVisibleSendableState(visibleProof?.submitState || null) || visibleProof?.ok) return false;
  if (visualProof?.ok === true) return false;
  if (visualProof?.proof) {
    return visualProof.proof === 'composerVisualUnchanged'
      || visualProof.proof === 'composerVisualStillPlaceholder';
  }
  return prompt.length <= 240 && (
    !normalizedText
    || looksLikeComposerPlaceholderText(normalizedText, promptProof?.element || composerTarget || promptFocus?.element || null)
    || looksLikeVisualComposerPlaceholder(normalizedText)
  );
}

async function settleAfterComposerFocus(stepDelayMs) {
  await delay(Math.max(stepDelayMs, COMPOSER_FOCUS_SETTLE_MS));
}

function isLongPrompt(prompt) {
  const text = String(prompt || '');
  return text.length > 800 || text.includes('\n');
}

async function settleAfterPaste(stepDelayMs, prompt = '') {
  const minDelay = isLongPrompt(prompt) ? LONG_PROMPT_PASTE_SETTLE_MS : POST_PASTE_SETTLE_MS;
  await delay(Math.max(stepDelayMs * 2, minDelay));
}

async function settleAfterSelectAll(stepDelayMs) {
  await delay(Math.max(stepDelayMs, SELECT_ALL_SETTLE_MS));
}

async function settleAfterCopy(stepDelayMs) {
  await delay(Math.max(stepDelayMs * 2, CLIPBOARD_COPY_SETTLE_MS));
}

async function clickComposerCenter(element, fallbackPoint) {
  const rect = element?.rect;
  if (rect?.width > 0 && rect?.height > 0) {
    await clickPoint({ x: rect.x + (rect.width / 2), y: rect.y + Math.max(12, Math.min(rect.height / 2, rect.height - 4)) });
    return;
  }
  await clickPoint(fallbackPoint);
}

async function clickComposerEnd(element, fallbackPoint) {
  const rect = element?.rect;
  if (rect?.width > 0 && rect?.height > 0) {
    await clickPoint({
      x: rect.x + Math.max(24, rect.width - 32),
      y: rect.y + Math.max(12, Math.min(rect.height / 2, rect.height - 4))
    });
    return;
  }
  await clickPoint(fallbackPoint);
}

function pointFromElementRect(rect) {
  if (!rect?.width || !rect?.height) return null;
  return {
    x: rect.x + (rect.width / 2),
    y: rect.y + (rect.height / 2)
  };
}

function looksLikeComposerPlaceholderText(text, element) {
  const normalizedText = normalizeComposerText(text).toLowerCase();
  const normalizedName = normalizeComposerText(element?.name).toLowerCase();
  if (!normalizedText) return false;
  return Boolean(normalizedName) && normalizedText === normalizedName;
}

async function readComposerProof(handle, { allowClipboardFallback = false } = {}) {
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);

  if (looksLikeComposerElement(focusedElement)) {
    const focusedComposer = await uiaReadFocusedText().catch(() => null);
    if (
      focusedComposer?.element
      && looksLikeComposerElement(focusedComposer.element)
      && !looksLikeComposerPlaceholderText(focusedComposer.text, focusedComposer.element)
    ) {
      return {
        element: focusedComposer.element,
        focusedElement: focusedComposer.element,
        text: normalizeComposerText(focusedComposer.text)
      };
    }
  }

  try {
    const composer = await uiaReadText({ handle }, {
      automationId: 'prompt-textarea',
      timeoutMs: 1500
    });
    if (looksLikeComposerPlaceholderText(composer?.text, composer?.element)) {
      throw new StepError('PROMPT_TEXT_PLACEHOLDER', 'read-composer-proof', 'UIA text read resolved only the composer placeholder.');
    }
    return {
      element: composer.element,
      focusedElement,
      text: normalizeComposerText(composer.text)
    };
  } catch {
    if (!looksLikeComposerElement(focusedElement)) {
      throw new StepError('PROMPT_TARGET_INVALID', 'read-composer-proof', 'Focused element is not the ChatGPT composer while reading input proof.');
    }
    if (!allowClipboardFallback) {
      throw new StepError('PROMPT_TEXT_UNAVAILABLE', 'read-composer-proof', 'UIA text read did not confirm the composer contents without destructive fallback.');
    }

    const priorClipboard = await getClipboardText().catch(() => ({ text: '' }));
    const sentinel = `__codex_composer_probe_${crypto.randomUUID()}__`;
    await setClipboardText(sentinel).catch(() => {});
    await clickComposerCenter(focusedElement, pointFromElementRect(focusedElement?.rect)).catch(() => {});
    await delay(SELECT_ALL_SETTLE_MS);
    await sendKeys('a', ['ctrl']);
    await delay(SELECT_ALL_SETTLE_MS);
    await sendKeys('c', ['ctrl']);
    await delay(CLIPBOARD_COPY_SETTLE_MS);
    const clipboard = await getClipboardText();
    await setClipboardText(String(priorClipboard?.text || '')).catch(() => {});
    const copiedText = normalizeComposerText(clipboard.text);

    return {
      element: focusedElement,
      focusedElement,
      text: copiedText === sentinel ? '' : copiedText
    };
  }
}

function buildCoordinateInsertionProof({ prompt, composerText, copiedText, composerElement = null, focusedElement = null }) {
  const normalizedComposerText = normalizeComposerText(composerText);
  const normalizedCopiedText = normalizeComposerText(copiedText);

  if (normalizedComposerText.includes(prompt)) {
    return {
      method: 'coordinate-click+clipboard-paste+composer-proof',
      actualHash: hashText(normalizedComposerText),
      focusedElement,
      composerElement,
      proof: 'coordinateComposerProofContainsPrompt',
      composerTextSample: normalizedComposerText.slice(0, 200)
    };
  }

  if (normalizedCopiedText === prompt) {
    return {
      method: 'coordinate-click+clipboard-paste+clipboard-roundtrip',
      actualHash: hashText(normalizedCopiedText),
      focusedElement,
      composerElement,
      proof: 'coordinateClipboardRoundtripMatchedPrompt',
      composerTextSample: normalizedCopiedText.slice(0, 200)
    };
  }

  return {
    method: 'coordinate-click+clipboard-paste+degraded-proof',
    actualHash: hashText(normalizedCopiedText),
    focusedElement,
    composerElement,
    proof: 'coordinateClipboardRoundtripUnconfirmed',
    composerTextSample: String(normalizedComposerText || normalizedCopiedText).slice(0, 200)
  };
}

async function insertPromptViaCoordinateProof(handle, prompt, promptFocus, fallbackPoint, stepDelayMs) {
  await delay(stepDelayMs * 2);
  const composerTarget = await refocusComposer(handle, promptFocus, stepDelayMs)
    .catch(() => promptFocus?.focusedElement || promptFocus?.element || null);
  if (composerTarget || fallbackPoint) {
    await clickComposerCenter(composerTarget, fallbackPoint);
  } else {
    throw new StepError('PROMPT_TARGET_INVALID', 'insert-prompt', 'Coordinate fallback could not resolve a credible prompt target.');
  }
  await delay(stepDelayMs * 2);
  await sendKeys('a', ['ctrl']);
  await settleAfterSelectAll(stepDelayMs);
  await setClipboardText(prompt);
  await delay(stepDelayMs);
  await pasteClipboard({ slow: true, keyDelayMs: PASTE_KEY_DELAY_MS });
  await settleAfterPaste(stepDelayMs, prompt);
  const composerProof = await readComposerProof(handle).catch(() => null);
  const focusedElement = composerProof?.focusedElement
    || await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  return buildCoordinateInsertionProof({
    prompt,
    composerText: composerProof?.text || '',
    copiedText: '',
    composerElement: composerProof?.element || null,
    focusedElement: focusedElement || composerTarget || null
  });
}

async function collectComposerVisualBaseline({
  handle,
  screenshotPath,
  promptFocus,
  prompt,
  stepDelayMs,
  windowRect = null
}) {
  if (!String(prompt || '').trim() || !screenshotPath) {
    return null;
  }

  const composerElement = promptFocus?.focusedElement || promptFocus?.element || null;
  if (!looksLikeComposerElement(composerElement) || !composerElement?.rect) {
    return null;
  }

  const snapshot = await captureComposerVisualSnapshot({
    handle,
    composerElement,
    stepDelayMs,
    windowRect,
    windowScreenshotPath: resolveSiblingArtifactPath(screenshotPath, '.composer-pre-insert-window.png'),
    composerScreenshotPath: resolveSiblingArtifactPath(screenshotPath, '.composer-pre-insert.png')
  });

  return {
    composerHash: snapshot.composerHash,
    windowRect: snapshot.windowRect,
    composerElement: snapshot.composerElement,
    focusedElement: snapshot.focusedElement,
    debugArtifacts: {
      preInsertWindowPath: snapshot.windowScreenshotPath,
      preInsertComposerPath: snapshot.composerScreenshotPath
    }
  };
}

async function collectComposerVisualPromptEvidence({
  handle,
  prompt,
  promptFocus,
  insertion,
  stepDelayMs,
  screenshotPath,
  windowRect = null,
  baseline = null
}) {
  if (!screenshotPath) {
    return {
      ok: false,
      proof: 'composerVisualProofUnavailable',
      validationLevel: 'none',
      debugArtifacts: null
    };
  }

  const composerElement = await queryComposerElement(handle, 1200).catch(() => null)
    || insertion?.composerElement
    || insertion?.focusedElement
    || promptFocus?.focusedElement
    || promptFocus?.element
    || null;
  if (!looksLikeComposerElement(composerElement) || !composerElement?.rect) {
    return {
      ok: false,
      proof: 'composerVisualTargetUnavailable',
      validationLevel: 'none',
      debugArtifacts: null
    };
  }

  const snapshot = await captureComposerVisualSnapshot({
    handle,
    composerElement,
    stepDelayMs,
    windowRect: windowRect || baseline?.windowRect || null,
    windowScreenshotPath: resolveSiblingArtifactPath(screenshotPath, '.composer-validate-window.png'),
    composerScreenshotPath: resolveSiblingArtifactPath(screenshotPath, '.composer-validate.png')
  });
  const submitState = await sampleVisibleSubmitState(handle).catch(() => null);
  const assessment = assessComposerVisualPromptEvidence({
    prompt,
    composerOcrTextSample: snapshot.composerOcrTextSample,
    normalizedOcrText: snapshot.normalizedOcrText,
    baselineHash: baseline?.composerHash || '',
    composerHash: snapshot.composerHash,
    focusCredible: hasCredibleComposerFocus({
      focusedElement: snapshot.focusedElement || composerElement,
      element: snapshot.composerElement || composerElement
    })
  });
  const debugArtifacts = {
    windowScreenshotPath: snapshot.windowScreenshotPath,
    composerScreenshotPath: snapshot.composerScreenshotPath,
    postInsertWindowPath: snapshot.windowScreenshotPath,
    postInsertComposerPath: snapshot.composerScreenshotPath,
    composerOcrTextSample: snapshot.composerOcrTextSample,
    validationProof: assessment.proof,
    validationLevel: assessment.validationLevel
  };

  return {
    ok: assessment.ok,
    proof: assessment.proof,
    validationLevel: assessment.validationLevel,
    markersMatched: assessment.markersMatched,
    requiredMatches: assessment.requiredMatches,
    submitState,
    focusedElement: snapshot.focusedElement || insertion?.focusedElement || promptFocus?.focusedElement || null,
    composerElement: snapshot.composerElement || composerElement,
    composerOcrTextSample: snapshot.composerOcrTextSample,
    debugArtifacts
  };
}

function assessComposerVisualPromptEvidence({
  prompt,
  composerOcrTextSample = '',
  normalizedOcrText = '',
  baselineHash = '',
  composerHash = '',
  focusCredible = false
}) {
  const markerSpec = buildPromptMarkers(prompt);
  const markersMatched = countPromptMarkers(normalizedOcrText, markerSpec.markers);
  const placeholderOnly = looksLikeVisualComposerPlaceholder(composerOcrTextSample);
  const visuallyChanged = Boolean(baselineHash) && baselineHash !== composerHash;
  const hasReadableNonPlaceholderText = !placeholderOnly && normalizeMarkerText(composerOcrTextSample).length >= 12;
  const markersMatchedProof = markersMatched >= markerSpec.requiredMatches;
  const changedWithoutPlaceholder = !markersMatchedProof && visuallyChanged && hasReadableNonPlaceholderText && focusCredible;
  const ok = markersMatchedProof || changedWithoutPlaceholder;
  const proof = markersMatchedProof
    ? 'composerVisualMarkersMatched'
    : (changedWithoutPlaceholder
      ? 'composerVisualChangedWithoutPlaceholder'
      : (placeholderOnly
        ? 'composerVisualStillPlaceholder'
        : (visuallyChanged ? 'composerVisualChangedMarkersMissing' : 'composerVisualUnchanged')));

  return {
    ok,
    proof,
    validationLevel: ok ? 'visual' : 'none',
    markersMatched,
    requiredMatches: markerSpec.requiredMatches
  };
}

async function captureComposerVisualSnapshot({
  handle,
  composerElement,
  stepDelayMs,
  windowRect = null,
  windowScreenshotPath,
  composerScreenshotPath
}) {
  const focusedElement = await uiaGetFocusedElement().then((result) => result.element).catch(() => null);
  const liveComposerElement = await queryComposerElement(handle, 900).catch(() => null) || composerElement;
  const targetWindowRect = windowRect || await getWindowRect(handle).then((result) => result.rect).catch(() => null);
  if (!liveComposerElement?.rect || !targetWindowRect) {
    throw new StepError(
      ERROR_CODES.SCREENSHOT_FAILED,
      'capture-composer-visual-proof',
      'Composer visual proof requires a visible composer rect and window bounds.',
      {
        liveComposerElement,
        targetWindowRect
      }
    );
  }

  const screenshotCapture = await captureStrictProofScreenshot(handle, windowScreenshotPath, stepDelayMs);
  const cropRect = computeComposerCropRect(targetWindowRect, liveComposerElement.rect);
  const cropResult = await cropImage(screenshotCapture.screenshotPath, cropRect, composerScreenshotPath);
  const ocrResult = await ocrImageText(cropResult.imagePath).catch(() => ({ text: '' }));
  const composerOcrTextSample = String(ocrResult?.text || '').slice(0, 240);

  return {
    windowScreenshotPath: screenshotCapture.screenshotPath,
    composerScreenshotPath: path.resolve(cropResult.imagePath || composerScreenshotPath),
    composerHash: await hashFile(cropResult.imagePath || composerScreenshotPath).catch(() => ''),
    composerOcrTextSample,
    normalizedOcrText: normalizeMarkerText(composerOcrTextSample),
    windowRect: screenshotCapture.rect || targetWindowRect,
    cropRect: cropResult.rect || cropRect,
    composerElement: liveComposerElement,
    focusedElement
  };
}

function computeComposerCropRect(windowRect = {}, composerRect = {}) {
  const relativeX = Math.max(0, Math.round(Number(composerRect.x || 0) - Number(windowRect.x || 0) - COMPOSER_CROP_PADDING_X));
  const relativeY = Math.max(0, Math.round(Number(composerRect.y || 0) - Number(windowRect.y || 0) - COMPOSER_CROP_PADDING_TOP));
  const maxWidth = Math.max(0, Math.round(Number(windowRect.width || 0) - relativeX));
  const maxHeight = Math.max(0, Math.round(Number(windowRect.height || 0) - relativeY));
  const desiredWidth = Math.max(0, Math.round(Number(composerRect.width || 0) + (COMPOSER_CROP_PADDING_X * 2)));
  const desiredHeight = Math.max(
    COMPOSER_CROP_MIN_HEIGHT,
    Math.round(Number(composerRect.height || 0) + COMPOSER_CROP_PADDING_TOP + COMPOSER_CROP_PADDING_BOTTOM)
  );

  return {
    x: relativeX,
    y: relativeY,
    width: Math.max(1, Math.min(maxWidth, desiredWidth)),
    height: Math.max(1, Math.min(maxHeight, desiredHeight))
  };
}

function buildPromptMarkers(prompt) {
  const lines = String(prompt || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => normalizeMarkerText(line))
    .filter(Boolean);
  const normalizedPrompt = normalizeMarkerText(prompt);

  if (lines.length <= 1 && normalizedPrompt) {
    return {
      requiredMatches: 1,
      markers: [normalizedPrompt.slice(0, Math.min(normalizedPrompt.length, 32))]
    };
  }

  const firstLine = lines[0] || '';
  const lastLine = lines[lines.length - 1] || '';
  const longestLine = lines.slice().sort((left, right) => right.length - left.length)[0] || '';
  const markers = [
    firstLine.slice(0, 48),
    lastLine.slice(Math.max(0, lastLine.length - 48)),
    longestLine.slice(0, 48)
  ]
    .map((marker) => marker.trim())
    .filter((marker, index, array) => marker.length >= 12 && array.indexOf(marker) === index);

  return {
    requiredMatches: Math.min(2, markers.length || 1),
    markers: markers.length ? markers : [normalizedPrompt.slice(0, Math.min(normalizedPrompt.length, 48))]
  };
}

function countPromptMarkers(text, markers = []) {
  const haystack = normalizeMarkerText(text);
  return markers.filter((marker) => marker && haystack.includes(normalizeMarkerText(marker))).length;
}

function normalizeMarkerText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function looksLikeVisualComposerPlaceholder(text) {
  const normalized = normalizeMarkerText(text);
  if (!normalized) {
    return true;
  }
  return [
    'chatgpt와 채팅',
    'message chatgpt',
    '메시지 chatgpt',
    '무엇이든 물어보세요'
  ].some((placeholder) => normalized === placeholder || normalized.includes(placeholder));
}

function resolveSiblingArtifactPath(basePath, suffix) {
  const parsed = path.parse(path.resolve(basePath));
  return path.join(parsed.dir, `${parsed.name}${suffix}`);
}

function mergeDebugArtifacts(base = null, extra = null) {
  const merged = {
    ...(base || {}),
    ...(extra || {})
  };
  const normalized = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
  return Object.keys(normalized).length ? normalized : null;
}

function extractDebugArtifactsFromError(error) {
  const details = error?.details || {};
  const explicit = mergeDebugArtifacts(null, details.debugArtifacts || null);
  if (explicit) {
    return explicit;
  }

  if (error?.code === ERROR_CODES.STRICT_PROOF_FAILED) {
    return mergeDebugArtifacts(null, {
      windowScreenshotPath: details.screenshotPath || details.preSubmitBaseline?.screenshotPath || null,
      submitProbeWindowPath: details.screenshotPath || details.preSubmitBaseline?.screenshotPath || null,
      composerScreenshotPath: null,
      composerOcrTextSample: details.ocrProof?.ocrText?.slice(0, 240) || details.preSubmitBaseline?.ocrTextSample || null,
      validationProof: details.postSubmitAssessment?.proof || 'strictProofFailed',
      validationLevel: 'none'
    });
  }

  return null;
}

async function attemptBoundedVisiblePasteRecovery({
  handle,
  prompt,
  promptFocus,
  insertion,
  stepDelayMs,
  screenshotPath,
  windowRect = null,
  baseline = null,
  error,
  attemptIndex = 2,
  logEvent = async () => {},
  syncAutomationContext = async () => {}
}) {
  if (!isSoftRecoveryEligible(error)) {
    return { ok: false };
  }

  await syncAutomationContext('bounded-submit-recovery', phaseForDesktopStep(error?.step || 'validate-prompt'), attemptIndex).catch(() => {});
  const refocusedElement = await refocusComposer(handle, promptFocus, stepDelayMs)
    .catch(() => promptFocus?.focusedElement || promptFocus?.element || null);
  const visualProof = await collectComposerVisualPromptEvidence({
    handle,
    prompt,
    promptFocus: {
      ...promptFocus,
      focusedElement: refocusedElement || promptFocus?.focusedElement || null
    },
    insertion,
    stepDelayMs,
    screenshotPath,
    windowRect,
    baseline
  }).catch(() => null);
  const submitState = visualProof?.submitState || await sampleVisibleSubmitState(handle).catch(() => null);
  const focusCredible = hasCredibleComposerFocus({
    focusedElement: visualProof?.focusedElement || refocusedElement || promptFocus?.focusedElement || null,
    element: visualProof?.composerElement || refocusedElement || promptFocus?.element || null
  });
  const nonPlaceholderVisual = Boolean(visualProof?.composerOcrTextSample)
    && !looksLikeVisualComposerPlaceholder(visualProof.composerOcrTextSample);
  const promptValidated = visualProof?.ok === true;
  const submitAllowed = focusCredible && (
    promptValidated
    || (hasVisibleSendableState(submitState) && nonPlaceholderVisual)
  );
  const debugArtifacts = mergeDebugArtifacts(
    visualProof?.debugArtifacts || null,
    {
      submitProbeWindowPath: visualProof?.debugArtifacts?.postInsertWindowPath
        || visualProof?.debugArtifacts?.windowScreenshotPath
        || null,
      validationProof: visualProof?.proof || error?.details?.validationProof || error?.code || 'boundedRecoveryUnproven',
      validationLevel: promptValidated ? 'visual' : 'none'
    }
  );

  await logEvent({
    step: 'bounded-submit-recovery',
    phase: phaseForDesktopStep(error?.step || 'validate-prompt'),
    attemptIndex,
    recovery: {
      triggerCode: error?.code || 'UNEXPECTED_ERROR',
      triggerStep: error?.step || 'unknown',
      promptValidated,
      submitAllowed,
      focusCredible,
      visualProof: visualProof?.proof || 'none',
      submitState,
      debugArtifacts
    }
  }).catch(() => {});

  if (!submitAllowed) {
    return { ok: false, debugArtifacts };
  }

  return {
    ok: true,
    validation: {
      method: `${insertion?.method || 'unknown'}+bounded-visible-recovery`,
      expectedHash: hashText(prompt),
      actualHash: promptValidated ? hashText(prompt) : (insertion?.actualHash || ''),
      clipboardHash: promptValidated ? hashText(prompt) : (insertion?.actualHash || ''),
      validationLevel: promptValidated ? 'visual' : 'none',
      promptValidated,
      submitAllowed,
      recoveryTriggered: true,
      focusedElement: visualProof?.focusedElement || refocusedElement || promptFocus?.focusedElement || null,
      composerElement: visualProof?.composerElement || refocusedElement || promptFocus?.element || null,
      proof: promptValidated ? visualProof.proof : 'visibleSendableRecoveryHint',
      composerTextSample: String(visualProof?.composerOcrTextSample || insertion?.composerTextSample || '').slice(0, 200),
      beforeSubmitState: insertion?.beforeSubmitState || null,
      afterSubmitState: submitState || insertion?.afterSubmitState || insertion?.beforeSubmitState || null,
      visibleSendStateProven: Boolean(submitState?.sendable),
      debugArtifacts
    }
  };
}

function isSoftRecoveryEligible(error) {
  const code = String(error?.code || '').toUpperCase();
  const step = String(error?.step || '').toLowerCase();
  if (code === 'PROMPT_VALIDATION_FAILED' || code === 'PROMPT_TEXT_UNAVAILABLE' || code === 'SUBMIT_PRECHECK_FAILED') {
    return true;
  }
  return code === 'SUBMIT_FAILED' && step === 'submit-prompt';
}

function classifyDesktopFailure(error, lastStep = '') {
  const code = String(error?.code || '').toUpperCase();
  const step = String(lastStep || error?.step || '').toLowerCase();

  if (code === 'PROMPT_VALIDATION_FAILED' || step === 'validate-prompt') return 'prompt-validation-failed';
  if (code === 'SUBMIT_PRECHECK_FAILED' || step === 'submit-prompt-precheck') return 'submit-gate-failed';
  if (code === ERROR_CODES.STRICT_PROOF_FAILED) return 'strict-proof-failed';
  if (code === ERROR_CODES.WINDOW_SURFACE_FAILED) return 'surface-failed';
  if (code === ERROR_CODES.NEW_CHAT_FAILED) return 'new-chat-failed';
  if (code === ERROR_CODES.MODE_SELECTION_FAILED) return 'mode-selection-failed';
  if (code === 'WORKER_TIMEOUT' || code === 'WINDOWS_AUTOMATION_FAILED') return 'worker-failed';
  if (code === ERROR_CODES.SCREENSHOT_FAILED) return 'screenshot-failed';
  return 'unexpected-failure';
}

function phaseForDesktopStep(step = '') {
  const value = String(step || '').toLowerCase();
  if (!value || value === 'init') return 'init';
  if (['select-window'].includes(value)) return 'seed-window';
  if (['create-surface', 'focus-window', 'normalize-window', 'verify-fresh-surface'].includes(value)) return 'surface-create';
  if (['navigate-chatgpt', 'verify-url-after-navigation', 'dismiss-interstitials', 'normalize-zoom', 'start-new-chat', 'select-mode'].includes(value)) return 'navigate';
  if (['focus-prompt', 'capture-composer-baseline', 'refocus-composer'].includes(value)) return 'prompt-focus';
  if (['insert-prompt'].includes(value)) return 'prompt-insert';
  if (['validate-prompt', 'bounded-submit-recovery'].includes(value)) return 'prompt-validate';
  if (['capture-strict-baseline', 'strict-pre-submit-baseline', 'submit-prompt-precheck'].includes(value)) return 'submit-gate';
  if (['submit-prompt', 'visible-send-state'].includes(value)) return 'submit-attempt';
  if (['strict-submit-proof', 'capture-screenshot'].includes(value)) return 'strict-proof';
  if (value === 'failure') return 'failure';
  return 'misc';
}

function normalizeComposerText(text) {
  return String(text || '').replace(/\r/g, '').replace(/\uFFFC/g, '').trim();
}

function normalizePromptForSubmission(prompt) {
  return String(prompt || '').replace(/\r/g, '').replace(/\uFFFC/g, '').trimEnd();
}

function resolveStrictBaselineScreenshotPath(screenshotPath) {
  const parsed = path.parse(path.resolve(screenshotPath));
  return path.join(parsed.dir, `${parsed.name}.pre-submit${parsed.ext || '.png'}`);
}

async function hashFile(filePath) {
  const buffer = await readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function readWindowTitle(handle) {
  const windows = await listChromeWindows();
  const match = windows.find((window) => String(window.handle) === String(handle));
  return String(match?.title || '').trim();
}

function assessStrictPreSubmitSurface({ currentUrl, windowTitle = '', ocrText = '' }) {
  const resolvedUrl = isChatGptUrl(currentUrl) ? currentUrl : '';
  const currentConversationUrl = isChatGptConversationUrl(resolvedUrl) ? resolvedUrl : '';
  const ocrConversationUrl = extractConversationUrlFromOcrText(ocrText);
  const conversationUrl = currentConversationUrl || ocrConversationUrl;
  const conversationId = extractChatGptConversationId(conversationUrl);
  const titleLooksFresh = isExactChatGptShellTitle(windowTitle);
  const homeUrlConfirmed = isChatGptHomeUrl(resolvedUrl);
  const ok = !conversationId && (homeUrlConfirmed || titleLooksFresh);

  return {
    ok,
    proof: conversationId
      ? 'preSubmitConversationAlreadyVisible'
      : (homeUrlConfirmed ? 'preSubmitHomeUrlConfirmed' : (titleLooksFresh ? 'preSubmitExactShellTitleConfirmed' : 'preSubmitFreshSurfaceUnproven')),
    currentUrl: resolvedUrl,
    conversationUrl,
    conversationId,
    titleLooksFresh,
    homeUrlConfirmed
  };
}

function assessStrictPostSubmitEvidence({
  preSubmitConversationId = '',
  conversationUrl = '',
  preSubmitScreenshotHash = '',
  postSubmitScreenshotHash = ''
}) {
  const conversationId = extractChatGptConversationId(conversationUrl);
  if (!conversationId) {
    return { ok: false, proof: 'postSubmitConversationUrlMissing', conversationId };
  }
  if (preSubmitConversationId && conversationId === preSubmitConversationId) {
    return { ok: false, proof: 'postSubmitConversationUrlUnchanged', conversationId };
  }
  if (preSubmitScreenshotHash && postSubmitScreenshotHash && preSubmitScreenshotHash === postSubmitScreenshotHash) {
    return { ok: false, proof: 'postSubmitScreenshotUnchanged', conversationId };
  }
  return { ok: true, proof: 'postSubmitConversationUrlNewAndScreenshotChanged', conversationId };
}

function isExactChatGptShellTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  return normalized === 'chatgpt - chrome'
    || normalized === 'chatgpt - google chrome'
    || normalized === 'chatgpt - microsoft edge';
}

function ensurePromptTargetLooksCredible({ promptFocus, focusedElement, currentUrlAfterValidation, prompt, actualHash }) {
  const promptFocusLooksLikeComposer = looksLikeComposerElement(promptFocus?.element);
  const focusedLooksLikeComposer = looksLikeComposerElement(focusedElement);
  const promptLooksLikeUrlEcho = looksLikePromptEcho(currentUrlAfterValidation, prompt);
  const urlLooksCredible = isChatGptUrl(currentUrlAfterValidation);

  if (!promptFocusLooksLikeComposer && !focusedLooksLikeComposer) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'Focused prompt target did not resolve to the ChatGPT composer.', {
      promptFocus: promptFocus?.element || null,
      focusedElement: focusedElement || null
    });
  }

  if (!urlLooksCredible && !promptLooksLikeUrlEcho && currentUrlAfterValidation && currentUrlAfterValidation !== CHATGPT_URL) {
    throw new StepError('PROMPT_TARGET_INVALID', 'validate-prompt', 'URL changed away from ChatGPT during prompt validation.', {
      currentUrlAfterValidation,
      promptPreview: String(prompt).slice(0, 80),
      actualHash
    });
  }
}

function looksLikeComposerElement(element) {
  if (!element) return false;
  const haystack = [
    element.name,
    element.role,
    element.controlType,
    element.automationId,
    element.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('prompt-textarea')
    || haystack.includes('prosemirror')
    || haystack.includes('message chatgpt')
    || haystack.includes('메시지');
}

async function submitPrompt(handle, submitPoint, stepDelayMs, prompt, promptFocus, preferredMethod = 'click', validatedInput = null, allowReprime = false) {
  await focusWindow(handle).catch(() => {});
  const composerTarget = await refocusComposer(handle, promptFocus, stepDelayMs)
    .catch(() => promptFocus?.focusedElement || promptFocus?.element || null);
  await clickComposerEnd(
    composerTarget,
    pointFromElementRect(composerTarget?.rect)
      || pointFromElementRect(promptFocus?.focusedElement?.rect)
      || pointFromElementRect(promptFocus?.element?.rect)
  ).catch(() => {});
  await settleAfterComposerFocus(stepDelayMs);
  await sendKeys('end').catch(() => {});
  await sendKeys('right').catch(() => {});
  await delay(Math.max(80, Math.min(stepDelayMs, 180)));
  const ready = await verifyReadyToSubmit(handle, prompt, promptFocus, stepDelayMs, validatedInput);
  let before = ready.sample;
  await clickComposerEnd(
    composerTarget,
    pointFromElementRect(composerTarget?.rect)
      || pointFromElementRect(before?.focusedElement?.rect)
      || pointFromElementRect(before?.composerElement?.rect)
      || pointFromElementRect(promptFocus?.focusedElement?.rect)
      || pointFromElementRect(promptFocus?.element?.rect)
  ).catch(() => {});
  await delay(Math.max(80, Math.min(stepDelayMs, 180)));
  await sendKeys('end').catch(() => {});
  await sendKeys('right').catch(() => {});
  await delay(Math.max(80, Math.min(stepDelayMs, 180)));
  if (allowReprime && shouldReprimePromptBeforeSubmit(validatedInput, ready, before)) {
    await clickComposerEnd(
      composerTarget,
      pointFromElementRect(composerTarget?.rect)
        || pointFromElementRect(before?.focusedElement?.rect)
        || pointFromElementRect(before?.composerElement?.rect)
        || pointFromElementRect(promptFocus?.focusedElement?.rect)
        || pointFromElementRect(promptFocus?.element?.rect)
    ).catch(() => {});
    await settleAfterComposerFocus(stepDelayMs);
    await clearComposer(stepDelayMs);
    await setClipboardText(prompt);
    await delay(stepDelayMs);
    await pasteClipboard({ slow: true, keyDelayMs: PASTE_KEY_DELAY_MS });
    await settleAfterPaste(stepDelayMs, prompt);
    await clickComposerEnd(
      composerTarget,
      pointFromElementRect(composerTarget?.rect)
        || pointFromElementRect(before?.focusedElement?.rect)
        || pointFromElementRect(before?.composerElement?.rect)
        || pointFromElementRect(promptFocus?.focusedElement?.rect)
        || pointFromElementRect(promptFocus?.element?.rect)
    ).catch(() => {});
    await delay(Math.max(80, Math.min(stepDelayMs, 180)));
    await sendKeys('end').catch(() => {});
    await sendKeys('right').catch(() => {});
    await delay(Math.max(80, Math.min(stepDelayMs, 180)));
    const reprimeProof = await readComposerProof(handle).catch(() => null);
    const reprimeVisibleState = await sampleVisibleSubmitState(handle).catch(() => null);
    if (
      !normalizeComposerText(reprimeProof?.text).includes(prompt)
      && !reprimeVisibleState?.sendable
    ) {
      throw new StepError('SUBMIT_PRECHECK_FAILED', 'submit-prompt-precheck', 'Prompt was not confirmed in the ChatGPT composer after re-priming before submit.', {
        reprimeProof,
        reprimeVisibleState
      });
    }
    before = await collectSubmitEvidence(handle, prompt).catch(() => ({
      ...before,
      submitButton: reprimeVisibleState?.submitButton || before?.submitButton || null,
      stopButton: reprimeVisibleState?.stopButton || before?.stopButton || null,
      submitButtonEnabled: Boolean(reprimeVisibleState?.sendable) || before?.submitButtonEnabled || false,
      stopButtonEnabled: Boolean(reprimeVisibleState?.stopVisible) || before?.stopButtonEnabled || false
    }));
  }
  const plannedMethods = buildSubmitAttemptOrder(preferredMethod, before.submitButton);
  let method = null;
  let after = null;

  for (const plannedMethod of plannedMethods) {
    if (plannedMethod === 'click' && !isSendableSubmitState(before.submitButton)) {
      continue;
    }
    method = await attemptSubmitMethod(handle, submitPoint, stepDelayMs, plannedMethod);
    if (!method) {
      continue;
    }
    const fastEnterPath = shouldUseFastEnterSubmitPath(method, ready, before);
    after = await waitForSubmitEvidence(handle, prompt, before, stepDelayMs, fastEnterPath ? 2 : 12);
    if (after?.ok || fastEnterPath) {
      if (!after?.ok && fastEnterPath) {
        after = {
          ...(after || {}),
          ok: true,
          proof: 'enterAttemptedAfterValidatedPrompt',
          composerText: after?.composerText || '',
          focusedElement: after?.focusedElement || before.focusedElement,
          composerElement: after?.composerElement || before.composerElement,
          submitButton: after?.submitButton || before.submitButton,
          stopButton: after?.stopButton || null
        };
      }
      break;
    }
  }

  if (!method) {
    throw new StepError('SUBMIT_FAILED', 'submit-prompt', 'Failed to trigger a practical submit attempt.', { before, plannedMethods });
  }

  return {
    method,
    proof: after?.proof || 'submitAttemptMadeButUiProofUnavailable',
    composerTextSample: String(after?.composerText || '').slice(0, 200),
    focusedElement: after?.focusedElement || before.focusedElement,
    composerElement: after?.composerElement || before.composerElement,
    beforeSubmitButton: before.submitButton?.name || null,
    afterSubmitButton: after?.submitButton?.name || null,
    stopButton: after?.stopButton?.name || null,
    submitAttempted: method !== null,
    readyProof: ready.proof,
    sendButtonVisibleBeforeSubmit: isSendableSubmitState(before.submitButton)
  };
}

async function collectSubmitEvidence(handle, prompt) {
  const composer = await readComposerProof(handle).catch(() => ({ text: '', element: null, focusedElement: null }));
  const submitButton = await findSubmitButton(handle);
  const stopButton = await findStopButton(handle);
  return {
    stage: 'sample',
    prompt,
    composerText: normalizeComposerText(composer.text),
    composerElement: composer.element,
    focusedElement: composer.focusedElement,
    submitButton,
    stopButton,
    submitButtonEnabled: isElementEnabled(submitButton),
    stopButtonEnabled: isElementEnabled(stopButton)
  };
}

async function sampleVisibleSubmitState(handle) {
  const submitButton = await findSubmitButton(handle).catch(() => null);
  const stopButton = await findStopButton(handle).catch(() => null);
  return {
    submitButton,
    stopButton,
    sendable: isSendableSubmitState(submitButton),
    stopVisible: Boolean(stopButton),
    submitSignature: elementSignature(submitButton),
    stopSignature: elementSignature(stopButton)
  };
}

function hasVisibleSendStateTransition(beforeState, afterState) {
  if (!afterState?.sendable) return false;
  if (!beforeState) return afterState.sendable;
  if (beforeState.stopVisible && afterState.sendable) return true;
  if (!beforeState.sendable && afterState.sendable) return true;
  if (beforeState.submitSignature !== afterState.submitSignature) return true;
  return false;
}

async function waitForVisibleSendState(handle, prompt, beforeState, stepDelayMs, method) {
  return waitForCondition({
    step: 'visible-send-state',
    attempts: 6,
    delayMs: stepDelayMs,
    verify: async () => {
      const proof = await readComposerProof(handle).catch(() => ({ text: '', element: null, focusedElement: null }));
      const submitState = await sampleVisibleSubmitState(handle);
      const promptPresent = normalizeComposerText(proof.text).includes(prompt);
      const transitioned = hasVisibleSendStateTransition(beforeState, submitState);
      return {
        ok: promptPresent && transitioned,
        proof: promptPresent
          ? (transitioned ? `${method}+visibleSendButtonTransition` : `${method}+visibleSendButtonTransitionUnproven`)
          : `${method}+composerTextPending`,
        text: proof.text,
        element: proof.element,
        focusedElement: proof.focusedElement,
        submitState
      };
    },
    throwOnFailure: false
  });
}

async function submitViaVisibleSendButton(handle, submitPoint, stepDelayMs) {
  try {
    await uiaInvoke({ handle }, { automationId: 'composer-submit-button', timeoutMs: 1000 });
    await delay(stepDelayMs * 2);
    return 'uia-invoke-submit-button';
  } catch {
    try {
      await uiaInvoke({ handle }, { automationId: 'composer-submit-btn', timeoutMs: 1000 });
      await delay(stepDelayMs * 2);
      return 'uia-invoke-submit-button-legacy';
    } catch {
      try {
        await uiaInvoke({ handle }, { name: '프롬프트 보내기', role: 'Button', timeoutMs: 1000 });
        await delay(stepDelayMs * 2);
        return 'uia-invoke-submit-button-ko';
      } catch {
        try {
      await uiaInvoke({ handle }, { name: 'Send', role: 'Button', timeoutMs: 1000 });
      await delay(stepDelayMs * 2);
      return 'uia-invoke-send-button';
    } catch {
      try {
        await uiaInvoke({ handle }, { name: '보내기', role: 'Button', timeoutMs: 1000 });
        await delay(stepDelayMs * 2);
        return 'uia-invoke-send-button-ko';
      } catch {
        await clickPoint(submitPoint);
        await delay(stepDelayMs * 2);
        return 'calibrated-send-button';
      }
    }
      }
      }
  }
}

async function verifyReadyToSubmit(handle, prompt, promptFocus, stepDelayMs, validatedInput = null) {
  const validatedHashMatched = validatedInput?.actualHash === hashText(prompt);
  const promptFocusLooksCredible = hasCredibleComposerFocus(promptFocus);

  if (shouldTrustValidatedPromptForSubmit(validatedInput, promptFocus)) {
    const validatedSubmitState = validatedInput?.afterSubmitState || validatedInput?.beforeSubmitState || null;
    return {
      proof: 'validatedInputTrustedAndComposerCredible',
      promptValidated: validatedInput?.promptValidated === true,
      submitAllowed: validatedInput?.submitAllowed === true,
      sample: {
        stage: 'before',
        prompt,
        composerText: String(validatedInput?.composerTextSample || prompt).slice(0, 200),
        composerElement: validatedInput?.composerElement || promptFocus?.element || null,
        focusedElement: validatedInput?.focusedElement || promptFocus?.focusedElement || null,
        submitButton: validatedSubmitState?.submitButton || null,
        stopButton: validatedSubmitState?.stopButton || null,
        submitButtonEnabled: isElementEnabled(validatedSubmitState?.submitButton || null),
        stopButtonEnabled: isElementEnabled(validatedSubmitState?.stopButton || null)
      }
    };
  }

  return waitForCondition({
    step: 'submit-prompt-precheck',
    attempts: 5,
    delayMs: stepDelayMs,
    verify: async () => {
      const proof = await readComposerProof(handle).catch((proofError) => {
        if (proofError instanceof StepError && proofError.code === 'PROMPT_TEXT_UNAVAILABLE') {
          return {
            text: '',
            element: validatedInput?.composerElement || promptFocus?.element || null,
            focusedElement: validatedInput?.focusedElement || promptFocus?.focusedElement || null
          };
        }
        throw proofError;
      });
      const proofLooksCredible = hasCredibleComposerFocus(proof);
      const validatedReady = shouldTrustValidatedPromptForSubmit(validatedInput, promptFocus, proof)
        || (validatedHashMatched && (proofLooksCredible || promptFocusLooksCredible));
      const submitButton = validatedReady ? null : await findSubmitButton(handle);
      ensurePromptTargetLooksCredible({
        promptFocus,
        focusedElement: proof.focusedElement,
        currentUrlAfterValidation: CHATGPT_URL,
        prompt,
        actualHash: hashText(proof.text)
      });
      const promptPresent = normalizeComposerText(proof.text).includes(prompt);
      const sendable = isSendableSubmitState(submitButton);
      const sample = {
        stage: 'before',
        prompt,
        composerText: normalizeComposerText(proof.text),
        composerElement: proof.element,
        focusedElement: proof.focusedElement,
        submitButton,
        stopButton: null,
        submitButtonEnabled: isElementEnabled(submitButton),
        stopButtonEnabled: false
      };
      return {
        ok: promptPresent || validatedReady,
        proof: promptPresent
          ? (sendable ? 'composerContainsPromptAndSendable' : 'composerContainsPromptSubmitStateDegraded')
          : (validatedReady ? 'validatedInputTrustedAndComposerCredible' : 'composerMissingExpectedPrompt'),
        promptValidated: promptPresent || validatedInput?.promptValidated === true,
        submitAllowed: validatedReady,
        sample
      };
    },
    failureCode: 'SUBMIT_PRECHECK_FAILED',
    failureMessage: 'Prompt was not confirmed in the ChatGPT composer before submit.'
  });
}

async function waitForSubmitEvidence(handle, prompt, before, stepDelayMs, attempts = 12) {
  return waitForCondition({
    step: 'submit-prompt',
    attempts,
    delayMs: stepDelayMs * 2,
    verify: async () => {
      const sample = await collectSubmitEvidence(handle, prompt).catch(() => null);
      if (!sample) {
        return { ok: false, proof: 'submitEvidenceUnavailable' };
      }
      const proof = deriveSubmitProof(before, sample, prompt);
      return {
        ok: proof !== 'submitUnprovenComposerStillContainsPrompt',
        proof,
        ...sample
      };
    },
    throwOnFailure: false
  });
}

function hasCredibleComposerFocus(proof) {
  return looksLikeComposerElement(proof?.focusedElement) || looksLikeComposerElement(proof?.element);
}

function hasVisibleSendableState(state) {
  return Boolean(state?.sendable) || isSendableSubmitState(state?.submitButton);
}

function shouldTrustValidatedPromptForSubmit(validatedInput, promptFocus, proof = null) {
  const legacyValidatedHashMatched = typeof validatedInput === 'boolean' ? validatedInput : null;
  const validationLevel = String(validatedInput?.validationLevel || '').toLowerCase();
  const validatedHashMatched = legacyValidatedHashMatched ?? (
    Boolean(validatedInput?.expectedHash) && validatedInput?.actualHash === validatedInput?.expectedHash
  );
  const trustworthyValidation = validatedInput?.submitAllowed === true
    || validationLevel === 'visual'
    || validatedHashMatched;
  return trustworthyValidation && (hasCredibleComposerFocus(proof) || hasCredibleComposerFocus(promptFocus));
}

function shouldUseFastEnterSubmitPath(method, ready, before) {
  return method === 'enter'
    && ready?.proof === 'validatedInputTrustedAndComposerCredible'
    && !isSendableSubmitState(before?.submitButton);
}

function shouldReprimePromptBeforeSubmit(validatedInput, ready, before) {
  if (ready?.proof !== 'validatedInputTrustedAndComposerCredible') {
    return false;
  }

  if (isSendableSubmitState(before?.submitButton)) {
    return false;
  }

  if (String(validatedInput?.validationLevel || '').toLowerCase() === 'visual') {
    return false;
  }

  if (validatedInput?.submitAllowed === true && String(validatedInput?.validationLevel || '').toLowerCase() === 'none') {
    return false;
  }

  const method = String(validatedInput?.method || '').toLowerCase();
  const proof = String(validatedInput?.proof || '').toLowerCase();
  const riskSignals = [
    'clipboard',
    'roundtrip',
    'focus-safe-hash-proof',
    'coordinate',
    'hashmatchedafterfocusedpaste',
    'prompthashmatchedafterfocusedpaste',
    'recoveredbyslowclipboardroundtrip'
  ];

  return riskSignals.some((signal) => method.includes(signal) || proof.includes(signal));
}

function buildSubmitAttemptOrder(preferredMethod, submitButton) {
  const first = isSendableSubmitState(submitButton) ? 'click' : 'enter';
  const second = first === 'enter' ? 'click' : 'enter';
  return [first, second];
}

async function attemptSubmitMethod(handle, submitPoint, stepDelayMs, method) {
  if (method === 'enter') {
    await pressEnter();
    await delay(stepDelayMs * 2);
    return 'enter';
  }
  if (method === 'click') {
    return submitViaVisibleSendButton(handle, submitPoint, stepDelayMs);
  }
  return null;
}

function deriveSubmitProof(before, after, prompt) {
  const beforeText = normalizeComposerText(before?.composerText || '');
  const afterText = normalizeComposerText(after?.composerText || '');
  const stopAppeared = Boolean(after?.stopButton);
  const beforeSignature = elementSignature(before?.submitButton);
  const afterSignature = elementSignature(after?.submitButton);
  const submitButtonChanged = Boolean(beforeSignature || afterSignature) && beforeSignature !== afterSignature;
  const sendabilityChanged = isSendableSubmitState(before?.submitButton) !== isSendableSubmitState(after?.submitButton);
  const composerCleared = Boolean(beforeText) && (!afterText || !afterText.includes(prompt));

  if (stopAppeared) return 'stopButtonAppeared';
  if (submitButtonChanged) return 'submitButtonStateChanged';
  if (sendabilityChanged) return 'submitButtonSendabilityChanged';
  if (composerCleared) return 'composerClearedOrPromptGoneAfterSubmit';
  return 'submitUnprovenComposerStillContainsPrompt';
}

async function findSubmitButton(handle) {
  const candidates = [
    { automationId: 'composer-submit-button', timeoutMs: 700 },
    { automationId: 'composer-submit-btn', timeoutMs: 700 },
    { name: '프롬프트 보내기', role: 'Button', timeoutMs: 700 },
    { name: 'Send', role: 'Button', timeoutMs: 700 },
    { name: '보내기', role: 'Button', timeoutMs: 700 }
  ];

  for (const candidate of candidates) {
    const element = await uiaQuery({ handle }, candidate).then((result) => result.element).catch(() => null);
    if (element) return element;
  }
  return null;
}

async function findStopButton(handle) {
  const candidates = [
    { automationId: 'composer-submit-button', timeoutMs: 500 },
    { automationId: 'composer-submit-btn', timeoutMs: 500 },
    { name: '프롬프트 중지', role: 'Button', timeoutMs: 500 },
    { name: 'Stop', role: 'Button', timeoutMs: 500 },
    { name: '중지', role: 'Button', timeoutMs: 500 },
    { name: '응답 중지', role: 'Button', timeoutMs: 500 }
  ];

  for (const candidate of candidates) {
    const element = await uiaQuery({ handle }, candidate).then((result) => result.element).catch(() => null);
    if (!element) continue;
    if ((candidate.automationId && looksLikeStopButton(element)) || (!candidate.automationId && element)) {
      return element;
    }
  }
  return null;
}

function looksLikeStopButton(element) {
  const haystack = [element?.name, element?.role, element?.controlType, element?.automationId, element?.className]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('stop') || haystack.includes('중지');
}

function isElementEnabled(element) {
  if (!element) return false;
  for (const key of ['isEnabled', 'enabled', 'hasKeyboardFocus']) {
    if (typeof element?.[key] === 'boolean') {
      if (key === 'hasKeyboardFocus') continue;
      return element[key];
    }
  }
  const haystack = [element?.name, element?.role, element?.controlType, element?.automationId, element?.className]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (haystack.includes('disabled') || haystack.includes('비활성')) return false;
  return true;
}

function isSendableSubmitState(element) {
  if (!element) return false;
  if (looksLikeStopButton(element)) return false;
  return isElementEnabled(element);
}

function elementSignature(element) {
  if (!element) return '';
  return JSON.stringify({
    name: element.name || '',
    role: element.role || '',
    controlType: element.controlType || '',
    automationId: element.automationId || '',
    className: element.className || '',
    isEnabled: typeof element.isEnabled === 'boolean' ? element.isEnabled : null,
    enabled: typeof element.enabled === 'boolean' ? element.enabled : null,
    hasKeyboardFocus: typeof element.hasKeyboardFocus === 'boolean' ? element.hasKeyboardFocus : null
  });
}

function looksLikePromptEcho(currentUrlAfterValidation, prompt) {
  const value = String(currentUrlAfterValidation || '').trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return false;
  const promptText = String(prompt || '').trim();
  return value === promptText || promptText.includes(value) || value.includes(promptText.slice(0, Math.min(promptText.length, 24)));
}

function truncateForNote(text, limit = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function isLikelyOmniboxElement(element) {
  if (!element) return false;
  const haystack = [
    element.name,
    element.role,
    element.controlType,
    element.automationId,
    element.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return OMNIBOX_HINTS.some((hint) => haystack.includes(hint.toLowerCase()));
}

async function queryComposerElement(handle, timeoutMs = 1200) {
  const result = await uiaQuery({ handle }, {
    automationId: 'prompt-textarea',
    timeoutMs
  });
  return result?.element || null;
}

function normalizeAddressValue(value) {
  return String(value || '').trim().replace(/\/+$/, '/').toLowerCase();
}

function isChatGptHomeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== CHATGPT_HOST && !parsed.hostname.endsWith(`.${CHATGPT_HOST}`)) {
      return false;
    }
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch {
    return false;
  }
}

function extractChatGptConversationId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== CHATGPT_HOST && !parsed.hostname.endsWith(`.${CHATGPT_HOST}`)) {
      return '';
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[0] === 'c' && segments[1] ? segments[1] : '';
  } catch {
    return '';
  }
}

function isChatGptConversationUrl(url) {
  return Boolean(extractChatGptConversationId(url));
}

function extractConversationUrlFromOcrText(text) {
  const sourceText = String(text || '');
  const matches = [...sourceText.matchAll(/(?:https?:\/\/)?chatgpt\.com\/c\/[A-Za-z0-9-]+/ig)];
  if (!matches.length) {
    return '';
  }
  const raw = matches
    .map((match) => match[0])
    .sort((left, right) => right.length - left.length)[0];

  let normalized = raw.replace(/\/c\/([A-Za-z0-9-]+)/i, (_whole, id) => `/c/${String(id).replace(/[Oo]/g, '0')}`);
  const normalizedUrl = normalized.startsWith('http') ? normalized : `https://${normalized}`;
  const id = extractChatGptConversationId(normalizedUrl);
  if (id && id.length < 36) {
    const rawIndex = sourceText.indexOf(raw);
    if (rawIndex >= 0) {
      const tailWindow = sourceText.slice(rawIndex + raw.length, rawIndex + raw.length + 160);
      const tailMatches = [...tailWindow.matchAll(/-([A-Fa-f0-9]{12})/g)];
      const tail = tailMatches.length ? tailMatches[tailMatches.length - 1][1] : '';
      if (tail && !id.endsWith(tail)) {
        normalized = normalized.replace(/\/c\/([A-Za-z0-9-]+)/i, (_whole, currentId) => `/c/${currentId}-${tail}`);
      }
    }
  }

  return normalized.startsWith('http') ? normalized : `https://${normalized}`;
}

function pickOpenedBrowserWindow(beforeWindows = [], afterWindows = [], foregroundWindow = null) {
  const beforeHandles = new Set((beforeWindows || []).map((window) => String(window.handle)));
  const openedWindows = (afterWindows || []).filter((window) => !beforeHandles.has(String(window.handle)));
  if (!openedWindows.length) {
    return null;
  }

  const foregroundHandle = String(foregroundWindow?.handle || '');
  const foregroundMatch = openedWindows.find((window) => String(window.handle) === foregroundHandle);
  if (foregroundMatch) {
    return foregroundMatch;
  }

  return openedWindows
    .slice()
    .sort((left, right) => Number(right.handle) - Number(left.handle))[0] || null;
}

function isRectClose(actual = {}, expected = {}, tolerance = 3) {
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(Number(actual?.[key] || 0) - Number(expected?.[key] || 0)) <= tolerance);
}

async function waitForCondition({
  step,
  attempts = 3,
  delayMs = 250,
  action = null,
  verify,
  throwOnFailure = true,
  failureCode = ERROR_CODES.SUBMIT_FAILED,
  failureMessage = `${step} did not reach the expected ready state.`,
  failureDetails = {}
}) {
  let lastResult = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (action) {
        await action(attempt);
      }
      await delay(delayMs);
      lastResult = await verify(attempt);
      if (lastResult?.ok) {
        return { ...lastResult, attemptsUsed: attempt };
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await delay(delayMs);
    }
  }

  if (!throwOnFailure) {
    return {
      ok: false,
      attemptsUsed: attempts,
      proof: lastResult?.proof || 'conditionUnverified',
      ...lastResult,
      error: lastError ? { message: lastError.message, code: lastError.code } : null
    };
  }

  if (lastError instanceof StepError) {
    throw lastError;
  }

  throw new StepError(failureCode, step, failureMessage, {
    attempts,
    lastResult,
    lastError: lastError ? { message: lastError.message, code: lastError.code, step: lastError.step } : null,
    ...failureDetails
  });
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export const __desktopSubmitInternals = {
  isLikelyOmniboxElement,
  ensurePromptTargetLooksCredible,
  looksLikeComposerElement,
  isChatGptUrl,
  looksLikePromptEcho,
  buildCoordinateInsertionProof,
  buildPromptMarkers,
  looksLikeComposerPlaceholderText,
  looksLikeVisualComposerPlaceholder,
  normalizeComposerText,
  normalizePromptForSubmission,
  normalizeMarkerText,
  isLongPrompt,
  shouldTrustFocusSafeHashProof,
  hasCredibleComposerFocus,
  shouldTrustValidatedPromptForSubmit,
  shouldReprimePromptBeforeSubmit,
  shouldUseFastEnterSubmitPath,
  assessComposerVisualPromptEvidence,
  computeComposerCropRect,
  countPromptMarkers,
  deriveSubmitProof,
  hasVisibleSendStateTransition,
  buildSubmitAttemptOrder,
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
  isSoftRecoveryEligible,
  shouldUseTypedInsertFallback
};
