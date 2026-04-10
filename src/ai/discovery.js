// Local LLM auto-discovery
// Probes known endpoints for Ollama, LM Studio, and any OpenAI-compatible server
// Runs via IPC in Electron main process to avoid CORS

const KNOWN_SERVERS = [
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    probeUrl: 'http://localhost:11434/api/tags',
    modelsUrl: 'http://localhost:11434/api/tags',
    apiStyle: 'ollama',
    parseModels: (data) => (data.models || []).map(m => ({ id: m.name, name: m.name, size: m.size })),
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    probeUrl: 'http://localhost:1234/v1/models',
    modelsUrl: 'http://localhost:1234/v1/models',
    apiStyle: 'openai',
    parseModels: (data) => (data.data || []).map(m => ({ id: m.id, name: m.id, owned_by: m.owned_by })),
  },
];

const PROBE_TIMEOUT_MS = 2000;

// Probe a single endpoint — returns server info or null
async function probeServer(server) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(server.probeUrl, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const models = server.parseModels(data);

    return {
      id: server.id,
      name: server.name,
      baseUrl: server.baseUrl,
      apiStyle: server.apiStyle,
      models,
      available: true,
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// Probe a custom OpenAI-compatible endpoint
async function probeCustomServer(id, name, baseUrl) {
  const modelsUrl = `${baseUrl.replace(/\/$/, '')}/v1/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(modelsUrl, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const models = (data.data || []).map(m => ({ id: m.id, name: m.id }));

    return {
      id,
      name,
      baseUrl,
      apiStyle: 'openai',
      models,
      available: true,
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// Discover all local LLM servers — probes in parallel
export async function discoverLocalServers(customEndpoints = []) {
  const probes = [
    ...KNOWN_SERVERS.map(s => probeServer(s)),
    ...customEndpoints.map(ep => probeCustomServer(ep.id, ep.name, ep.baseUrl)),
  ];

  const results = await Promise.all(probes);
  return results.filter(Boolean);
}

// Fetch models for a specific server
export async function listModels(baseUrl, apiStyle = 'openai') {
  const url = apiStyle === 'ollama'
    ? `${baseUrl}/api/tags`
    : `${baseUrl.replace(/\/$/, '')}/v1/models`;

  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (apiStyle === 'ollama') {
      return (data.models || []).map(m => ({ id: m.name, name: m.name }));
    }
    return (data.data || []).map(m => ({ id: m.id, name: m.id }));
  } catch {
    return [];
  }
}

export { KNOWN_SERVERS };
