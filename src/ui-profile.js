export function resolveUiProfile(profile, args = {}) {
  const requestedProject = args.project ?? profile.chatgpt?.projectName ?? null;
  const requestedMode = args.mode ?? profile.chatgpt?.mode ?? 'auto';
  const newChat = args.newChat ?? !requestedProject;

  return {
    profileName: profile.profileName,
    locale: profile.browser?.locale || 'unknown',
    tier: profile.chatgpt?.uiTier || 'unknown',
    requestedMode,
    requestedProject,
    newChat,
    selectors: profile.ui || {}
  };
}

export function candidateSequence(target = {}) {
  return [
    ...normalizeRoleCandidates(target.roles),
    ...normalizeCandidates('label', target.labels),
    ...normalizeCandidates('text', target.texts),
    ...normalizeCandidates('placeholder', target.placeholders),
    ...normalizeCandidates('selector', target.selectors)
  ];
}

export function modeCandidates(resolvedUi, mode) {
  const menu = resolvedUi.selectors?.modeMenu || {};
  const option = menu.options?.[mode] || menu.options?.auto || {};
  return {
    entry: candidateSequence(menu.entry || {}),
    option: candidateSequence(option),
    overflow: candidateSequence(menu.overflow || {})
  };
}

export function toolCandidates(resolvedUi, toolKey) {
  const tools = resolvedUi.selectors?.toolsMenu || {};
  return {
    entry: candidateSequence(tools.entry || {}),
    item: candidateSequence(tools.items?.[toolKey] || {})
  };
}

function normalizeCandidates(kind, values = []) {
  return (values || []).filter(Boolean).map((value, index) => ({
    kind,
    value,
    priority: index + 1
  }));
}

function normalizeRoleCandidates(values = []) {
  return (values || []).filter(Boolean).map((value, index) => ({
    kind: 'role',
    value,
    priority: index + 1
  }));
}
