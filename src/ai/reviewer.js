import { callProvider, buildReviewResult, getProvider } from './providers.js';

const REVIEW_COOLDOWN_MS = 30000;

// Per-provider rate limiting and caching
const providerState = {};

function getState(providerId) {
  if (!providerState[providerId]) {
    providerState[providerId] = {
      lastReviewTime: 0,
      cachedHash: null,
      cachedResult: null,
    };
  }
  return providerState[providerId];
}

function hashReviewInput(input) {
  let hash = 0;
  const str = JSON.stringify(input);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function buildPrompt(context, mode) {
  const { scope, changedFiles, treeStructure, badges, stats } = context;

  const modeInstructions = mode === 'simple'
    ? `Respond in plain English. No jargon. The user is not a developer.
Format your response as:

**What the AI built:** [one sentence]
**Is it healthy?** [one sentence]
**Biggest risk:** [one sentence explaining why it matters]
**What to do next:**
- [actionable prompt the user can copy to their AI builder]
- [another action if needed]
- Safe to continue after that (or: stop and review first)`
    : `Respond with technical detail. The user is an experienced developer.
Format your response as:

**Summary:** [what was built/changed]
**Top concerns:**
1. [concern with specific file reference]
2. [concern]
3. [concern]
**Suggestion:** [one concrete refactoring or improvement]`;

  return `You are a code reviewer observing an AI-assisted coding session in real time.

${modeInstructions}

Scope: ${scope}

Changed files (${changedFiles.length}):
${changedFiles.map(f => `- ${f.path} (${f.eventType}, ${f.lines} lines, ${f.imports} imports, ${f.exports} exports)`).join('\n')}

Project structure:
${treeStructure}

Health badges triggered:
${badges.length > 0 ? badges.map(b => `- ${b.file}: ${b.badge} (${b.severity})`).join('\n') : 'None'}

Session stats: ${stats.created} files created, ${stats.modified} modified, ${stats.deleted} deleted
${stats.hottestBranch ? `Most active area: ${stats.hottestBranch}` : ''}

File contents (truncated):
${changedFiles.slice(0, 5).map(f => `--- ${f.path} ---\n${(f.content || '').slice(0, 1500)}`).join('\n\n')}

Review these changes. Be honest, specific, and actionable.`;
}

export async function reviewChanges({ providerId, apiKey, ollamaModel, context, mode, scopeType, scopeLabel }) {
  const state = getState(providerId);
  const provider = getProvider(providerId);
  if (!provider) return { error: `Unknown provider: ${providerId}` };

  // Per-provider rate limiting
  const now = Date.now();
  if (now - state.lastReviewTime < REVIEW_COOLDOWN_MS) {
    const waitSec = Math.ceil((REVIEW_COOLDOWN_MS - (now - state.lastReviewTime)) / 1000);
    return { error: `Please wait ${waitSec}s before requesting another ${provider.name} review.` };
  }

  // Per-provider cache check
  const inputHash = hashReviewInput({ providerId, ...context });
  if (inputHash === state.cachedHash && state.cachedResult) {
    return {
      result: buildReviewResult({
        providerId,
        modelName: provider.builderName,
        scopeType: scopeType || 'session',
        scopeLabel: scopeLabel || 'All changes',
        rawText: state.cachedResult,
        cached: true,
      }),
    };
  }

  const prompt = buildPrompt(context, mode);
  state.lastReviewTime = Date.now();

  const response = await callProvider(providerId, prompt, apiKey, ollamaModel);

  if (response.error) {
    return { error: response.error };
  }

  // Cache the result
  state.cachedHash = inputHash;
  state.cachedResult = response.text;

  return {
    result: buildReviewResult({
      providerId,
      modelName: provider.builderName,
      scopeType: scopeType || 'session',
      scopeLabel: scopeLabel || 'All changes',
      rawText: response.text,
      cached: false,
    }),
  };
}

export function getReviewCooldownRemaining(providerId) {
  const state = getState(providerId);
  const elapsed = Date.now() - state.lastReviewTime;
  if (elapsed >= REVIEW_COOLDOWN_MS) return 0;
  return Math.ceil((REVIEW_COOLDOWN_MS - elapsed) / 1000);
}
