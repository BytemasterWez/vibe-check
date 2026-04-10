import { useState, useEffect } from 'react';
import { useExperienceMode } from './ExperienceModeContext';
import { generateScaffold } from '../ai/scaffolder';
import { getProvider, getAllProviders } from '../ai/providers';

export default function ScaffoldWizard({ onComplete, onCancel }) {
  const { mode } = useExperienceMode();
  const [step, setStep] = useState(1);
  const [description, setDescription] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('claude');
  const [apiKeys, setApiKeys] = useState({ claude: '', openai: '', ollama: '' });
  const [ollamaModel, setOllamaModel] = useState('llama3');
  const [generating, setGenerating] = useState(false);
  const [scaffoldResult, setScaffoldResult] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [copied, setCopied] = useState(false);

  // Load API keys from settings
  useEffect(() => {
    window.electronAPI?.loadSettings().then((settings) => {
      if (settings?.apiKeys) {
        setApiKeys(prev => ({ ...prev, ...settings.apiKeys }));
      } else if (settings?.apiKey) {
        setApiKeys(prev => ({ ...prev, claude: settings.apiKey }));
      }
      if (settings?.ollamaModel) setOllamaModel(settings.ollamaModel);
    }).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    const provider = getProvider(selectedProvider);
    if (provider?.requiresKey && !apiKeys[selectedProvider]) {
      setError(`Please set your ${provider.name} API key first.`);
      return;
    }

    setGenerating(true);
    setError(null);
    setWarning(null);

    const response = await generateScaffold({
      providerId: selectedProvider,
      apiKey: apiKeys[selectedProvider],
      ollamaModel,
      description,
      mode,
    });

    setGenerating(false);

    if (response.error) {
      setError(response.error);
    } else {
      setScaffoldResult(response.result);
      if (response.warning) setWarning(response.warning);
      setStep(2);
    }
  };

  const handleCopyPrompt = async () => {
    if (!scaffoldResult?.scaffold_prompt) return;
    try {
      await window.electronAPI?.writeClipboard(scaffoldResult.scaffold_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      navigator.clipboard?.writeText(scaffoldResult.scaffold_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleStartWatching = async () => {
    const dirPath = await window.electronAPI?.createDirectory();
    if (dirPath) {
      onComplete(dirPath);
    }
  };

  const handleOpenExisting = async () => {
    const dirPath = await window.electronAPI?.openDirectory();
    if (dirPath) {
      onComplete(dirPath);
    }
  };

  const provider = getProvider(selectedProvider);
  const providers = getAllProviders();

  // Step 1: Describe your project
  if (step === 1) {
    return (
      <div className="scaffold-wizard">
        <div className="scaffold-step-indicator">
          <span className="step-dot active">1</span>
          <span className="step-line" />
          <span className="step-dot">2</span>
          <span className="step-line" />
          <span className="step-dot">3</span>
        </div>

        <h2>
          {mode === 'simple'
            ? 'What do you want to build?'
            : 'Describe your project'}
        </h2>
        <p className="scaffold-subtitle">
          {mode === 'simple'
            ? 'Describe it in plain English. We\'ll suggest a project structure.'
            : 'Include tech preferences if any. We\'ll generate a scaffold prompt.'}
        </p>

        <textarea
          className="scaffold-input"
          placeholder={mode === 'simple'
            ? 'e.g. "A todo app where users can sign up, create lists, and share them with friends"'
            : 'e.g. "React + Express todo app with JWT auth, PostgreSQL, and REST API. Use TypeScript."'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />

        {/* Provider selector */}
        <div className="scaffold-provider">
          <span className="scaffold-provider-label">
            {mode === 'simple' ? 'Get suggestions from:' : 'Generate with:'}
          </span>
          <div className="model-selector">
            {providers.map((p) => (
              <button
                key={p.id}
                className={`model-btn ${selectedProvider === p.id ? 'active' : ''}`}
                onClick={() => setSelectedProvider(p.id)}
              >
                {mode === 'simple' ? p.simpleName : p.builderName}
              </button>
            ))}
          </div>
        </div>

        {/* API key if needed */}
        {provider?.requiresKey && !apiKeys[selectedProvider] && (
          <div className="api-key-input">
            <input
              type="password"
              placeholder={`${provider.name} API key (${provider.keyPlaceholder})`}
              value={apiKeys[selectedProvider] || ''}
              onChange={(e) => setApiKeys(prev => ({ ...prev, [selectedProvider]: e.target.value }))}
              className="key-input"
            />
            <button
              className="toolbar-btn"
              onClick={async () => {
                const settings = await window.electronAPI?.loadSettings() || {};
                await window.electronAPI?.saveSettings({ ...settings, apiKeys });
              }}
            >
              Save
            </button>
          </div>
        )}

        {error && <div className="review-error">{error}</div>}

        <div className="scaffold-actions">
          <button className="toolbar-btn" onClick={onCancel}>← Back</button>
          <button
            className="primary-btn"
            onClick={handleGenerate}
            disabled={!description.trim() || generating}
          >
            {generating ? '⏳ Generating...' : 'Suggest structure →'}
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Review suggested structure
  if (step === 2 && scaffoldResult) {
    return (
      <div className="scaffold-wizard">
        <div className="scaffold-step-indicator">
          <span className="step-dot done">✓</span>
          <span className="step-line done" />
          <span className="step-dot active">2</span>
          <span className="step-line" />
          <span className="step-dot">3</span>
        </div>

        <h2>
          {mode === 'simple'
            ? 'Here\'s a suggested structure'
            : 'Suggested project structure'}
        </h2>

        {warning && <div className="review-error">{warning}</div>}

        <div className="scaffold-review">
          <div className="scaffold-section">
            <div className="scaffold-section-label">Project type</div>
            <div className="scaffold-section-value">{scaffoldResult.project_type}</div>
          </div>

          {scaffoldResult.folder_tree && (
            <div className="scaffold-section">
              <div className="scaffold-section-label">
                {mode === 'simple' ? 'Folder layout' : 'Folder tree'}
              </div>
              <pre className="scaffold-tree">{scaffoldResult.folder_tree}</pre>
            </div>
          )}

          {scaffoldResult.key_modules.length > 0 && (
            <div className="scaffold-section">
              <div className="scaffold-section-label">
                {mode === 'simple' ? 'Key areas' : 'Key modules'}
              </div>
              <div className="scaffold-modules">
                {scaffoldResult.key_modules.map((mod, i) => (
                  <span key={i} className="scaffold-module-tag">{mod}</span>
                ))}
              </div>
            </div>
          )}

          {scaffoldResult.first_build_step && (
            <div className="scaffold-section">
              <div className="scaffold-section-label">
                {mode === 'simple' ? 'Start with' : 'First build step'}
              </div>
              <div className="scaffold-section-value">{scaffoldResult.first_build_step}</div>
            </div>
          )}
        </div>

        <div className="scaffold-actions">
          <button className="toolbar-btn" onClick={() => setStep(1)}>← Change description</button>
          <button
            className="toolbar-btn"
            onClick={() => {
              setScaffoldResult(null);
              handleGenerate();
            }}
          >
            🔄 Regenerate
          </button>
          <button className="primary-btn" onClick={() => setStep(3)}>
            Get scaffold prompt →
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Copy scaffold prompt and start watching
  if (step === 3 && scaffoldResult) {
    return (
      <div className="scaffold-wizard">
        <div className="scaffold-step-indicator">
          <span className="step-dot done">✓</span>
          <span className="step-line done" />
          <span className="step-dot done">✓</span>
          <span className="step-line done" />
          <span className="step-dot active">3</span>
        </div>

        <h2>
          {mode === 'simple'
            ? 'Copy this prompt and paste it to your AI builder'
            : 'Scaffold prompt ready'}
        </h2>
        <p className="scaffold-subtitle">
          {mode === 'simple'
            ? 'Paste this into Claude Code, Codex, or Cursor. Then click "Start watching" to monitor the build.'
            : 'Copy the prompt below, feed it to your builder, then start watching.'}
        </p>

        <div className="scaffold-prompt-container">
          <pre className="scaffold-prompt-text">{scaffoldResult.scaffold_prompt}</pre>
          <button
            className={`copy-prompt-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopyPrompt}
          >
            {copied ? '✓ Copied!' : '📋 Copy prompt'}
          </button>
        </div>

        <div className="scaffold-final-actions">
          <button className="primary-btn scaffold-start-btn" onClick={handleStartWatching}>
            📁 Create project folder & start watching
          </button>
          <button className="toolbar-btn" onClick={handleOpenExisting}>
            Or open an existing folder
          </button>
        </div>

        <div className="scaffold-actions">
          <button className="toolbar-btn" onClick={() => setStep(2)}>← Back to structure</button>
        </div>
      </div>
    );
  }

  return null;
}
