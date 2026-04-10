// Standalone session state for MCP server
// Simplified version of src/state/sessionState.js + src/analysis/sessionTracker.js
// Does not depend on React or Vite — pure Node.js

export function createSessionState() {
  let events = [];
  let fileMap = new Map();

  function addEvent(event) {
    events.push(event);
    if (event.eventType === 'unlink' || event.eventType === 'unlinkDir') {
      fileMap.delete(event.filePath);
    } else {
      fileMap.set(event.filePath, event);
    }
  }

  function getEvents() {
    return events;
  }

  function getRecentEvents(sinceTimestamp, limit = 50) {
    let filtered = events;
    if (sinceTimestamp) {
      filtered = events.filter(e => e.timestamp > sinceTimestamp);
    }
    return filtered.slice(-limit);
  }

  function getStats() {
    let created = 0, modified = 0, deleted = 0;
    const branchActivity = new Map();

    for (const event of events) {
      if (event.eventType === 'add') created++;
      else if (event.eventType === 'change') modified++;
      else if (event.eventType === 'unlink') deleted++;

      if (event.eventType !== 'addDir' && event.eventType !== 'unlinkDir') {
        const count = branchActivity.get(event.branchPath) || 0;
        branchActivity.set(event.branchPath, count + 1);
      }
    }

    let hottestBranch = null, hottestCount = 0;
    for (const [branch, count] of branchActivity) {
      if (count > hottestCount) { hottestBranch = branch; hottestCount = count; }
    }

    return { created, modified, deleted, hottestBranch, hottestCount, totalEvents: events.length };
  }

  function getTreeData() {
    const root = { name: 'root', path: '.', children: [], type: 'dir' };
    const dirMap = new Map();
    dirMap.set('.', root);

    const sortedPaths = [...fileMap.keys()].sort();

    for (const filePath of sortedPaths) {
      const event = fileMap.get(filePath);
      const parts = filePath.split('/');
      let currentPath = '.';

      for (let i = 0; i < parts.length - 1; i++) {
        const parentPath = currentPath;
        currentPath = currentPath === '.' ? parts[i] : `${currentPath}/${parts[i]}`;
        if (!dirMap.has(currentPath)) {
          const dirNode = { name: parts[i], path: currentPath, children: [], type: 'dir', badges: [] };
          dirMap.set(currentPath, dirNode);
          const parent = dirMap.get(parentPath);
          if (parent) parent.children.push(dirNode);
        }
      }

      const fileName = parts[parts.length - 1];
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';

      // Simple health badges
      const badges = [];
      if (event.metadata?.lines > 500) badges.push({ id: 'oversized', severity: 'red', value: event.metadata.lines });
      else if (event.metadata?.lines > 300) badges.push({ id: 'oversized', severity: 'yellow', value: event.metadata.lines });
      if (event.metadata?.imports > 25) badges.push({ id: 'importHeavy', severity: 'red', value: event.metadata.imports });
      else if (event.metadata?.imports > 15) badges.push({ id: 'importHeavy', severity: 'yellow', value: event.metadata.imports });
      if (event.metadata?.exports > 10) badges.push({ id: 'highSurfaceArea', severity: 'yellow', value: event.metadata.exports });

      const fileNode = {
        name: fileName, path: filePath, type: 'file',
        metadata: event.metadata, badges,
        timestamp: event.timestamp, eventType: event.eventType,
      };

      const parent = dirMap.get(parentPath);
      if (parent) {
        const existing = parent.children.findIndex(c => c.path === filePath);
        if (existing >= 0) parent.children[existing] = fileNode;
        else parent.children.push(fileNode);
      }
    }

    return root;
  }

  function getFileMap() {
    return fileMap;
  }

  function getSnapshot() {
    return { tree: getTreeData(), stats: getStats(), eventCount: events.length };
  }

  function clear() {
    events = [];
    fileMap.clear();
  }

  return { addEvent, getEvents, getRecentEvents, getStats, getTreeData, getFileMap, getSnapshot, clear };
}
