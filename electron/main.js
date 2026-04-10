const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { startWatching, stopWatching } = require('./watcher');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load built Vite output
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Window control handlers
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:toggle-always-on-top', () => {
  if (mainWindow) {
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current);
    return !current;
  }
  return false;
});
ipcMain.handle('window:is-always-on-top', () => mainWindow?.isAlwaysOnTop() ?? false);

// Project directory picker
ipcMain.handle('dialog:open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Directory',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Settings persistence (simple JSON file)
const fs = require('fs');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    // Migrate single apiKey to apiKeys
    if (settings.apiKey && !settings.apiKeys) {
      settings.apiKeys = { claude: settings.apiKey, openai: '', ollama: '' };
      delete settings.apiKey;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    return settings;
  } catch {
    return { experienceMode: null, alwaysOnTop: true, apiKeys: { claude: '', openai: '', ollama: '' } };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// Credential resolution (env var → .env → stored key)
ipcMain.handle('auth:resolve', (_, { providerId, projectPath }) => {
  const ENV_VARS = {
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };

  const envVarName = ENV_VARS[providerId];

  // 1. Check environment variable
  if (envVarName && process.env[envVarName]) {
    return { type: 'env', value: process.env[envVarName] };
  }

  // 2. Check project .env file
  if (projectPath) {
    try {
      const envPath = path.join(projectPath, '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
          if (key.trim() === envVarName && value) {
            return { type: 'dotenv', value };
          }
        }
      }
    } catch {}
  }

  return { type: 'none', value: '' };
});

// Local LLM discovery
ipcMain.handle('discovery:scan', async () => {
  // Probe known local LLM endpoints
  const http = require('http');
  const results = [];

  const probe = (id, name, url, parseModels) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000);
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(data);
            resolve({ id, name, baseUrl: url.replace(/\/[^/]*$/, '').replace(/\/v1$/, '').replace(/\/api$/, ''), models: parseModels(json), available: true });
          } catch { resolve(null); }
        });
      });
      req.on('error', () => { clearTimeout(timeout); resolve(null); });
    });
  };

  const probes = [
    probe('ollama', 'Ollama', 'http://localhost:11434/api/tags',
      (d) => (d.models || []).map(m => ({ id: m.name, name: m.name }))),
    probe('lmstudio', 'LM Studio', 'http://localhost:1234/v1/models',
      (d) => (d.data || []).map(m => ({ id: m.id, name: m.id }))),
  ];

  // Add custom endpoints from settings
  const settings = loadSettings();
  if (settings.customEndpoints) {
    for (const ep of settings.customEndpoints) {
      probes.push(probe(ep.id, ep.name, `${ep.baseUrl}/v1/models`,
        (d) => (d.data || []).map(m => ({ id: m.id, name: m.id }))));
    }
  }

  const settled = await Promise.all(probes);
  return settled.filter(Boolean);
});

ipcMain.handle('discovery:list-models', async (_, baseUrl) => {
  const http = require('http');
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 2000);
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const json = JSON.parse(data);
          resolve((json.data || []).map(m => ({ id: m.id, name: m.id })));
        } catch { resolve([]); }
      });
    });
    req.on('error', () => { clearTimeout(timeout); resolve([]); });
  });
});

// Create directory for scaffold mode
ipcMain.handle('dialog:create-directory', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Create Project Folder',
    buttonLabel: 'Create',
    properties: ['createDirectory'],
  });
  if (result.canceled || !result.filePath) return null;

  // Create the directory
  fs.mkdirSync(result.filePath, { recursive: true });
  return result.filePath;
});

// Clipboard write
ipcMain.handle('clipboard:write', (_, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return true;
});

// File watcher
ipcMain.handle('watcher:start', (_, dirPath) => {
  startWatching(dirPath, mainWindow);
  return true;
});
ipcMain.handle('watcher:stop', () => {
  stopWatching();
  return true;
});

// Git diff support
const { execSync } = require('child_process');

ipcMain.handle('git:diff', (_, { projectPath, filePath }) => {
  try {
    // Check if it's a git repo
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectPath, encoding: 'utf-8' });

    try {
      // Try staged + unstaged diff
      const diff = execSync(`git diff HEAD -- "${filePath}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      });
      if (diff.trim()) return { type: 'diff', content: diff };

      // Check if file is untracked (new)
      const status = execSync(`git status --porcelain -- "${filePath}"`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      if (status.startsWith('??') || status.startsWith('A ')) {
        return { type: 'new', content: null };
      }

      return { type: 'unchanged', content: null };
    } catch {
      return { type: 'new', content: null };
    }
  } catch {
    return { type: 'no-git', content: null };
  }
});

ipcMain.handle('file:read', (_, { projectPath, filePath }) => {
  try {
    const fullPath = path.join(projectPath, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { content, lines: content.split('\n').length };
  } catch {
    return { content: null, lines: 0 };
  }
});

ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_, settings) => {
  saveSettings(settings);
  return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
