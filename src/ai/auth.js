// Credential resolution chain
// Order: env var → project .env → stored API key
// No OAuth in this version

import { getProvider } from './providers.js';

export async function resolveCredentials(providerId, projectPath) {
  const provider = getProvider(providerId);
  if (!provider) return { type: 'none', value: '' };

  // Local providers don't need credentials
  if (!provider.requiresKey) {
    return { type: 'local', value: '' };
  }

  // 1. Check environment variable
  if (provider.envVar) {
    try {
      const envValue = await window.electronAPI?.resolveAuth(providerId, projectPath);
      if (envValue?.type === 'env' && envValue.value) {
        return envValue;
      }
      if (envValue?.type === 'dotenv' && envValue.value) {
        return envValue;
      }
    } catch {}
  }

  // 2. Check stored API key
  try {
    const settings = await window.electronAPI?.loadSettings();
    const storedKey = settings?.apiKeys?.[providerId];
    if (storedKey) {
      return { type: 'key', value: storedKey };
    }
  } catch {}

  return { type: 'none', value: '' };
}

// Get auth status for display (does not return the actual key)
export async function getAuthStatus(providerId, projectPath) {
  const result = await resolveCredentials(providerId, projectPath);
  return {
    providerId,
    authenticated: result.type !== 'none',
    method: result.type, // 'env', 'dotenv', 'key', 'local', 'none'
  };
}

// Get auth status for all providers
export async function getAllAuthStatuses(projectPath) {
  const providers = ['claude', 'openai'];
  const statuses = {};
  for (const id of providers) {
    const status = await getAuthStatus(id, projectPath);
    statuses[id] = status.authenticated ? 'green' : '';
  }
  return statuses;
}
