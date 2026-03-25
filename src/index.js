#!/usr/bin/env node

import { runCli } from './cli.js';

runCli(process.argv.slice(2)).catch((error) => {
  console.error('[chatgpt-prompt-dispatcher] fatal:', error?.message || error);
  process.exitCode = 1;
});
