import { StepError, ERROR_CODES } from '../errors.js';
import { candidateSequence, modeCandidates, resolveUiProfile } from '../ui-profile.js';
import { resolveAnchorPoint } from './geometry.js';
import { clickPoint, delay, pressEnter, uiaElementFromPoint, uiaInvoke, uiaQuery, uiaSetFocus } from './windows-input.js';

const DEFAULT_DEPS = {
  clickPoint,
  delay,
  pressEnter,
  uiaElementFromPoint,
  uiaInvoke,
  uiaQuery,
  uiaSetFocus
};

const ROLE_MAP = {
  button: 'Button',
  document: 'Document',
  edit: 'Edit',
  hyperlink: 'Hyperlink',
  listitem: 'ListItem',
  menuitem: 'MenuItem',
  option: 'ListItem',
  tabitem: 'TabItem',
  textbox: 'Edit'
};

const MODE_LABELS = {
  auto: ['최신', '최신 모드', 'Latest', 'Latest mode'],
  latest: ['최신', '최신 모드', 'Latest', 'Latest mode'],
  instant: ['Instant', 'Instant mode', 'Instant 모드'],
  thinking: ['Thinking', 'Thinking mode', 'Thinking 모드'],
  pro: ['Pro', 'Pro mode', 'Pro 모드', 'Pro 확장 모드']
};

const SELECTED_MODE_LABELS = {
  auto: ['최신 모드', 'Latest mode'],
  latest: ['최신 모드', 'Latest mode'],
  instant: ['Instant mode', 'Instant 모드'],
  thinking: ['Thinking mode', 'Thinking 모드'],
  pro: ['Pro mode', 'Pro 모드', 'Pro 확장 모드']
};

const MODE_ENTRY_LABELS = dedupeValues([
  ...MODE_LABELS.auto,
  ...MODE_LABELS.instant,
  ...MODE_LABELS.thinking,
  ...MODE_LABELS.pro,
  '모델 선택',
  '모델',
  'Model'
]);

const MODE_KEYWORDS = {
  auto: ['최신', 'latest', 'auto'],
  latest: ['최신', 'latest'],
  instant: ['instant'],
  thinking: ['thinking'],
  pro: ['pro']
};

export function buildDesktopActionPlan(profile, args = {}) {
  const resolvedUi = resolveUiProfile(profile, args);
  const modePlan = modeCandidates(resolvedUi, resolvedUi.requestedMode);
  return {
    profileName: resolvedUi.profileName,
    requestedMode: resolvedUi.requestedMode,
    newChatCandidates: candidateSequence(profile.ui?.newChat || {}),
    modeEntryCandidates: modePlan.entry,
    modeOptionCandidates: modePlan.option,
    modeOverflowCandidates: modePlan.overflow
  };
}

export async function startDesktopNewChat({
  handle,
  stepDelayMs,
  calibration,
  windowBounds,
  profile,
  deps = DEFAULT_DEPS
}) {
  const plan = buildDesktopActionPlan(profile, { newChat: true });
  const queries = [
    ...buildAnchorQueries(calibration?.anchors?.newChatButton, 'Button'),
    ...buildQueriesFromCandidates(plan.newChatCandidates, 'Button')
  ];

  const activated = await tryActivateQueries(handle, queries, stepDelayMs, deps);
  if (activated) {
    return {
      method: activated.method,
      proof: 'newChatActivatedViaUia'
    };
  }

  const fallbackPoint = resolveAnchorPoint(calibration, 'newChatButton', windowBounds);
  await deps.clickPoint(fallbackPoint);
  await deps.delay(stepDelayMs);
  return {
    method: 'coordinateClick:newChatButton',
    proof: 'newChatActivatedViaCoordinateAnchor'
  };
}

