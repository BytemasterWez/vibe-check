// Minimal RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
// escaped quotes ("") and newlines inside quotes. Returns array of objects
// keyed by the header row. No external dependencies by design: the real FAA
// feeds are plain CSV and the tool must run in restricted environments.

export function parseCsv(text) {
  // Strip a leading byte-order mark. Real FAA files ship a UTF-8 BOM; when a
  // file is read as latin1 (the registry bundle is), the BOM decodes to the
  // three-char sequence below instead of U+FEFF. Either would otherwise
  // corrupt the first header cell and silently drop every row.
  text = text.replace(/^﻿/, '').replace(/^ï»¿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = (r[idx] ?? '').trim();
      });
      return obj;
    });
}
