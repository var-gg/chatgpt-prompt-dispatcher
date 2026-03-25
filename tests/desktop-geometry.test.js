import test from 'node:test';
import assert from 'node:assert/strict';
import { denormalizePoint, normalizePoint, resolveAnchorPoint } from '../src/desktop/geometry.js';

const bounds = { x: 100, y: 80, width: 1440, height: 900 };

test('denormalizePoint converts normalized point into absolute screen coordinates', () => {
  const point = denormalizePoint({ x: 0.5, y: 0.92 }, bounds);
  assert.deepEqual(point, { x: 820, y: 908 });
});

test('normalizePoint converts absolute point back into normalized coordinates', () => {
  const point = normalizePoint({ x: 720, y: 450 }, { x: 0, y: 0, width: 1440, height: 900 });
  assert.deepEqual(point, { x: 0.5, y: 0.5 });
});

test('resolveAnchorPoint resolves profile anchor names', () => {
  const point = resolveAnchorPoint({ anchors: { submitButton: { x: 0.965, y: 0.92 } } }, 'submitButton', bounds);
  assert.deepEqual(point, { x: 1490, y: 908 });
});