export async function selectDesktopMode({
  handle,
  stepDelayMs,
  calibration,
  windowBounds,
  profile,
  modeResolved,
  deps = DEFAULT_DEPS
}) {
  if (!modeResolved || modeResolved === 'auto') {
    return {
      method: 'modeSelectionSkipped:auto',
      proof: 'modeSelectionSkipped'
    };
  }

  const plan = buildDesktopActionPlan(profile, { mode: modeResolved });
  if (!plan.modeOptionCandidates.length) {
    throw new StepError(
      ERROR_CODES.MODE_SELECTION_FAILED,
      'select-mode',
      `Mode "${modeResolved}" is not configured for profile ${profile.profileName}.`
    );
  }

  const selectedQueries = buildSelectedModeQueries(modeResolved);
  const selectedModeControl = await locateModeControlFromComposer(handle, modeResolved, deps);
  if (selectedModeControl?.matchesRequestedMode || (await confirmModeSelection(handle, selectedQueries, deps))) {
    return {
      method: selectedModeControl?.matchesRequestedMode
        ? selectedModeControl.method
        : 'uiaQuery:selectedMode',
      proof: 'modeSelectionSkippedAlreadySelected',
      confirmed: true
    };
  }

  const menuQueries = [
    ...buildAnchorQueries(calibration?.anchors?.modeButton, 'Button'),
    ...buildQueriesFromCandidates(plan.modeEntryCandidates, 'Button'),
    ...buildQueriesFromNames(MODE_ENTRY_LABELS, 'Button')
  ];

  let openMenu = await tryActivateQueries(handle, menuQueries, stepDelayMs, deps);
  if (!openMenu) {
    if (selectedModeControl?.clickPoint) {
      await deps.clickPoint(selectedModeControl.clickPoint);
      await deps.delay(stepDelayMs);
      openMenu = {
        method: selectedModeControl.method
      };
    } else {
      const fallbackPoint = resolveAnchorPoint(calibration, 'modeButton', windowBounds);
      await deps.clickPoint(fallbackPoint);
      await deps.delay(stepDelayMs);
      openMenu = {
        method: 'coordinateClick:modeButton'
      };
    }
  }

  let optionActivation = await tryActivateQueries(
    handle,
    buildModeOptionQueries(plan.modeOptionCandidates, modeResolved),
    stepDelayMs,
    deps
  );

  let overflowActivation = null;
  if (!optionActivation && plan.modeOverflowCandidates.length) {
    overflowActivation = await tryActivateQueries(
      handle,
      buildQueriesFromCandidates(plan.modeOverflowCandidates, 'MenuItem'),
      stepDelayMs,
      deps
    );
    if (overflowActivation) {
      optionActivation = await tryActivateQueries(
        handle,
        buildModeOptionQueries(plan.modeOptionCandidates, modeResolved),
        stepDelayMs,
        deps
      );
    }
  }

  if (!optionActivation) {
    throw new StepError(
      ERROR_CODES.MODE_SELECTION_FAILED,
      'select-mode',
      `Could not select mode "${modeResolved}" using desktop UI candidates or calibration anchors.`
    );
  }

  const confirmed = await confirmModeSelection(
    handle,
    [
      ...buildConfirmationQueries(plan.modeOptionCandidates),
      ...selectedQueries
    ],
    deps
  );

  const methodParts = [openMenu.method];
  if (overflowActivation) methodParts.push(overflowActivation.method);
  methodParts.push(optionActivation.method);

  return {
    method: methodParts.join('>'),
    proof: confirmed ? 'modeActivatedAndConfirmed' : 'modeActivatedUnconfirmed',
    confirmed
  };
}

export function buildQueriesFromCandidates(candidates = [], fallbackRole = null) {
  const queries = [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.kind === 'role') {
      const role = normalizeUiaRole(candidate.value?.role);
      const name = candidate.value?.name;
      if (name && role) {
        queries.push({ name, role });
      } else if (name) {
        queries.push({ name });
      }
      continue;
    }

    if (['label', 'text', 'placeholder'].includes(candidate.kind) && candidate.value) {
      const normalizedRole = normalizeUiaRole(fallbackRole);
      if (normalizedRole) {
        queries.push({ name: candidate.value, role: normalizedRole });
      }
      queries.push({ name: candidate.value });
    }
  }

  return dedupeQueries(queries);
}

