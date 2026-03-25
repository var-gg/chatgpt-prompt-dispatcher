import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(__dirname, '..');
const runtimeEntry = path.join(bundleRoot, 'runtime', 'src', 'install-local.js');

const child = spawn(process.execPath, [runtimeEntry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
