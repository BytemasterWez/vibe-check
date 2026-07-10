#!/usr/bin/env node

// CapabilityProof REST API (SourceProof wedge).
//
// Usage: node capabilityproof/api.mjs [--port 3200] [--manifests DIR] [--data DIR]
// Auth:  optional — set CAPABILITYPROOF_API_KEY to require an x-api-key header.
//
// Routes:
//   GET  /health
//   GET  /v1/public-key
//   GET  /v1/capabilities
//   POST /v1/capabilities/search   { task, constraints?, limit? }
//   POST /v1/capabilities/verify   { capability_id, force_live_probe?, ttl_hours? }
//   POST /v1/capabilities/route    { task, constraints?, verify_mode?, max_live_probes? }
//   POST /v1/capabilities/compare  { capability_ids, force_live_probe? }
//   GET  /v1/receipts/:id
//   GET  /v1/receipts/:id/evidence
//   GET  /v1/capabilities/:id/failure
//   GET  /v1/capabilities/:id/fallbacks

import http from 'http';
import { createService, ServiceError } from './lib/service.mjs';

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx === -1 ? null : args[idx + 1] || null;
}

const port = parseInt(getArg('port') || process.env.CAPABILITYPROOF_PORT || '3200', 10);
const service = createService({
  manifestDir: getArg('manifests') || undefined,
  dataDir: getArg('data') || undefined,
});
const apiKey = process.env.CAPABILITYPROOF_API_KEY || null;

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new ServiceError(413, 'request body too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new ServiceError(400, 'request body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === 'GET /health') {
      return send(res, 200, { status: 'ok', capabilities: service.manifests.size, manifest_problems: service.manifestProblems });
    }

    if (apiKey && req.headers['x-api-key'] !== apiKey) {
      return send(res, 401, { error: 'missing or invalid x-api-key' });
    }

    if (route === 'GET /v1/public-key') {
      return send(res, 200, { algorithm: 'ed25519', public_key_pem: service.publicKeyPem });
    }
    if (route === 'GET /v1/capabilities') {
      return send(res, 200, { capabilities: service.listCapabilities() });
    }
    if (route === 'POST /v1/capabilities/search') {
      const body = await readBody(req);
      if (!body.task) throw new ServiceError(400, 'task is required');
      return send(res, 200, { results: service.search({ task: body.task, constraints: body.constraints, limit: body.limit }) });
    }
    if (route === 'POST /v1/capabilities/verify') {
      const body = await readBody(req);
      if (!body.capability_id) throw new ServiceError(400, 'capability_id is required');
      const { receipt, cached } = await service.verify(body.capability_id, {
        forceLiveProbe: body.force_live_probe !== false,
        ttlHours: body.ttl_hours,
      });
      return send(res, 200, { cached, receipt });
    }
    if (route === 'POST /v1/capabilities/route') {
      const body = await readBody(req);
      if (!body.task) throw new ServiceError(400, 'task is required');
      return send(res, 200, await service.route({
        task: body.task,
        constraints: body.constraints,
        verify_mode: body.verify_mode,
        max_live_probes: body.max_live_probes,
      }));
    }
    if (route === 'POST /v1/capabilities/compare') {
      const body = await readBody(req);
      if (!Array.isArray(body.capability_ids) || body.capability_ids.length === 0) {
        throw new ServiceError(400, 'capability_ids must be a non-empty array');
      }
      return send(res, 200, { comparison: await service.compare(body.capability_ids, { forceLiveProbe: body.force_live_probe === true }) });
    }

    let m;
    if ((m = url.pathname.match(/^\/v1\/receipts\/(cpr_[A-Za-z0-9_-]+)$/)) && req.method === 'GET') {
      return send(res, 200, service.getReceipt(m[1]));
    }
    if ((m = url.pathname.match(/^\/v1\/receipts\/(cpr_[A-Za-z0-9_-]+)\/evidence$/)) && req.method === 'GET') {
      return send(res, 200, service.getEvidence(m[1]));
    }
    if ((m = url.pathname.match(/^\/v1\/capabilities\/([a-z0-9_.-]+)\/failure$/)) && req.method === 'GET') {
      return send(res, 200, service.explainFailure(m[1]));
    }
    if ((m = url.pathname.match(/^\/v1\/capabilities\/([a-z0-9_.-]+)\/fallbacks$/)) && req.method === 'GET') {
      return send(res, 200, service.findFallback(m[1]));
    }

    return send(res, 404, { error: `no route: ${route}` });
  } catch (err) {
    const status = err instanceof ServiceError ? err.httpStatus : 500;
    return send(res, status, { error: err.message });
  }
});

server.listen(port, () => {
  console.error(`[capabilityproof] REST API on http://localhost:${port} (${service.manifests.size} capabilities loaded${apiKey ? ', api key required' : ''})`);
});

export { server, service };
