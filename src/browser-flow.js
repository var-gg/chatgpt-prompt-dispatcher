import { candidateSequence, modeCandidates, resolveUiProfile, toolCandidates } from './ui-profile.js';

export function buildFlowPlan(profile, args) {
  const resolvedUi = resolveUiProfile(profile, args);
  const plan = {
    profileName: resolvedUi.profileName,
    locale: resolvedUi.locale,
    tier: resolvedUi.tier,
    loginCheck: {
      strategy: 'visible-ui-only-wait',
      notes: ['If not logged in, wait for manual login and do not automate authentication.']
    },
    navigation: {
      url: 'https://chatgpt.com/'
    },
    project: resolvedUi.requestedProject
      ? {
          action: 'select-project',
          value: resolvedUi.requestedProject,
          entryCandidates: candidateSequence(profile.ui?.project?.entry || {}),
          searchCandidates: candidateSequence(profile.ui?.project?.search || {}),
          listSelectors: candidateSequence(profile.ui?.project?.list || {})
        }
      : {
          action: 'skip-project'
        },
    newChat: resolvedUi.requestedProject
      ? { action: 'skip-new-chat-after-project' }
      : {
          action: resolvedUi.newChat ? 'start-new-chat' : 'reuse-current-chat',
          candidates: candidateSequence(profile.ui?.newChat || {})
        },
    mode: {
      action: 'select-mode',
      value: resolvedUi.requestedMode,
      candidates: modeCandidates(resolvedUi, resolvedUi.requestedMode)
    },
    attachments: {
      enabled: Array.isArray(args.attachments) && args.attachments.length > 0,
      files: args.attachments || [],
      menu: toolCandidates(resolvedUi, 'upload'),
      auxiliary: {
        recent: toolCandidates(resolvedUi, 'recent'),
        deepResearch: toolCandidates(resolvedUi, 'deepResearch'),
        shoppingAssistant: toolCandidates(resolvedUi, 'shoppingAssistant'),
        webSearch: toolCandidates(resolvedUi, 'webSearch'),
        study: toolCandidates(resolvedUi, 'study'),
        more: toolCandidates(resolvedUi, 'more')
      }
    },
    promptBox: candidateSequence(profile.ui?.promptBox || {}),
    submit: candidateSequence(profile.ui?.submit || {})
  };

  return plan;
}
