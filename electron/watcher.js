const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let watcher = null;
let sessionId = null;
let sessionLogStream = null;
let projectRoot = null;

const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.vibe-check/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/.env',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/.DS_Store',
];

function generateSessionId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${date}-${rand}`;
}

function getFileMetadata(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n').length;

    // Simple import/export counting (Tree-sitter replaces this in Day 4)
    const importMatches = content.match(/^import\s/gm) || [];
    const requireMatches = content.match(/require\(/gm) || [];
    const exportMatches = content.match(/^export\s/gm) || [];
    const moduleExports = content.match(/module\.exports/gm) || [];

    return {
      lines,
      sizeBytes: stat.size,
      imports: importMatches.length + requireMatches.length,
      exports: exportMatches.length + moduleExports.length,
    };
  } catch {
    return { lines: null, sizeBytes: 0, imports: null, exports: null };
  }
}

function buildEvent(eventType, filePath) {
  const relativePath = path.relative(projectRoot, filePath);
  const branchPath = path.dirname(relativePath);
  const fullPath = filePath;

  let metadata = { lines: null, sizeBytes: 0, imports: null, exports: null };
  if (eventType !== 'unlink' && eventType !== 'unlinkDir') {
    metadata = getFileMetadata(fullPath);
  }

  return {
    sessionId,
    timestamp: Date.now(),
    eventType,
    filePath: relativePath,
    branchPath,
    metadata,
    badges: [],
    diffSummaryHash: '',
  };
}

function persistEvent(event) {
  if (sessionLogStream) {
    sessionLogStream.write(JSON.stringify(event) + '\n');
  }
}

function startWatching(dirPath, mainWindow) {
  stopWatching();

  projectRoot = dirPath;
  sessionId = generateSessionId();

  // Create session log directory
  const logDir = path.join(dirPath, '.vibe-check', 'sessions');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${sessionId}.jsonl`);
  sessionLogStream = fs.createWriteStream(logPath, { flags: 'a' });

  watcher = chokidar.watch(dirPath, {
    ignored: IGNORED,
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  const sendEvent = (eventType, filePath) => {
    const event = buildEvent(eventType, filePath);
    persistEvent(event);
    mainWindow.webContents.send('watcher:event', event);
  };

  watcher
    .on('add', (fp) => sendEvent('add', fp))
    .on('change', (fp) => sendEvent('change', fp))
    .on('unlink', (fp) => sendEvent('unlink', fp))
    .on('addDir', (fp) => sendEvent('addDir', fp))
    .on('unlinkDir', (fp) => sendEvent('unlinkDir', fp))
    .on('ready', () => {
      mainWindow.webContents.send('watcher:ready', { sessionId, projectRoot: dirPath });
    })
    .on('error', (err) => {
      console.error('Watcher error:', err.message);
    });
}

function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (sessionLogStream) {
    sessionLogStream.end();
    sessionLogStream = null;
  }
  projectRoot = null;
  sessionId = null;
}

module.exports = { startWatching, stopWatching };
