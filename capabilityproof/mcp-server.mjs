#!/usr/bin/env node

// CapabilityProof MCP server: exposes the verification service to agents
// over the Model Context Protocol (stdio).
//
// Usage: node capabilityproof/mcp-server.mjs [--manifests DIR] [--data DIR]
//
// Tools: search_capabilities, verify_capability, compare_capabilities,
//        route_task, resolve_task, resolve_and_fetch, get_capability_receipt,
//        get_attestation, replay_attestation, agent_readiness_test,
//        reconcile_behavior, explain_failure, find_fallback

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createService } from './lib/service.mjs';

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx === -1 ? null : args[idx + 1] || null;
}

const service = createService({
  manifestDir: getArg('manifests') || undefined,
  dataDir: getArg('data') || undefined,
});

const CONSTRAINTS_SCHEMA = {
  type: 'object',
  description: 'Optional hard constraints applied before ranking',
  properties: {
    country: { type: 'string', description: 'ISO country code the data must cover, e.g. "US"' },
    join_keys: { type: 'array', items: { type: 'string' }, description: 'Required join keys, e.g. ["state_fips", "county_fips"]' },
    maximum_cost_usd: { type: 'number', description: 'Maximum acceptable cost per call in USD' },
    minimum_success_rate: { type: 'number', description: 'Minimum 30-day verified success rate (0..1)' },
    maximum_receipt_age_minutes: { type: 'number', description: 'Reject capabilities whose latest receipt is older than this' },
    no_paid_auth: { type: 'boolean', description: 'Reject capabilities that require paid authentication' },
    risk_class: { type: 'string', enum: ['read_only', 'mutating'] },
  },
};

