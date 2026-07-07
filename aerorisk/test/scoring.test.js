import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, compositeScore, reviewPriorityLanguage, WEIGHTS } from '../src/scoring.js';

test('score bands match the product spec', () => {
  assert.equal(bandFor(0).label, 'Low public risk signal');
  assert.equal(bandFor(20).label, 'Low public risk signal');
  assert.equal(bandFor(21).label, 'Some review points');
  assert.equal(bandFor(41).label, 'Material due-diligence questions');
  assert.equal(bandFor(61).label, 'High review priority');
  assert.equal(
    bandFor(81).label,
    'Serious public-risk concentration; manual expert review recommended',
  );
});

test('weights sum to 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('composite is a weighted average of known module keys', () => {
  const modules = Object.keys(WEIGHTS).map((key) => ({ key, score: 50 }));
  assert.equal(compositeScore(modules), 50);
  assert.equal(compositeScore([{ key: 'maintenance', score: 80 }]), 80);
  assert.equal(compositeScore([{ key: 'unknown-module', score: 100 }]), 0);
});

test('summary language uses review-priority wording, never safe/unsafe', () => {
  for (const score of [0, 15, 35, 55, 75, 95]) {
    const text = reviewPriorityLanguage(score);
    assert.match(text, /^Public records show (low|moderate|high) review priority\.$/);
    assert.ok(!/\b(un)?safe\b/i.test(text));
  }
});
