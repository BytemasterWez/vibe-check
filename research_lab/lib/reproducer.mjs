// Reproducer — reruns an experiment from the frozen protocol on a clean state
// and compares hashes (blueprint §10 reproduction_status). It CANNOT use cached
// undocumented outputs (role table): it regenerates the trials from seeds and
// recomputes the metrics, then diffs against the receipt. Because the whole
// pipeline is seeded, an honest experiment reproduces EXACTLY.

import { execute } from './executor.mjs';
import { sha256 } from './hash.mjs';

export function reproduce(protocol, receipt) {
  const rerun = execute(protocol);

  const inputMatch = rerun.input_manifest_hash === receipt.input_manifest_hash;
  const metricsMatch = sha256(rerun.primary_metrics) === sha256(receipt.primary_metrics);
  const resultMatch = rerun.result === receipt.result;

  let status;
  if (inputMatch && metricsMatch && resultMatch) status = 'EXACT_MATCH';
  else if (resultMatch) status = 'RESULT_MATCH_METRIC_DRIFT';
  else status = 'MISMATCH';

  return {
    status,
    input_manifest_match: inputMatch,
    metrics_match: metricsMatch,
    result_match: resultMatch,
    recomputed: {
      input_manifest_hash: rerun.input_manifest_hash,
      primary_metrics: rerun.primary_metrics,
      result: rerun.result,
    },
  };
}
