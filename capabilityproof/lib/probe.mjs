// Live probes: execute one test-pack request against a capability endpoint
// and capture everything the evaluator needs (status, body, latency).

import { substituteEnv } from './manifest.mjs';

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // refuse to buffer more than 5 MB

export async function runProbe(request, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = substituteEnv(request.url);
  const method = (request.method || 'GET').toUpperCase();
  // Header values may also carry ${ENV:VAR} (e.g. token headers, or SEC's
  // required contact-email User-Agent) so secrets stay out of manifests.
  const headers = { 'User-Agent': 'CapabilityProof/0.1 (SourceProof probe)' };
  for (const [k, v] of Object.entries(request.headers || {})) headers[k] = substituteEnv(v);

  const fetchedAt = new Date().toISOString();
  const started = Date.now();
  const result = {
    ok: false,
    url,
    method,
    status: null,
    content_type: null,
    body_text: null,
    body: null, // parsed JSON, if the body parses
    latency_ms: null,
    fetched_at: fetchedAt,
    error: null,
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    result.status = res.status;
    result.content_type = res.headers.get('content-type') || null;

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      result.error = `response too large: ${buf.byteLength} bytes`;
      result.latency_ms = Date.now() - started;
      return result;
    }
    result.body_text = new TextDecoder().decode(buf);
    result.latency_ms = Date.now() - started;

    try {
      result.body = JSON.parse(result.body_text);
    } catch {
      result.body = null; // not JSON; checks that need JSON will fail with detail
    }
    result.ok = true; // the probe itself completed; task success is decided by checks
  } catch (err) {
    result.latency_ms = Date.now() - started;
    result.error = err.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err.message;
  }
  return result;
}
