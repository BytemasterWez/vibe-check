// HTML report + plain-language verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Datastore } from '../src/datastore.js';
import { assessAircraft } from '../src/assess.js';
import { renderHtmlReport } from '../src/reportHtml.js';
import { buildPlainVerdict } from '../src/plainVerdict.js';

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sample');
const NOW = new Date('2026-07-07T12:00:00Z');
const store = new Datastore(SAMPLE);

test('plain verdict is present, non-technical, and never says safe/unsafe', () => {
  for (const n of ['N123AB', 'N456CD', 'N789EF']) {
    const a = assessAircraft(store, n, { now: NOW });
    assert.ok(a.plainVerdict.length > 40);
    assert.ok(!/\b(un)?safe\b/i.test(a.plainVerdict), `${n}: verdict must avoid safe/unsafe`);
    assert.match(a.plainVerdict, /pre-buy|inspection|review|proceed/i);
  }
});

test('verdict names the concrete signals for a high-signal aircraft', () => {
  const a = assessAircraft(store, 'N789EF', { now: NOW });
  // N789EF has a direct NTSB event, enforcement match, ADs, churn.
  assert.match(a.plainVerdict, /NTSB|enforcement|ownership|airworthiness directive/i);
});

test('HTML report is self-contained and includes verdict, score, and disclaimer', () => {
  const html = renderHtmlReport(assessAircraft(store, 'N789EF', { now: NOW }));
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/<link|<script|src=|https?:\/\/[^"]*\.(css|js)/i.test(html), 'must inline all assets');
  assert.match(html, /class="verdict"/);
  assert.match(html, /Overall|\/100|score/i);
  assert.match(html, /not a safety certification/); // disclaimer
  assert.match(html, /Buyer checklist/);
});

test('HTML escapes user-derived content', () => {
  // The registrant name flows into HTML; ensure no raw injection.
  const html = renderHtmlReport(assessAircraft(store, 'N789EF', { now: NOW }));
  assert.ok(!/<script>/.test(html));
});

test('unresolved aircraft still renders a verdict page without crashing', () => {
  const a = assessAircraft(store, 'N00000', { now: NOW });
  assert.match(a.plainVerdict, /could not confirm|identity/i);
  const html = renderHtmlReport(a);
  assert.match(html, /class="verdict"/);
});

test('buildPlainVerdict handles an unresolved assessment directly', () => {
  const v = buildPlainVerdict({ identity: { registry: null } });
  assert.match(v, /could not confirm/i);
});
