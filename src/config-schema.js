const REQUIRED_TOP_LEVEL_KEYS = ['profileName', 'browser', 'chatgpt'];
const REQUIRED_UI_KEYS = ['project', 'newChat', 'promptBox', 'submit', 'modeMenu', 'toolsMenu'];

/**
 * Minimal config validator for early scaffolding.
 * TODO: migrate to zod/json-schema once runtime contract stabilizes.
 */
export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object.');
  }

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in config)) {
      throw new Error(`Missing required config key: ${key}`);
    }
  }

  if (!config.browser?.channel) {
    throw new Error('browser.channel is required.');
  }

  if (!config.chatgpt?.mode) {
    throw new Error('chatgpt.mode is required.');
  }

  if (!config.ui || typeof config.ui !== 'object') {
    throw new Error('ui is required.');
  }

  for (const key of REQUIRED_UI_KEYS) {
    if (!(key in config.ui)) {
      throw new Error(`Missing required ui config key: ${key}`);
    }
  }

  return config;
}
