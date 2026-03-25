import { submitChatgpt } from './submit-chatgpt.js';

export async function runSmoke(argv = []) {
  if (process.env.LIVE_CHATGPT !== '1') {
    console.log(JSON.stringify({
      skipped: true,
      reason: 'Set LIVE_CHATGPT=1 to enable live browser smoke tests.'
    }, null, 2));
    return;
  }

  const receipt = await submitChatgpt(argv);
  console.log(JSON.stringify(receipt, null, 2));
}
