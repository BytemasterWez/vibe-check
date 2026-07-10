// Evidence store: file-based persistence for receipts, raw evidence samples
// and per-capability probe history (the future moat — dated probes, schema
// drift, success rates).

import fs from 'fs';
import path from 'path';

const MAX_SAMPLE_BYTES = 16 * 1024;

export function createStore(dataDir) {
  const dirs = {
    receipts: path.join(dataDir, 'receipts'),
    evidence: path.join(dataDir, 'evidence'),
    history: path.join(dataDir, 'history'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

  function saveReceipt(receipt) {
    fs.writeFileSync(path.join(dirs.receipts, `${receipt.receipt_id}.json`), JSON.stringify(receipt, null, 2));
    // Also track the latest receipt per capability for quick lookup.
    fs.writeFileSync(
      path.join(dirs.receipts, `latest-${receipt.capability_id}.json`),
      JSON.stringify(receipt, null, 2)
    );
  }

  function getReceipt(receiptId) {
    if (!/^cpr_[A-Za-z0-9_-]+$/.test(receiptId)) return null;
    const file = path.join(dirs.receipts, `${receiptId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  function latestReceiptFor(capabilityId) {
    const file = path.join(dirs.receipts, `latest-${capabilityId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  function saveEvidence(receiptId, evidence) {
    const trimmed = { ...evidence };
    if (typeof trimmed.body_sample === 'string' && trimmed.body_sample.length > MAX_SAMPLE_BYTES) {
      trimmed.body_sample = trimmed.body_sample.slice(0, MAX_SAMPLE_BYTES);
      trimmed.body_sample_truncated = true;
    }
    fs.writeFileSync(path.join(dirs.evidence, `${receiptId}.json`), JSON.stringify(trimmed, null, 2));
  }

  function getEvidence(receiptId) {
    if (!/^cpr_[A-Za-z0-9_-]+$/.test(receiptId)) return null;
    const file = path.join(dirs.evidence, `${receiptId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  function appendHistory(capabilityId, entry) {
    const file = path.join(dirs.history, `${capabilityId}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  }

  function getHistory(capabilityId) {
    const file = path.join(dirs.history, `${capabilityId}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  }

  function historyStats(capabilityId, now = Date.now()) {
    const entries = getHistory(capabilityId);
    const windowStats = (days) => {
      const cutoff = now - days * 86400000;
      const inWindow = entries.filter((e) => Date.parse(e.ts) >= cutoff);
      if (inWindow.length === 0) return { rate: null, probes: 0 };
      return {
        rate: Number((inWindow.filter((e) => e.task_success).length / inWindow.length).toFixed(3)),
        probes: inWindow.length,
      };
    };
    const w7 = windowStats(7);
    const w30 = windowStats(30);

    // Schema drift: count transitions between distinct schema hashes in 30d.
    const cutoff30 = now - 30 * 86400000;
    const hashes = entries
      .filter((e) => Date.parse(e.ts) >= cutoff30 && e.schema_hash)
      .map((e) => e.schema_hash);
    let schemaChanges = 0;
    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i] !== hashes[i - 1]) schemaChanges++;
    }

    return {
      success_rate_7d: w7.rate,
      success_rate_30d: w30.rate,
      probes_7d: w7.probes,
      probes_30d: w30.probes,
      schema_changes_30d: schemaChanges,
    };
  }

  return { dataDir, saveReceipt, getReceipt, latestReceiptFor, saveEvidence, getEvidence, appendHistory, getHistory, historyStats };
}