const TOOLS = [
  {
    name: 'search_capabilities',
    description: 'Search registered capabilities (APIs, data sources) by task description and constraints. Returns claims plus current verification evidence — never claims alone.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What you need done, in plain language, e.g. "current US county population keyed by FIPS"' },
        constraints: CONSTRAINTS_SCHEMA,
        limit: { type: 'number', description: 'Maximum results (default 10)' },
      },
      required: ['task'],
    },
  },
  {
    name: 'verify_capability',
    description: 'Run a live probe of one capability against its test pack right now and return a signed, short-lived capability receipt with the evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        capability_id: { type: 'string' },
        force_live_probe: { type: 'boolean', description: 'Default true. If false, a fresh unexpired receipt is returned without probing.' },
      },
      required: ['capability_id'],
    },
  },
  {
    name: 'compare_capabilities',
    description: 'Compare several capabilities side by side on verified results, history, cost and auth requirements.',
    inputSchema: {
      type: 'object',
      properties: {
        capability_ids: { type: 'array', items: { type: 'string' }, minItems: 2 },
        force_live_probe: { type: 'boolean', description: 'Probe each capability live instead of using cached receipts (default false)' },
      },
      required: ['capability_ids'],
    },
  },
  {
    name: 'route_task',
    description: 'Pick the best verified provider for a task. Returns the chosen capability, calling instructions, the receipt proving it currently works, and a fallback order.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        constraints: CONSTRAINTS_SCHEMA,
        verify_mode: { type: 'string', enum: ['cached', 'auto', 'live'], description: '"auto" (default) live-probes only stale candidates; "live" always probes; "cached" never probes.' },
      },
      required: ['task'],
    },
  },
  {
    name: 'resolve_task',
    description: 'The machine decision: apply a trust policy (production/standard/permissive or custom rules) and get an approved capability with receipt, confidence, calling instructions and fallbacks — or an explained rejection.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What you need, in plain language' },
        capability_id: { type: 'string', description: 'Resolve a specific capability instead of searching by task' },
        policy: {
          description: 'Named policy ("production", "standard", "permissive") or an object of custom rules (maximum_receipt_age_minutes, minimum_consecutive_passes, minimum_success_rate_30d, minimum_confidence, allow_experimental_sources)',
          anyOf: [{ type: 'string' }, { type: 'object' }],
        },
      },
    },
  },
  {
    name: 'resolve_and_fetch',
    description: 'Resolve the best policy-approved capability, execute the call, and return the data WITH a signed call attestation: what you declared, what the policy approved, the exact request sent, and whether the call stayed in the approved envelope and returned valid data. Prefer this over calling tools directly when you want the call itself to be provable.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What you need, in plain language' },
        capability_id: { type: 'string', description: 'Call a specific capability instead of searching by task' },
        policy: { anyOf: [{ type: 'string' }, { type: 'object' }], description: 'Named policy or custom rules (see resolve_task)' },
        params: { type: 'object', description: 'Values that fill {placeholders} in the manifest endpoint template only; host and path are never caller-controlled' },
        declared: { type: 'object', description: 'Your stated intent, e.g. the verbatim tool_call { name, arguments }; recorded in the attestation' },
      },
    },
  },
  {
    name: 'get_attestation',
    description: 'Fetch a signed call attestation by id (cpa_...), including a signature validity check.',
    inputSchema: {
      type: 'object',
      properties: {
        attestation_id: { type: 'string' },
        include_evidence: { type: 'boolean', description: 'Also return the stored raw evidence sample bound to it by hash' },
      },
      required: ['attestation_id'],
    },
  },
  {
    name: 'replay_attestation',
    description: 'Replay a call attestation: verify the evidence is still hash-bound, re-run the exact recorded request, re-apply the contract, and diff the outcomes.',
    inputSchema: {
      type: 'object',
      properties: { attestation_id: { type: 'string' } },
      required: ['attestation_id'],
    },
  },
  {
    name: 'agent_readiness_test',
    description: 'Test an agent\'s declared operating envelope (the capabilities it will use, under a policy) against a guardrail battery and return a signed readiness certificate: green/amber/red capabilities, residual risks, and a readiness score. Covers the sanctioned tool-call channel only.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Capability ids the agent intends to use' },
        policy: { anyOf: [{ type: 'string' }, { type: 'object' }] },
      },
      required: ['capabilities'],
    },
  },
  {
    name: 'reconcile_behavior',
    description: 'Reconcile externally-observed effects (network hosts, files, processes — e.g. exported from a kernel monitor you run) against this session\'s sanctioned tool calls, and return a signed reconciliation flagging unaccounted activity. CapabilityProof reconciles and signs; it does NOT capture the observations itself.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        attestation_ids: { type: 'array', items: { type: 'string' }, description: 'The sanctioned call attestations for the session' },
        observed: {
          type: 'object',
          description: 'Effects an external monitor observed',
          properties: {
            network_hosts: { type: 'array', items: { type: 'string' } },
            files_written: { type: 'array', items: { type: 'string' } },
            processes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'get_capability_receipt',
    description: 'Fetch a capability receipt by id, including a signature validity check.',
    inputSchema: {
      type: 'object',
      properties: {
        receipt_id: { type: 'string', description: 'Receipt id, e.g. cpr_...' },
        include_evidence: { type: 'boolean', description: 'Also return the stored raw evidence sample' },
      },
      required: ['receipt_id'],
    },
  },
  {
    name: 'explain_failure',
    description: 'Explain why a capability last failed verification: which checks failed, with the concrete evidence (HTTP status, row counts, bad values).',
    inputSchema: {
      type: 'object',
      properties: { capability_id: { type: 'string' } },
      required: ['capability_id'],
    },
  },
  {
    name: 'find_fallback',
    description: 'List verified fallbacks for a capability: its declared fallbacks plus same-category alternatives, each with current verification status.',
    inputSchema: {
      type: 'object',
      properties: { capability_id: { type: 'string' } },
      required: ['capability_id'],
    },
  },
];

function jsonContent(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const HANDLERS = {
  async search_capabilities(input) {
    return jsonContent({ results: service.search({ task: input.task, constraints: input.constraints, limit: input.limit }) });
  },
  async verify_capability(input) {
    const { receipt, cached } = await service.verify(input.capability_id, { forceLiveProbe: input.force_live_probe !== false });
    return jsonContent({ cached, receipt });
  },
  async compare_capabilities(input) {
    return jsonContent({ comparison: await service.compare(input.capability_ids, { forceLiveProbe: input.force_live_probe === true }) });
  },
  async route_task(input) {
    return jsonContent(await service.route({ task: input.task, constraints: input.constraints, verify_mode: input.verify_mode }));
  },
  async resolve_task(input) {
    return jsonContent(await service.resolve({ task: input.task, capability_id: input.capability_id, policy: input.policy }));
  },
  async resolve_and_fetch(input) {
    return jsonContent(await service.resolveAndFetch({ task: input.task, capability_id: input.capability_id, policy: input.policy, params: input.params, declared: input.declared }));
  },
  async get_attestation(input) {
    const out = service.getAttestation(input.attestation_id);
    if (input.include_evidence) {
      try { out.evidence = service.getAttestationEvidence(input.attestation_id); } catch { out.evidence = null; }
    }
    return jsonContent(out);
  },
  async replay_attestation(input) {
    return jsonContent(await service.replayAttestation(input.attestation_id));
  },
  async agent_readiness_test(input) {
    return jsonContent(await service.readinessTest({ agent_id: input.agent_id, capabilities: input.capabilities, policy: input.policy }));
  },
  async reconcile_behavior(input) {
    return jsonContent(service.reconcile({ session_id: input.session_id, attestation_ids: input.attestation_ids, observed: input.observed }));
  },
  async get_capability_receipt(input) {
    const out = service.getReceipt(input.receipt_id);
    if (input.include_evidence) {
      try { out.evidence = service.getEvidence(input.receipt_id); } catch { out.evidence = null; }
    }
    return jsonContent(out);
  },
  async explain_failure(input) {
    return jsonContent(service.explainFailure(input.capability_id));
  },
  async find_fallback(input) {
    return jsonContent(service.findFallback(input.capability_id));
  },
};

async function main() {
  const server = new Server(
    { name: 'capabilityproof', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input } = request.params;
    const handler = HANDLERS[name];
    if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    try {
      return await handler(input || {});
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error(`[capabilityproof] MCP server on stdio (${service.manifests.size} capabilities loaded)`);
}

main().catch((err) => {
  console.error('[capabilityproof] Fatal:', err);
  process.exit(1);
});
