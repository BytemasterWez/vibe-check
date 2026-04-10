// Provider abstraction for multi-model review and scaffold generation
// Each provider implements the same interface so the UI stays consistent

const PROVIDERS = {
  claude: {
    id: 'claude',
    name: 'Claude',
    simpleName: 'Claude',
    builderName: 'Claude (Sonnet)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    requiresKey: true,
    keyPlaceholder: 'sk-ant-...',
    isLocal: false,
    envVar: 'ANTHROPIC_API_KEY',

    buildHeaders(apiKey) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    },

    buildBody(prompt) {
      return {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      };
    },

    parseResponse(data) {
      return data.content?.[0]?.text || 'No response generated.';
    },

    parseError(status, body) {
      if (status === 401) return 'Invalid Claude API key. Check your key in settings.';
      return `Claude API error (${status}): ${body.slice(0, 200)}`;
    },
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    simpleName: 'GPT',
    builderName: 'OpenAI (GPT-4o)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    isLocal: false,
    envVar: 'OPENAI_API_KEY',

    buildHeaders(apiKey) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
    },

    buildBody(prompt) {
      return {
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      };
    },

    parseResponse(data) {
      return data.choices?.[0]?.message?.content || 'No response generated.';
    },

    parseError(status, body) {
      if (status === 401) return 'Invalid OpenAI API key. Check your key in settings.';
      return `OpenAI API error (${status}): ${body.slice(0, 200)}`;
    },
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    simpleName: 'Local AI',
    builderName: 'Ollama (local)',
    endpoint: 'http://localhost:11434/api/chat',
    requiresKey: false,
    keyPlaceholder: '',
    isLocal: true,
    envVar: null,
    defaultModel: 'llama3',

    buildHeaders() {
      return { 'Content-Type': 'application/json' };
    },

    buildBody(prompt, model) {
      return {
        model: model || this.defaultModel || 'llama3',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      };
    },

    parseResponse(data) {
      return data.message?.content || 'No response generated.';
    },

    parseError(status, body) {
      if (status === 0 || !status) return 'Cannot connect to Ollama. Is it running? (ollama serve)';
      return `Ollama error (${status}): ${body.slice(0, 200)}`;
    },
  },
};

// Canonical review result contract
// Every review, regardless of provider, returns this shape
export function buildReviewResult({
  providerId,
  modelName,
  scopeType,
  scopeLabel,
  rawText,
  cached = false,
}) {
  return {
    reviewed_by: providerId,
    model_name: modelName,
    scope_type: scopeType,
    scope_label: scopeLabel,
    raw_text: rawText,
    cached,
    reviewed_at: Date.now(),
  };
}

// Canonical scaffold output contract
export function buildScaffoldResult({
  providerId,
  projectType,
  folderTree,
  keyModules,
  firstBuildStep,
  scaffoldPrompt,
}) {
  return {
    generated_by: providerId,
    project_type: projectType,
    folder_tree: folderTree,
    key_modules: keyModules,
    first_build_step: firstBuildStep,
    scaffold_prompt: scaffoldPrompt,
    generated_at: Date.now(),
  };
}

// --- Provider registry ---

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

export function getAllProviders() {
  return Object.values(PROVIDERS);
}

export function getCloudProviders() {
  return Object.values(PROVIDERS).filter(p => !p.isLocal);
}

export function getLocalProviders() {
  return Object.values(PROVIDERS).filter(p => p.isLocal);
}

export function getProviderIds() {
  return Object.keys(PROVIDERS);
}

// Dynamic provider registration (for discovered local servers)
export function registerProvider(config) {
  PROVIDERS[config.id] = config;
}

export function removeProvider(id) {
  if (PROVIDERS[id]?.isLocal) {
    delete PROVIDERS[id];
  }
}

// Factory: create an OpenAI-compatible local provider
export function createOpenAICompatibleProvider(id, name, baseUrl, modelName) {
  return {
    id,
    name,
    simpleName: name,
    builderName: `${name} (local)`,
    endpoint: `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
    requiresKey: false,
    keyPlaceholder: '',
    isLocal: true,
    envVar: null,
    defaultModel: modelName || 'default',

    buildHeaders() {
      return { 'Content-Type': 'application/json' };
    },

    buildBody(prompt, model) {
      return {
        model: model || this.defaultModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      };
    },

    parseResponse(data) {
      return data.choices?.[0]?.message?.content || 'No response generated.';
    },

    parseError(status, body) {
      if (status === 0 || !status) return `Cannot connect to ${name}. Is it running?`;
      return `${name} error (${status}): ${body.slice(0, 200)}`;
    },
  };
}

// Factory: create an Ollama-native provider
export function createOllamaProvider(id, name, baseUrl, modelName) {
  return {
    id,
    name,
    simpleName: name,
    builderName: `${name} (local)`,
    endpoint: `${baseUrl}/api/chat`,
    requiresKey: false,
    keyPlaceholder: '',
    isLocal: true,
    envVar: null,
    defaultModel: modelName || 'llama3',

    buildHeaders() {
      return { 'Content-Type': 'application/json' };
    },

    buildBody(prompt, model) {
      return {
        model: model || this.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      };
    },

    parseResponse(data) {
      return data.message?.content || 'No response generated.';
    },

    parseError(status, body) {
      if (status === 0 || !status) return `Cannot connect to ${name}. Is it running?`;
      return `${name} error (${status}): ${body.slice(0, 200)}`;
    },
  };
}

// --- Provider calls ---

export async function callProvider(providerId, prompt, apiKey, modelOverride) {
  const provider = PROVIDERS[providerId];
  if (!provider) return { error: `Unknown provider: ${providerId}` };

  if (provider.requiresKey && !apiKey) {
    return { error: `API key not set for ${provider.name}. Add it in settings.` };
  }

  const headers = provider.buildHeaders(apiKey);
  const body = provider.buildBody(prompt, modelOverride);

  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { error: provider.parseError(response.status, errBody) };
    }

    const data = await response.json();
    const text = provider.parseResponse(data);
    return { text };
  } catch (err) {
    if (provider.isLocal) {
      return { error: `Cannot connect to ${provider.name}. Is it running?` };
    }
    return { error: `Network error (${provider.name}): ${err.message}` };
  }
}

export default PROVIDERS;
