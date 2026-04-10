import { callProvider, buildScaffoldResult } from './providers.js';

function buildScaffoldPrompt(description, mode) {
  const modeInstructions = mode === 'simple'
    ? `The user is not a developer. Use plain English everywhere.
For the folder tree, add a short plain-English explanation next to each folder/file.
For the scaffold prompt, write it so the user can paste it directly to an AI coding tool.`
    : `The user is a developer. Use technical language.
Include framework-specific details, config files, and naming conventions in the scaffold prompt.`;

  return `You are a project architect. A user wants to build something from scratch.

${modeInstructions}

The user described their project as:
"${description}"

Respond with EXACTLY this JSON format (no markdown fences, just raw JSON):
{
  "projectType": "one-line description of project type",
  "folderTree": "ASCII folder tree showing the recommended structure",
  "keyModules": ["list", "of", "key", "modules", "or", "areas"],
  "firstBuildStep": "what to build first and why",
  "scaffoldPrompt": "A detailed prompt the user can paste into Claude Code / Codex / Cursor to generate this project structure. Include folder layout, key files to create, tech stack, and naming conventions. Make it specific enough that an AI builder can create the full scaffold from this prompt alone."
}

Keep the folder tree practical — 10-20 files max for the initial scaffold.
Keep the scaffold prompt focused on STRUCTURE, not implementation details.
The scaffold prompt should explicitly say to keep files small and modular.`;
}

export async function generateScaffold({ providerId, apiKey, ollamaModel, description, mode }) {
  const prompt = buildScaffoldPrompt(description, mode);

  const response = await callProvider(providerId, prompt, apiKey, ollamaModel);

  if (response.error) {
    return { error: response.error };
  }

  // Parse the JSON response
  try {
    // Clean up response — sometimes models wrap in markdown fences
    let text = response.text.trim();
    if (text.startsWith('```json')) text = text.slice(7);
    if (text.startsWith('```')) text = text.slice(3);
    if (text.endsWith('```')) text = text.slice(0, -3);
    text = text.trim();

    const parsed = JSON.parse(text);

    return {
      result: buildScaffoldResult({
        providerId,
        projectType: parsed.projectType || 'Unknown project type',
        folderTree: parsed.folderTree || '',
        keyModules: parsed.keyModules || [],
        firstBuildStep: parsed.firstBuildStep || '',
        scaffoldPrompt: parsed.scaffoldPrompt || '',
      }),
    };
  } catch (parseErr) {
    // If JSON parsing fails, try to extract useful parts from raw text
    return {
      result: buildScaffoldResult({
        providerId,
        projectType: 'Project',
        folderTree: '',
        keyModules: [],
        firstBuildStep: '',
        scaffoldPrompt: response.text, // Use raw response as the prompt
      }),
      warning: 'Could not parse structured response. Using raw AI output as scaffold prompt.',
    };
  }
}
