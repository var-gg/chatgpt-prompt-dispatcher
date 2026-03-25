import { spawn } from 'node:child_process';
import { StepError } from '../errors.js';

export async function execPowerShell(script, { step = 'powershell', json = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new StepError('WINDOWS_AUTOMATION_FAILED', step, error.message));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new StepError('WINDOWS_AUTOMATION_FAILED', step, stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`));
        return;
      }
      const text = stdout.trim();
      if (!json) {
        resolve(text);
        return;
      }
      try {
        resolve(text ? JSON.parse(text) : null);
      } catch (error) {
        reject(new StepError('WINDOWS_AUTOMATION_FAILED', step, `Failed to parse PowerShell JSON output: ${error.message}`));
      }
    });
  });
}