export function buildAnchorQueries(anchor, fallbackRole = null) {
  if (!anchor?.accessible) return [];
  const query = {};
  const normalizedRole = normalizeUiaRole(anchor.accessible.role)
    || normalizeUiaRole(anchor.accessible.controlType)
    || normalizeUiaRole(fallbackRole);

  if (anchor.accessible.name) query.name = anchor.accessible.name;
  if (normalizedRole) query.role = normalizedRole;
  if (anchor.accessible.automationId) query.automationId = anchor.accessible.automationId;
  if (anchor.accessible.className) query.className = anchor.accessible.className;

  return Object.keys(query).length ? [query] : [];
}

export function normalizeUiaRole(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/^ControlType\./i, '').toLowerCase();
  return ROLE_MAP[normalized] || raw;
}

async function tryActivateQueries(handle, queries, stepDelayMs, deps) {
  for (const query of dedupeQueries(queries)) {
    const invokeQuery = { ...query, timeoutMs: 900 };
    try {
      await deps.uiaInvoke({ handle }, invokeQuery);
      await deps.delay(stepDelayMs);
      return { method: `uiaInvoke:${describeQuery(query)}` };
    } catch {
      // Fall through to focus+Enter.
    }

    try {
      await deps.uiaSetFocus({ handle }, invokeQuery);
      await deps.delay(stepDelayMs);
      await deps.pressEnter();
      await deps.delay(stepDelayMs);
      return { method: `focusEnter:${describeQuery(query)}` };
    } catch {
      // Try the next query.
    }

    try {
      const queried = await deps.uiaQuery({ handle }, invokeQuery);
      const point = centerPointFromRect(queried?.element?.rect);
      if (point) {
        await deps.clickPoint(point);
        await deps.delay(stepDelayMs);
        return { method: `uiaQueryClick:${describeQuery(query)}` };
      }
    } catch {
      // Try the next query.
    }
  }

  return null;
}

async function confirmModeSelection(handle, queries, deps) {
  for (const query of dedupeQueries(queries)) {
    try {
      await deps.uiaQuery({ handle }, { ...query, timeoutMs: 700 });
      return true;
    } catch {
      // try next confirmation query
    }
  }
  return false;
}

function buildConfirmationQueries(optionCandidates = []) {
  const queries = [];
  for (const candidate of optionCandidates) {
    if (!candidate) continue;
    if (candidate.kind === 'role' && candidate.value?.name) {
      queries.push({ name: candidate.value.name, role: 'Button' });
      queries.push({ name: candidate.value.name });
      continue;
    }
    if (['label', 'text', 'placeholder'].includes(candidate.kind) && candidate.value) {
      queries.push({ name: candidate.value, role: 'Button' });
      queries.push({ name: candidate.value });
    }
  }
  return dedupeQueries(queries);
}

function dedupeQueries(queries = []) {
  const seen = new Set();
  const output = [];
  for (const query of queries) {
    const key = JSON.stringify(query);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(query);
  }
  return output;
}

function describeQuery(query = {}) {
  if (query.automationId) return `automationId=${query.automationId}`;
  if (query.name && query.role) return `${query.role}:${query.name}`;
  if (query.name) return `name=${query.name}`;
  if (query.className) return `className=${query.className}`;
  return 'query';
}

function buildModeOptionQueries(optionCandidates = [], modeResolved = 'auto') {
  return dedupeQueries([
    ...buildQueriesFromCandidates(optionCandidates, 'MenuItem'),
    ...buildQueriesFromCandidates(optionCandidates, 'Button'),
    ...buildQueriesFromCandidates(optionCandidates, 'ListItem'),
    ...buildQueriesFromNames(MODE_LABELS[modeResolved] || [], ['MenuItem', 'Button', 'ListItem'])
  ]);
}

