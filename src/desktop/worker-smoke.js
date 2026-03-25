import { getDesktopWorkerClient, shutdownDesktopWorker } from './powershell.js';

async function main() {
  const client = getDesktopWorkerClient();
  const foreground = await client.call('getForegroundWindow', {}, { step: 'worker-smoke-foreground', timeoutMs: 5000 }).catch((error) => ({ error: { code: error.code, message: error.message } }));
  const chromeWindows = await client.call('listChromeWindows', {}, { step: 'worker-smoke-list-chrome', timeoutMs: 5000 }).catch((error) => ({ error: { code: error.code, message: error.message } }));

  console.log(JSON.stringify({
    ok: true,
    foreground,
    chromeWindowCount: Array.isArray(chromeWindows.windows) ? chromeWindows.windows.length : 0,
    chromeWindows
  }, null, 2));

  await shutdownDesktopWorker();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || 'WORKER_SMOKE_FAILED', message: error.message } }, null, 2));
  await shutdownDesktopWorker();
  process.exitCode = 1;
});
