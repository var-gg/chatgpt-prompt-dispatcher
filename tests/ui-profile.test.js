import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveUiProfile, modeCandidates, candidateSequence } from '../src/ui-profile.js';
import { buildFlowPlan } from '../src/browser-flow.js';

async function load(name) {
  const raw = await readFile(new URL(`../profiles/${name}`, import.meta.url), 'utf8');
  return JSON.parse(raw);
}

test('candidateSequence prioritizes role then label then text then placeholder then selector', () => {
  const candidates = candidateSequence({
    roles: [{ role: 'button', name: '새 채팅' }],
    labels: ['새 채팅'],
    texts: ['새 채팅'],
    placeholders: ['메시지'],
    selectors: ['button']
  });

  assert.deepEqual(candidates.map((entry) => entry.kind), ['role', 'label', 'text', 'placeholder', 'selector']);
});

test('ko-KR.windows.pro profile resolves mode candidates in priority order', async () => {
  const profile = await load('ko-KR.windows.pro.json');
  const resolved = resolveUiProfile(profile, { mode: 'thinking' });
  const candidates = modeCandidates(resolved, 'thinking');

  assert.equal(candidates.option[0].kind, 'role');
  assert.equal(candidates.option[0].value.role, 'menuitem');
  assert.ok(candidates.entry.length > 0);
});

test('buildFlowPlan defaults to new chat when project is omitted', async () => {
  const profile = await load('ko-KR.windows.plus.json');
  const plan = buildFlowPlan(profile, { mode: 'auto', attachments: [] });

  assert.equal(plan.newChat.action, 'start-new-chat');
  assert.equal(plan.project.action, 'skip-project');
});

test('buildFlowPlan selects project path when project is provided', async () => {
  const profile = await load('ko-KR.windows.pro.json');
  const plan = buildFlowPlan(profile, { mode: 'pro', project: 'Alpha', attachments: ['a.txt'] });

  assert.equal(plan.project.action, 'select-project');
  assert.equal(plan.project.value, 'Alpha');
  assert.equal(plan.attachments.enabled, true);
});
