import { createContext, useContext, useState, useEffect } from 'react';

const ExperienceModeContext = createContext();

export function ExperienceModeProvider({ children }) {
  const [mode, setMode] = useState(null); // null = not yet chosen, 'simple' or 'builder'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI?.loadSettings().then((settings) => {
      if (settings?.experienceMode) {
        setMode(settings.experienceMode);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const selectMode = async (newMode) => {
    setMode(newMode);
    try {
      const settings = await window.electronAPI?.loadSettings() || {};
      await window.electronAPI?.saveSettings({ ...settings, experienceMode: newMode });
    } catch {
      // Settings save failed — mode still works in memory
    }
  };

  const toggleMode = () => {
    const next = mode === 'simple' ? 'builder' : 'simple';
    selectMode(next);
  };

  return (
    <ExperienceModeContext.Provider value={{ mode, selectMode, toggleMode, loading }}>
      {children}
    </ExperienceModeContext.Provider>
  );
}

export function useExperienceMode() {
  const ctx = useContext(ExperienceModeContext);
  if (!ctx) throw new Error('useExperienceMode must be used within ExperienceModeProvider');
  return ctx;
}
