// File-based lab store: claims, preregistered protocols, receipts and a
// campaign log. Deliberately boring and inspectable — the scientific record is
// plain JSON on disk, not a database. Mirrors capabilityproof/lib/store.mjs.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

export function createStore(dataDir = path.join(ROOT, 'data')) {
  const dirs = {
    claims: path.join(dataDir, 'claims'),
    protocols_preregistered: path.join(dataDir, 'protocols', 'preregistered'),
    protocols_completed: path.join(dataDir, 'protocols', 'completed'),
    receipts: path.join(dataDir, 'receipts'),
    keys: path.join(dataDir, 'keys'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const logFile = path.join(dataDir, 'campaign.log.jsonl');

  // --- Claims (the ledger lives here once seeded) ---
  function saveClaim(claim) {
    fs.writeFileSync(path.join(dirs.claims, `${claim.claim_id}.json`), JSON.stringify(claim, null, 2));
  }
  function getClaim(id) {
    const f = path.join(dirs.claims, `${id}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  }
  function listClaims() {
    return fs
      .readdirSync(dirs.claims)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dirs.claims, f), 'utf-8')));
  }

  // --- Protocols ---
  function savePreregistered(protocol) {
    fs.writeFileSync(
      path.join(dirs.protocols_preregistered, `${protocol.experiment_id}.json`),
      JSON.stringify(protocol, null, 2)
    );
  }
  function getPreregistered(experimentId) {
    const f = path.join(dirs.protocols_preregistered, `${experimentId}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  }
  function completeProtocol(experimentId) {
    const src = path.join(dirs.protocols_preregistered, `${experimentId}.json`);
    if (fs.existsSync(src)) {
      const dst = path.join(dirs.protocols_completed, `${experimentId}.json`);
      fs.renameSync(src, dst);
    }
  }
  function listCompleted() {
    return fs
      .readdirSync(dirs.protocols_completed)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  }

  // --- Receipts (append-only; failed results may never be deleted) ---
  function saveReceipt(receipt) {
    fs.writeFileSync(path.join(dirs.receipts, `${receipt.experiment_id}.json`), JSON.stringify(receipt, null, 2));
  }
  function getReceipt(experimentId) {
    const f = path.join(dirs.receipts, `${experimentId}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
  }
  function listReceipts() {
    return fs
      .readdirSync(dirs.receipts)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dirs.receipts, f), 'utf-8')));
  }

  function log(entry) {
    fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  }

  return {
    dataDir,
    dirs,
    saveClaim,
    getClaim,
    listClaims,
    savePreregistered,
    getPreregistered,
    completeProtocol,
    listCompleted,
    saveReceipt,
    getReceipt,
    listReceipts,
    log,
  };
}
