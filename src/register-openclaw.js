import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultInstallTarget, isBundleRuntime, repoRoot } from './bundle-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(argv = process.argv.slice(2)) {
  const installEntry = isBundleRuntime
    ? path.join(__dirname, 'install-local.js')
    : path.join(repoRoot, 'src', 'install-local.js');

  const args = [installEntry, '--mode', 'copy', '--target', defaultInstallTarget, ...argv];
  const result = await run(process.execPath, args, isBundleRuntime ? path.join(repoRoot, 'runtime') : repoRoot);
  console.log(JSON.stringify({
    registered: true,
    target: defaultInstallTarget,
    install: JSON.parse(result.stdout)
  }, null, 2));
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `register-openclaw failed with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
