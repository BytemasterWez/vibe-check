import { useExperienceMode } from './ExperienceModeContext';
import { getCloudProviders, getLocalProviders } from '../ai/providers';

export default function ModelSelector({ selectedProvider, onProviderChange, discoveredServers, authStatus }) {
  const { mode } = useExperienceMode();
  const cloudProviders = getCloudProviders();
  const localProviders = getLocalProviders();

  // Merge static local providers with dynamically discovered ones
  const allLocal = [...localProviders];
  if (discoveredServers) {
    for (const server of discoveredServers) {
      if (!allLocal.find(p => p.id === server.id)) {
        allLocal.push({
          id: server.id,
          name: server.name,
          simpleName: server.name,
          builderName: `${server.name} (local)`,
          isLocal: true,
        });
      }
    }
  }

  return (
    <div className="model-selector-grouped">
      {/* Cloud providers */}
      <div className="model-group">
        <span className="model-group-label">Cloud</span>
        <div className="model-group-buttons">
          {cloudProviders.map((provider) => {
            const status = authStatus?.[provider.id];
            return (
              <button
                key={provider.id}
                className={`model-btn ${selectedProvider === provider.id ? 'active' : ''}`}
                onClick={() => onProviderChange(provider.id)}
                title={provider.builderName}
              >
                {status && <span className={`auth-dot ${status}`} />}
                {mode === 'simple' ? provider.simpleName : provider.builderName}
              </button>
            );
          })}
        </div>
      </div>

      {/* Local providers */}
      <div className="model-group">
        <span className="model-group-label">Local</span>
        <div className="model-group-buttons">
          {allLocal.length > 0 ? (
            allLocal.map((provider) => (
              <button
                key={provider.id}
                className={`model-btn ${selectedProvider === provider.id ? 'active' : ''}`}
                onClick={() => onProviderChange(provider.id)}
                title={provider.builderName || provider.name}
              >
                <span className="auth-dot green" />
                {mode === 'simple' ? provider.simpleName : (provider.builderName || provider.name)}
              </button>
            ))
          ) : (
            <span className="model-none">No local AI found</span>
          )}
        </div>
      </div>
    </div>
  );
}
