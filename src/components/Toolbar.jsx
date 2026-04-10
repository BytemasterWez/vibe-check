import { useState, useEffect } from 'react';
import { useExperienceMode } from './ExperienceModeContext';

export default function Toolbar({ projectPath, onSelectProject }) {
  const { mode, toggleMode } = useExperienceMode();
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    window.electronAPI?.isAlwaysOnTop().then(setPinned).catch(() => {});
  }, []);

  const handlePin = async () => {
    const newState = await window.electronAPI?.toggleAlwaysOnTop();
    setPinned(newState);
  };

  const projectName = projectPath
    ? projectPath.split('/').filter(Boolean).pop()
    : null;

  return (
    <div className="toolbar" onMouseDown={(e) => {
      // Allow dragging the window from the toolbar
      if (e.target.closest('button, select, .mode-toggle')) return;
    }}
    style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="toolbar-left">
        <span className="toolbar-logo">◉ Vibe Check</span>
        {projectName && (
          <span className="toolbar-project" title={projectPath}>
            {projectName}
          </span>
        )}
      </div>

      <div className="toolbar-center" style={{ WebkitAppRegion: 'no-drag' }}>
        <button className="toolbar-btn" onClick={onSelectProject}>
          {projectPath ? 'Change Project' : 'Open Project'}
        </button>
      </div>

      <div className="toolbar-right" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          className={`mode-toggle ${mode === 'builder' ? 'builder' : 'simple'}`}
          onClick={toggleMode}
          title={mode === 'builder' ? 'Switch to Simple View' : 'Switch to Builder View'}
        >
          {mode === 'builder' ? '⚙ Builder' : '◎ Simple'}
        </button>

        <button
          className={`toolbar-btn pin-btn ${pinned ? 'active' : ''}`}
          onClick={handlePin}
          title={pinned ? 'Unpin from top' : 'Pin on top'}
        >
          📌
        </button>

        <button className="toolbar-btn win-btn" onClick={() => window.electronAPI?.minimize()}>─</button>
        <button className="toolbar-btn win-btn" onClick={() => window.electronAPI?.maximize()}>□</button>
        <button className="toolbar-btn win-btn close-btn" onClick={() => window.electronAPI?.close()}>✕</button>
      </div>
    </div>
  );
}
