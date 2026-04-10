// IPC bridge for managed mode
// When the MCP server is spawned by the Electron app, this module
// receives live state updates from the Electron main process

export function createBridge(state) {
  let connected = false;

  function start() {
    if (typeof process.send !== 'function') {
      // Not running as a child process — standalone mode
      return false;
    }

    connected = true;

    process.on('message', (msg) => {
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'watcher:event':
          state.addEvent(msg.event);
          break;
        case 'watcher:clear':
          state.clear();
          break;
        case 'ping':
          process.send({ type: 'pong' });
          break;
      }
    });

    // Signal ready
    process.send({ type: 'mcp:ready' });
    return true;
  }

  function isConnected() {
    return connected;
  }

  return { start, isConnected };
}
