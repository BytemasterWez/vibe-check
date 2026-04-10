import { useState, useEffect } from 'react';

export default function LocalModelPicker({ server, selectedModel, onModelChange }) {
  const [models, setModels] = useState(server?.models || []);

  useEffect(() => {
    if (server?.models) {
      setModels(server.models);
      // Auto-select first model if none selected
      if (!selectedModel && server.models.length > 0) {
        onModelChange(server.models[0].id);
      }
    }
  }, [server]);

  if (!models.length) {
    return (
      <div className="local-model-picker">
        <span className="picker-empty">No models loaded in {server?.name}</span>
      </div>
    );
  }

  return (
    <div className="local-model-picker">
      <select
        className="model-dropdown"
        value={selectedModel || ''}
        onChange={(e) => onModelChange(e.target.value)}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
    </div>
  );
}
