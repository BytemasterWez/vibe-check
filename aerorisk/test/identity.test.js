import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNNumber, isValidNNumber } from '../src/identity.js';

test('normalizes case, whitespace, hyphens, and missing N prefix', () => {
  assert.equal(normalizeNNumber('n123ab'), 'N123AB');
  assert.equal(normalizeNNumber(' 123AB '), 'N123AB');
  assert.equal(normalizeNNumber('N-123-AB'), 'N123AB');
});

test('accepts valid US registration formats', () => {
  for (const n of ['N1', 'N12345', 'N123AB', 'N1234Z', 'N9X']) {
    assert.ok(isValidNNumber(n), `${n} should be valid`);
  }
});

test('rejects invalid registration formats', () => {
  for (const n of ['N', 'N012AB', 'NABCDE', 'N123AI', 'N1O', 'N123456', 'N1ABC']) {
    assert.ok(!isValidNNumber(n), `${n} should be invalid`);
  }
});
