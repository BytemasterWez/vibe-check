#!/usr/bin/env node

// Vibe Check MCP Server
// Exposes project health and review tools via MCP protocol
//
// Usage:
//   Standalone: node mcp/server.js --dir /path/to/project
//   HTTP:       node mcp/server.js --dir /path/to/project --transport http --port 3100
//   Managed:    Spawned by Electron app (receives events via IPC)

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { getToolDefinitions, createToolHandlers } from './tools.mjs';
import { createBridge } from './bridge.mjs';

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

const projectDir = getArg('dir');
const transport = getArg('transport') || 'stdio';
const port = parseInt(getArg('port') || '3100', 10);
const apiKey = getArg('api-key') || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';

// --- Create session state ---
// Dynamic import since sessionState uses ES module imports
let state;

async function initState() {
  const { createSessionState } = await import('./state.mjs');
  state = createSessionState();

  // Try managed mode first (child process of Electron)
  const bridge = createBridge(state);
  const isManaged = bridge.start();

  if (!isManaged && projectDir) {
    // Standalone mode: start our own watcher
    console.error(`[vibe-check] Standalone mode, watching: ${projectDir}`);
    await startStandaloneWatcher(projectDir);
  } else if (isManaged) {
    console.error('[vibe-check] Managed mode, receiving events from Electron');
  } else {
    console.error('[vibe-check] No --dir specified and not in managed mode. State will be empty.');
  }
}

async function startStandaloneWatcher(dir) {
  try {
    const chokidar = await import('chokidar');
    const path = await import('path');
    const fs = await import('fs');

    const IGNORED = [
      '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
      '**/.vibe-check/**', '**/.next/**', '**/__pycache__/**',
      '**/venv/**', '**/.env', '**/package-lock.json', '**/yarn.lock', '**/.DS_Store',
    ];

    const watcher = chokidar.watch(dir, {
      ignored: IGNORED,
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const buildEvent = (eventType, filePath) => {
      const relativePath = path.default.relative(dir, filePath);
      const branchPath = path.default.dirname(relativePath);

      let metadata = { lines: null, sizeBytes: 0, imports: null, exports: null };
      if (eventType !== 'unlink' && eventType !== 'unlinkDir') {
        try {
          const stat = fs.default.statSync(filePath);
          const content = fs.default.readFileSync(filePath, 'utf-8');
          metadata = {
            lines: content.split('\n').length,
            sizeBytes: stat.size,
            imports: (content.match(/^import\s/gm) || []).length + (content.match(/require\(/gm) || []).length,
            exports: (content.match(/^export\s/gm) || []).length + (content.match(/module\.exports/gm) || []).length,
          };
        } catch {}
      }

      return {
        sessionId: 'standalone',
        timestamp: Date.now(),
        eventType,
        filePath: relativePath,
        branchPath,
        metadata,
        badges: [],
        diffSummaryHash: '',
      };
    };

    watcher
      .on('add', (fp) => state.addEvent(buildEvent('add', fp)))
      .on('change', (fp) => state.addEvent(buildEvent('change', fp)))
      .on('unlink', (fp) => state.addEvent(buildEvent('unlink', fp)))
      .on('addDir', (fp) => state.addEvent(buildEvent('addDir', fp)))
      .on('unlinkDir', (fp) => state.addEvent(buildEvent('unlinkDir', fp)))
      .on('error', (err) => console.error('[vibe-check] Watcher error:', err.message));
  } catch (err) {
    console.error('[vibe-check] Failed to start watcher:', err.message);
  }
}

// --- Create MCP server ---
async function main() {
  await initState();

  const server = new Server(
    { name: 'vibe-check', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const tools = getToolDefinitions();
  // Simple provider call for MCP context (no dependency on src/)
  async function mcpCallProvider(prompt) {
    const endpoint = 'https://api.anthropic.com/v1/messages';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) return `API error: ${res.status}`;
      const data = await res.json();
      return data.content?.[0]?.text || 'No response';
    } catch (err) {
      return `Network error: ${err.message}`;
    }
  }

  const handlers = createToolHandlers(state, {
    reviewFn: apiKey ? async (provider, scope) => {
      const stats = state.getStats();
      const events = state.getRecentEvents(null, 20);
      const prompt = `Review these code changes. Stats: ${JSON.stringify(stats)}. Recent events: ${JSON.stringify(events.slice(-10))}. Be concise.`;
      return await mcpCallProvider(prompt);
    } : null,

    scaffoldFn: apiKey ? async (description, provider) => {
      const prompt = `Generate a project scaffold for: "${description}". Return JSON with: projectType, folderTree, keyModules, firstBuildStep, scaffoldPrompt.`;
      return await mcpCallProvider(prompt);
    } : null,
  });

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
    try {
      return await handler(args || {});
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
    }
  });

  // Start transport
  if (transport === 'stdio') {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error('[vibe-check] MCP server running on stdio');
  } else if (transport === 'http') {
    // For HTTP, use a simple wrapper
    const http = await import('http');
    console.error(`[vibe-check] MCP server running on http://localhost:${port}`);
    console.error('[vibe-check] Note: Full HTTP MCP transport requires additional setup. Using simple JSON-RPC endpoint.');

    const httpServer = http.default.createServer(async (req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const request = JSON.parse(body);
            const { method, params, id } = request;

            let result;
            if (method === 'tools/list') {
              result = { tools };
            } else if (method === 'tools/call') {
              const handler = handlers[params?.name];
              if (handler) {
                result = await handler(params?.arguments || {});
              } else {
                result = { content: [{ type: 'text', text: `Unknown tool: ${params?.name}` }] };
              }
            } else {
              result = { error: `Unknown method: ${method}` };
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { message: err.message } }));
          }
        });
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', tools: tools.map(t => t.name) }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    httpServer.listen(port);
  }
}

main().catch((err) => {
  console.error('[vibe-check] Fatal error:', err);
  process.exit(1);
});
