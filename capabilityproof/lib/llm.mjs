// Minimal OpenAI-compatible chat client for the Scout's drafting step.
//
// Designed for LM Studio's local server (default http://localhost:1234/v1,
// e.g. running Gemma 12B) but works with any OpenAI-compatible endpoint via
// CAPABILITYPROOF_LLM_URL / CAPABILITYPROOF_LLM_MODEL / CAPABILITYPROOF_LLM_KEY.
//
// The LLM only DRAFTS manifests; live probes and deterministic checks decide
// what gets registered, so a small local model's mistakes are caught, not
// trusted.

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const CHAT_TIMEOUT_MS = 180000; // local 12B models can be slow

export function createLlmClient({
  baseUrl = process.env.CAPABILITYPROOF_LLM_URL || DEFAULT_BASE_URL,
  model = process.env.CAPABILITYPROOF_LLM_MODEL || null,
  apiKey = process.env.CAPABILITYPROOF_LLM_KEY || 'not-needed',
} = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  async function resolveModel() {
    if (model) return model;
    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`could not list models: HTTP ${res.status}`);
    const data = await res.json();
    const first = data.data?.[0]?.id;
    if (!first) throw new Error('no model loaded at the LLM endpoint');
    model = first;
    return model;
  }

  async function available() {
    try {
      await resolveModel();
      return true;
    } catch {
      return false;
    }
  }

  async function chat(system, user, { temperature = 0.2, maxTokens = 2500 } = {}) {
    const m = await resolveModel();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: m,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LLM error: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM returned no content');
    return text;
  }

  return { chat, available, resolveModel, baseUrl, get model() { return model; } };
}

// Small local models wrap JSON in prose or code fences; extract the first
// balanced JSON object rather than trusting the raw output.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('no JSON object in LLM output');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON in LLM output');
}
