// CapabilityProof JavaScript SDK — the thin client a customer drops into a
// pipeline so their code consumes decisions and receipts, not hope.
//
//   import { CapabilityProof } from './capabilityproof/sdk/client.mjs';
//
//   const cp = new CapabilityProof('http://localhost:3200');
//   const decision = await cp.resolve({ task: 'county population', policy: 'production' });
//   if (decision.decision === 'approved') {
//     const { fetch: result } = await cp.resolveAndFetch({
//       capability_id: decision.capability_id,
//       policy: 'production',
//     });
//     // result.data is the payload, decision.receipt_id is the proof
//   }
//
// Zero dependencies; works in Node 18+ and modern runtimes with global fetch.

export class CapabilityProof {
  constructor(baseUrl = 'http://localhost:3200', { apiKey = null, timeoutMs = 30000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async #call(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `CapabilityProof API: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  listCapabilities() { return this.#call('GET', '/v1/capabilities'); }
  listPolicies() { return this.#call('GET', '/v1/policies'); }
  search({ task, constraints, limit } = {}) { return this.#call('POST', '/v1/capabilities/search', { task, constraints, limit }); }
  verify(capabilityId, { forceLiveProbe = true } = {}) { return this.#call('POST', '/v1/capabilities/verify', { capability_id: capabilityId, force_live_probe: forceLiveProbe }); }
  resolve({ task, capability_id, policy } = {}) { return this.#call('POST', '/v1/resolve', { task, capability_id, policy }); }
  resolveAndFetch({ task, capability_id, policy, params } = {}) { return this.#call('POST', '/v1/resolve-and-fetch', { task, capability_id, policy, params }); }
  getReceipt(receiptId) { return this.#call('GET', `/v1/receipts/${receiptId}`); }
  getEvidence(receiptId) { return this.#call('GET', `/v1/receipts/${receiptId}/evidence`); }
  replay(receiptId) { return this.#call('POST', `/v1/receipts/${receiptId}/replay`); }
  getContract(capabilityId) { return this.#call('GET', `/v1/capabilities/${capabilityId}/contract`); }
  explainFailure(capabilityId) { return this.#call('GET', `/v1/capabilities/${capabilityId}/failure`); }
}
