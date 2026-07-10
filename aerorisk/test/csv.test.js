import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('parses simple rows into objects keyed by header', () => {
  const rows = parseCsv('A,B\n1,2\n3,4\n');
  assert.deepEqual(rows, [
    { A: '1', B: '2' },
    { A: '3', B: '4' },
  ]);
});

test('handles quoted fields with commas, escaped quotes, and newlines', () => {
  const rows = parseCsv('ID,NOTE\n1,"a, b"\n2,"say ""hi"""\n3,"line1\nline2"\n');
  assert.equal(rows[0].NOTE, 'a, b');
  assert.equal(rows[1].NOTE, 'say "hi"');
  assert.equal(rows[2].NOTE, 'line1\nline2');
});

test('skips blank lines and handles CRLF and missing trailing newline', () => {
  const rows = parseCsv('A,B\r\n1,2\r\n\r\n3,4');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { A: '3', B: '4' });
});

test('empty input yields empty array', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('strips a leading UTF-8 BOM so the first header is usable', () => {
  // Real FAA MASTER.txt ships a BOM; without stripping, the first column key
  // is corrupted and every row is dropped.
  const utf8Bom = parseCsv('﻿N-NUMBER,MFR\n100,PIPER\n');
  assert.equal(utf8Bom[0]['N-NUMBER'], '100');
  // latin1-decoded BOM (how the registry bundle is read).
  const latin1Bom = parseCsv('ï»¿N-NUMBER,MFR\n100,PIPER\n');
  assert.equal(latin1Bom[0]['N-NUMBER'], '100');
});
