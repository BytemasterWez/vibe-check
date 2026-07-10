#!/usr/bin/env node
// Node's global fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY is set
// at process start (it's read during runtime init, before user code runs, so
// setting process.env later has no effect). In proxied environments — e.g.
// Claude Code remote, corporate networks — a direct connection is blocked and
// the request must go through the proxy. When a proxy is configured but not yet
// honored, re-exec once with the flag set so network commands "just work".
import { spawnSync } from 'node:child_process';

const NETWORK_COMMANDS = new Set(['doctor', 'fetch', 'ingest']);
const command = process.argv[2];
const proxy =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy;

if (proxy && !process.env.NODE_USE_ENV_PROXY && NETWORK_COMMANDS.has(command)) {
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: '1',
      // The EnvHttpProxyAgent is experimental; silence just its warning.
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --disable-warning=UNDICI-EHPA`.trim(),
    },
  });
  process.exit(result.status ?? 1);
}

const { run } = await import('../src/cli.js');
process.exitCode = await run(process.argv.slice(2));
