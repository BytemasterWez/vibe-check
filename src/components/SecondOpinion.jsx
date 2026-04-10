import { useState, useEffect, useCallback } from 'react';
import { useExperienceMode } from './ExperienceModeContext';
import { reviewChanges, getReviewCooldownRemaining } from '../ai/reviewer';
import { getProvider, registerProvider, createOpenAICompatibleProvider, createOllamaProvider } from '../ai/providers';
import { getAllAuthStatuses, resolveCredentials } from '../ai/auth';
import ModelSelector from './ModelSelector';
import LocalModelPicker from './LocalModelPicker';

function treeToString(node, depth = 0) {
  if (!node) return '';
  const indent = '  '.repeat(depth);
  let result = `${indent}${node.name}/\n`;
  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'dir') {
        result += treeToString(child, depth + 1);
      } else {
        result += `${indent}  ${child.name}\n`;
      }
    }
  }
  return result;
}

export default function SecondOpinion({ events, treeData, stats, projectPath, selectedNode }) {
  const { mode } = useExperienceMode();
  const [apiKeys, setApiKeys] = useState({ claude: '', openai: '', ollama: '' });
  const [ollamaModel, setOllamaModel] = useState('llama3');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [reviewScope, setReviewScope] = useState('latest');
  const [selectedProvider, setSelectedProvider] = useState('claude');
  const [discoveredServers, setDiscoveredServers] = useState([]);
  const [localModel, setLocalModel] = useState('');
  const [authStatus, setAuthStatus] = useState({});

  // Discovery polling — scan for local LLMs on mount and every 60s
  useEffect(() => {
    const scan = async () => {
      try {
        const servers = await window.electronAPI?.discoverLocalServers();
        if (servers) {
          setDiscoveredServers(servers);
          // Register discovered servers as providers
          for (const server of servers) {
            const existing = getProvider(server.id);
            if (!existing) {
              const provider = server.id === 'ollama'
                ? createOllamaProvider(server.id, server.name, server.baseUrl, server.models?.[0]?.id)
                : createOpenAICompatibleProvider(server.id, server.name, server.baseUrl, server.models?.[0]?.id);
              registerProvider(provider);
            }
          }
        }
      } catch {}
    };
    scan();
    const interval = setInterval(scan, 60000);
    return () => clearInterval(interval);
  }, []);

  // Load settings
  useEffect(() => {
    window.electronAPI?.loadSettings().then((settings) => {
      // Backward compat: migrate single apiKey to apiKeys
      if (settings?.apiKey && !settings?.apiKeys) {
        setApiKeys({ claude: settings.apiKey, openai: '', ollama: '' });
      } else if (settings?.apiKeys) {
        setApiKeys(prev => ({ ...prev, ...settings.apiKeys }));
      }
      if (settings?.ollamaModel) setOllamaModel(settings.ollamaModel);
    }).catch(() => {});

    // Check auth status for cloud providers
    getAllAuthStatuses(projectPath).then(setAuthStatus).catch(() => {});
  }, [projectPath]);

  // Cooldown timer — tracks selected provider
  useEffect(() => {
    const interval = setInterval(() => {
      setCooldown(getReviewCooldownRemaining(selectedProvider));
    }, 1000);
    return () => clearInterval(interval);
  }, [selectedProvider]);

  const saveApiKeys = async (keys) => {
    setApiKeys(keys);
    try {
      const settings = await window.electronAPI?.loadSettings() || {};
      await window.electronAPI?.saveSettings({ ...settings, apiKeys: keys, ollamaModel });
    } catch {}
  };

  const handleReview = useCallback(async () => {
    const provider = getProvider(selectedProvider);
    if (!provider) return;

    // Try credential resolution first
    let resolvedKey = apiKeys[selectedProvider];
    if (provider.requiresKey && !resolvedKey) {
      const creds = await resolveCredentials(selectedProvider, projectPath);
      if (creds.type !== 'none' && creds.value) {
        resolvedKey = creds.value;
      } else {
        setShowKeyInput(true);
        return;
      }
    }

    setReviewing(true);
    setError(null);

    // Build context
    const changedFiles = events
      .filter(e => e.eventType !== 'addDir' && e.eventType !== 'unlinkDir')
      .filter(e => {
        if (reviewScope === 'subtree' && selectedNode?.path) {
          return e.filePath.startsWith(selectedNode.path);
        }
        return true;
      })
      .reduce((map, e) => {
        map.set(e.filePath, e);
        return map;
      }, new Map());

    const fileList = [...changedFiles.values()].map(e => ({
      path: e.filePath,
      eventType: e.eventType,
      lines: e.metadata?.lines || 0,
      imports: e.metadata?.imports || 0,
      exports: e.metadata?.exports || 0,
      content: '',
    }));

    for (const file of fileList.slice(0, 5)) {
      try {
        const result = await window.electronAPI?.readFile(projectPath, file.path);
        if (result?.content) file.content = result.content;
      } catch {}
    }

    const badges = events
      .filter(e => e.badges && e.badges.length > 0)
      .flatMap(e => e.badges.map(b => ({
        file: e.filePath,
        badge: b.id,
        severity: b.severity,
      })));

    const scopeLabel = reviewScope === 'subtree'
      ? `Selected subtree: ${selectedNode?.path || 'root'}`
      : 'All changes this session';

    const context = {
      scope: scopeLabel,
      changedFiles: fileList,
      treeStructure: treeToString(treeData),
      badges,
      stats: stats || { created: 0, modified: 0, deleted: 0, hottestBranch: null },
    };

    const response = await reviewChanges({
      providerId: selectedProvider,
      apiKey: resolvedKey,
      ollamaModel,
      context,
      mode: reviewScope === 'plain' ? 'simple' : mode,
      scopeType: reviewScope,
      scopeLabel,
    });

    setReviewing(false);

    if (response.error) {
      setError(response.error);
    } else {
      setResult(response.result);
      if (response.result.cached) {
        setError('(Cached result — no changes since last review)');
      }
    }
  }, [apiKeys, ollamaModel, events, treeData, stats, projectPath, selectedNode, reviewScope, mode, selectedProvider]);

  const provider = getProvider(selectedProvider);

  return (
    <div className="second-opinion">
      <div className="opinion-header">
        <div className="inspect-label">
          {mode === 'simple' ? 'Get a second opinion' : 'Inspector Engine'}
        </div>
      </div>

      {/* Model selector */}
      <ModelSelector
        selectedProvider={selectedProvider}
        onProviderChange={(id) => {
          setSelectedProvider(id);
          setResult(null);
          setError(null);
        }}
        discoveredServers={discoveredServers}
        authStatus={authStatus}
      />

      {/* Local model picker */}
      {getProvider(selectedProvider)?.isLocal && discoveredServers.length > 0 && (
        <LocalModelPicker
          server={discoveredServers.find(s => s.id === selectedProvider)}
          selectedModel={localModel}
          onModelChange={setLocalModel}
        />
      )}

      {/* API Key input */}
      {showKeyInput && provider?.requiresKey && (
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
            onClick={() => {
              saveApiKeys(apiKeys);
              setShowKeyInput(false);
            }}
          >
            Save
          </button>
        </div>
      )}

      {/* Ollama model selector */}
      {showKeyInput && selectedProvider === 'ollama' && (
        <div className="api-key-input">
          <input
            type="text"
            placeholder="Model name (e.g. llama3, codellama)"
            value={ollamaModel}
            onChange={(e) => setOllamaModel(e.target.value)}
            className="key-input"
          />
          <button
            className="toolbar-btn"
            onClick={async () => {
              const settings = await window.electronAPI?.loadSettings() || {};
              await window.electronAPI?.saveSettings({ ...settings, ollamaModel });
              setShowKeyInput(false);
            }}
          >
            Save
          </button>
        </div>
      )}

      {/* Review scope selector */}
      <div className="review-scopes">
        <button
          className={`scope-btn ${reviewScope === 'latest' ? 'active' : ''}`}
          onClick={() => setReviewScope('latest')}
        >
          {mode === 'simple' ? 'Review all changes' : 'Review latest'}
        </button>
        {selectedNode && (
          <button
            className={`scope-btn ${reviewScope === 'subtree' ? 'active' : ''}`}
            onClick={() => setReviewScope('subtree')}
          >
            {mode === 'simple' ? 'Review this area' : 'Review subtree'}
          </button>
        )}
        <button
          className={`scope-btn ${reviewScope === 'plain' ? 'active' : ''}`}
          onClick={() => setReviewScope('plain')}
        >
          Explain risks simply
        </button>
      </div>

      {/* Review button */}
      <button
        className="review-btn"
        onClick={handleReview}
        disabled={reviewing || cooldown > 0 || events.length === 0}
      >
        {reviewing ? `⏳ Asking ${provider?.simpleName}...` :
         cooldown > 0 ? `Wait ${cooldown}s` :
         events.length === 0 ? 'No changes to review' :
         mode === 'simple'
           ? `🔍 Check with ${provider?.simpleName}`
           : `🔍 Inspect with ${provider?.builderName}`}
      </button>

      {/* Settings link */}
      <button
        className="key-toggle"
        onClick={() => setShowKeyInput(!showKeyInput)}
      >
        {provider?.requiresKey
          ? (apiKeys[selectedProvider] ? `🔑 Change ${provider.name} key` : `🔑 Set ${provider.name} key`)
          : `⚙ ${provider?.name} settings`}
      </button>

      {/* Error */}
      {error && (
        <div className="review-error">{error}</div>
      )}

      {/* Result */}
      {result && (
        <div className="review-result">
          <div className="review-provider-tag">
            Reviewed by {result.model_name}
            {result.cached && ' (cached)'}
          </div>
          {result.raw_text.split('\n').map((line, i) => {
            if (line.startsWith('**') && line.endsWith('**')) {
              return <h4 key={i} className="review-heading">{line.replace(/\*\*/g, '')}</h4>;
            }
            if (line.startsWith('**')) {
              const parts = line.split('**');
              return (
                <p key={i} className="review-line">
                  <strong>{parts[1]}</strong>{parts[2] || ''}
                </p>
              );
            }
            if (line.startsWith('- ')) {
              return <div key={i} className="review-bullet">{line}</div>;
            }
            if (line.match(/^\d+\./)) {
              return <div key={i} className="review-numbered">{line}</div>;
            }
            if (line.trim() === '') return <br key={i} />;
            return <p key={i} className="review-line">{line}</p>;
          })}
        </div>
      )}
    </div>
  );
}
