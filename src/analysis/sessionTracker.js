import { computeFileBadges, computeBranchBadges } from './healthBadges.js';

export function createSessionTracker() {
  let events = [];
  let fileMap = new Map(); // filePath -> latest state

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

  function getFileMap() {
    return fileMap;
  }

  function getStats() {
    let created = 0;
    let modified = 0;
    let deleted = 0;
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

    // Find hottest branch (most activity)
    let hottestBranch = null;
    let hottestCount = 0;
    for (const [branch, count] of branchActivity) {
      if (count > hottestCount) {
        hottestBranch = branch;
        hottestCount = count;
      }
    }

    return { created, modified, deleted, hottestBranch, hottestCount, totalEvents: events.length };
  }

  function buildTreeData() {
    const root = { name: 'root', path: '.', children: [], type: 'dir' };
    const dirMap = new Map();
    dirMap.set('.', root);

    // Sort files to ensure parents are created before children
    const sortedPaths = [...fileMap.keys()].sort();

    for (const filePath of sortedPaths) {
      const event = fileMap.get(filePath);
      const parts = filePath.split('/');
      let currentPath = '.';

      // Create directory nodes
      for (let i = 0; i < parts.length - 1; i++) {
        const parentPath = currentPath;
        currentPath = currentPath === '.' ? parts[i] : `${currentPath}/${parts[i]}`;

        if (!dirMap.has(currentPath)) {
          const dirNode = {
            name: parts[i],
            path: currentPath,
            children: [],
            type: 'dir',
          };
          dirMap.set(currentPath, dirNode);
          const parent = dirMap.get(parentPath);
          if (parent) parent.children.push(dirNode);
        }
      }

      // Create file node
      const fileName = parts[parts.length - 1];
      const parentPath = parts.length > 1
        ? parts.slice(0, -1).join('/')
        : '.';

      const allFiles = [...fileMap.values()].map(e => ({
        path: e.filePath,
        name: e.filePath.split('/').pop(),
        metadata: e.metadata,
      }));

      const fileNodeForBadges = {
        name: fileName,
        path: filePath,
        metadata: event.metadata,
      };
      const badges = computeFileBadges(fileNodeForBadges, allFiles);

      const fileNode = {
        name: fileName,
        path: filePath,
        type: 'file',
        metadata: event.metadata,
        badges,
        timestamp: event.timestamp,
        eventType: event.eventType,
      };

      const parent = dirMap.get(parentPath);
      if (parent) {
        // Replace if already exists (updated file)
        const existing = parent.children.findIndex(c => c.path === filePath);
        if (existing >= 0) {
          parent.children[existing] = fileNode;
        } else {
          parent.children.push(fileNode);
        }
      }
    }

    // Compute branch badges for all directories
    for (const [, dirNode] of dirMap) {
      dirNode.badges = computeBranchBadges(dirNode);
    }

    return root;
  }

  function clear() {
    events = [];
    fileMap.clear();
  }

  return { addEvent, getEvents, getFileMap, getStats, buildTreeData, clear };
}