function buildSelectedModeQueries(modeResolved = 'auto') {
  return buildQueriesFromNames(SELECTED_MODE_LABELS[modeResolved] || [], 'Button');
}

function buildQueriesFromNames(names = [], roles = []) {
  const roleList = Array.isArray(roles) ? roles : [roles];
  const queries = [];

  for (const name of dedupeValues(names)) {
    for (const role of roleList.filter(Boolean)) {
      queries.push({ name, role: normalizeUiaRole(role) || role });
    }
    queries.push({ name });
  }

  return dedupeQueries(queries);
}

async function locateModeControlFromComposer(handle, modeResolved, deps) {
  if (typeof deps.uiaElementFromPoint !== 'function') {
    return null;
  }

  let composer = null;
  try {
    composer = await deps.uiaQuery({ handle }, {
      automationId: 'prompt-textarea',
      className: 'ProseMirror',
      timeoutMs: 900
    });
  } catch {
    return null;
  }

  const rect = composer?.element?.rect;
  if (!rect?.width || !rect?.height) {
    return null;
  }

  const hits = [];
  const xStart = Math.max(rect.x + 18, 0);
  const xEnd = rect.x + Math.min(rect.width, 220);
  const yStart = rect.y + rect.height + 8;

  for (const yOffset of [0, 12, 24, 36, 48]) {
    for (let x = xStart; x <= xEnd; x += 28) {
      try {
        const result = await deps.uiaElementFromPoint(x, yStart + yOffset);
        const element = result?.element || null;
        if (!looksLikeModeControlElement(element)) {
          continue;
        }
        hits.push({
          element,
          clickPoint: centerPointFromRect(element.rect) || { x, y: yStart + yOffset },
          matchesRequestedMode: elementMatchesRequestedMode(element, modeResolved),
          score: scoreModeControlElement(element, modeResolved)
        });
      } catch {
        // Continue scanning.
      }
    }
  }

  if (!hits.length) {
    return null;
  }

  hits.sort((left, right) => right.score - left.score);
  return {
    ...hits[0],
    method: `composerModeControl:${hits[0].element?.name || 'unnamed'}`
  };
}

function looksLikeModeControlElement(element = null) {
  if (!element) return false;
  const role = normalizeUiaRole(element.role || element.controlType);
  if (role !== 'Button') {
    return false;
  }

  const haystack = [element.name, element.className, element.automationId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('모드')
    || haystack.includes('mode')
    || haystack.includes('pill')
    || haystack.includes('latest')
    || haystack.includes('최신')
    || haystack.includes('instant')
    || haystack.includes('thinking')
    || haystack.includes('pro');
}

function elementMatchesRequestedMode(element = null, modeResolved = 'auto') {
  const haystack = [element?.name, element?.className, element?.automationId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (MODE_KEYWORDS[modeResolved] || []).some((keyword) => haystack.includes(String(keyword).toLowerCase()));
}

function scoreModeControlElement(element = null, modeResolved = 'auto') {
  let score = 0;
  if (elementMatchesRequestedMode(element, modeResolved)) score += 100;
  if (String(element?.className || '').toLowerCase().includes('pill')) score += 50;
  if (String(element?.name || '').trim()) score += 10;
  if (element?.rect?.width > 40 && element?.rect?.height > 18) score += 10;
  return score;
}

function centerPointFromRect(rect = null) {
  if (!rect?.width || !rect?.height) return null;
  return {
    x: rect.x + (rect.width / 2),
    y: rect.y + (rect.height / 2)
  };
}

function dedupeValues(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

export const __desktopActionInternals = {
  buildModeOptionQueries,
  buildSelectedModeQueries,
  buildQueriesFromNames,
  locateModeControlFromComposer,
  looksLikeModeControlElement,
  elementMatchesRequestedMode,
  scoreModeControlElement,
  centerPointFromRect
};
