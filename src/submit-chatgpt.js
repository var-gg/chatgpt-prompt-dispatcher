import { submitDesktopChatgpt } from './desktop/submit-desktop-chatgpt.js';
import { submitBrowserChatgpt } from './submit-browser-chatgpt.js';

export async function submitChatgpt(argv = []) {
  const { transport, rest } = splitTransportArg(argv);

  if (transport === 'browser') {
    return submitBrowserChatgpt(rest);
  }

  return submitDesktopChatgpt(rest);
}

function splitTransportArg(argv = []) {
  const rest = [];
  let transport = 'desktop';

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--transport') {
      transport = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token.startsWith('--transport=')) {
      transport = token.slice('--transport='.length);
      continue;
    }
    rest.push(token);
  }

  if (!['desktop', 'browser'].includes(transport)) {
    throw new Error(`Unsupported transport: ${transport}`);
  }

  return { transport, rest };
}
