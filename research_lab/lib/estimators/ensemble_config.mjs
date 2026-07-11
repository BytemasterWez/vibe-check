// Frozen, versioned ensemble configuration (Packet 3 §2).
//
// Once external evidence is in play, the ensemble's agreement rule, tolerances
// and voting logic must NOT drift after seeing results. The configuration lives
// in a JSON artifact with a content hash; the loader recomputes the hash and
// refuses to run if the file was edited without re-freezing. Changing the config
// is therefore a NEW candidate version (robust_ensemble_v2 has its own file),
// never a silent update to an existing result.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalize, sha256 } from '../hash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Fields that define the frozen behaviour (everything except the hash itself).
function frozenBody(cfg) {
  const { config_hash, ...body } = cfg;
  return body;
}

export function computeConfigHash(cfg) {
  return sha256(canonicalize(frozenBody(cfg)));
}

const cache = new Map();

export function loadEnsembleConfig(file) {
  const p = file || path.join(HERE, 'ensemble.config.json');
  if (cache.has(p)) return cache.get(p);
  const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const expected = computeConfigHash(cfg);
  if (cfg.config_hash !== expected) {
    throw new Error(
      `ensemble config integrity check failed for ${path.basename(p)}: stored ${cfg.config_hash} != computed ${expected}. ` +
        `A changed ensemble config is a new candidate version — re-freeze the hash and register a new estimator, do not edit in place.`
    );
  }
  Object.freeze(cfg);
  cache.set(p, cfg);
  return cfg;
}
