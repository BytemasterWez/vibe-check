// Health badge definitions and logic
// Structured for Tree-sitter drop-in later — currently uses metadata from watcher

const THRESHOLDS = {
  oversized: { yellow: 300, red: 500 },
  importHeavy: { yellow: 15, red: 25 },
  highSurfaceArea: { threshold: 10 },
  flatDump: { threshold: 15 },
  deepNesting: { threshold: 5 },
};

// Badge label maps for each experience mode
const BADGE_LABELS = {
  builder: {
    oversized: (lines) => `Oversized: ${lines} lines`,
    importHeavy: (imports) => `Import-heavy: ${imports} imports`,
    highSurfaceArea: (exports) => `High surface area: ${exports} exports`,
    orphan: 'Likely orphan: not imported',
    flatDump: (count) => `Flat structure: ${count} files in directory`,
    deepNesting: (depth) => `Deep nesting: ${depth} levels`,
    fastestGrowing: 'Fastest growing branch',
  },
  simple: {
    oversized: () => 'This file is getting very long',
    importHeavy: () => 'This file depends on too many other files',
    highSurfaceArea: () => 'This file may be doing too many jobs',
    orphan: 'This file may not be connected to the app',
    flatDump: () => 'Too many files crammed into one folder',
    deepNesting: () => 'This folder is nested very deep',
    fastestGrowing: 'This is the most active area',
  },
};

// Framework-aware orphan exceptions
const ORPHAN_EXCEPTIONS = [
  /^index\.[jt]sx?$/,
  /^main\.[jt]sx?$/,
  /^app\.[jt]sx?$/,
  /config/i,
  /\.config\.[jt]s$/,
  /\.env/,
  /^server\.[jt]sx?$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /^route/i,
  /^page\.[jt]sx?$/,
  /^layout\.[jt]sx?$/,
  /^middleware\.[jt]sx?$/,
  /^setup/i,
  /^seed/i,
  /^migrate/i,
  /\.d\.ts$/,
];

function isOrphanException(fileName) {
  return ORPHAN_EXCEPTIONS.some((pattern) => pattern.test(fileName));
}

export function computeFileBadges(fileNode, allFiles) {
  const badges = [];
  const { metadata, name } = fileNode;
  if (!metadata) return badges;

  // Oversized
  if (metadata.lines !== null) {
    if (metadata.lines > THRESHOLDS.oversized.red) {
      badges.push({ id: 'oversized', severity: 'red', value: metadata.lines });
    } else if (metadata.lines > THRESHOLDS.oversized.yellow) {
      badges.push({ id: 'oversized', severity: 'yellow', value: metadata.lines });
    }
  }

  // Import-heavy
  if (metadata.imports !== null) {
    if (metadata.imports > THRESHOLDS.importHeavy.red) {
      badges.push({ id: 'importHeavy', severity: 'red', value: metadata.imports });
    } else if (metadata.imports > THRESHOLDS.importHeavy.yellow) {
      badges.push({ id: 'importHeavy', severity: 'yellow', value: metadata.imports });
    }
  }

  // High surface area
  if (metadata.exports !== null && metadata.exports > THRESHOLDS.highSurfaceArea.threshold) {
    badges.push({ id: 'highSurfaceArea', severity: 'yellow', value: metadata.exports });
  }

  // Orphan detection (soft warning)
  if (allFiles && !isOrphanException(name)) {
    const filePath = fileNode.path;
    const baseName = name.replace(/\.[^.]+$/, '');
    const isImported = allFiles.some(
      (f) => f.path !== filePath && f.metadata?.imports > 0
      // Simplified: we'd need actual import resolution for accuracy
      // For now, just check if ANY other file imports anything (placeholder)
    );
    // Only flag if no other file references this file's name
    // This is intentionally conservative — Tree-sitter will improve this
  }

  return badges;
}

export function computeBranchBadges(dirNode) {
  const badges = [];
  if (!dirNode.children) return badges;

  const fileCount = dirNode.children.filter((c) => c.type === 'file').length;

  // Flat dump
  if (fileCount > THRESHOLDS.flatDump.threshold) {
    badges.push({ id: 'flatDump', severity: 'yellow', value: fileCount });
  }

  // Deep nesting
  const depth = dirNode.path.split('/').length;
  if (depth > THRESHOLDS.deepNesting.threshold) {
    badges.push({ id: 'deepNesting', severity: 'yellow', value: depth });
  }

  return badges;
}

export function getBadgeLabel(badgeId, value, mode) {
  const labels = BADGE_LABELS[mode] || BADGE_LABELS.simple;
  const labelFn = labels[badgeId];
  if (!labelFn) return badgeId;
  return typeof labelFn === 'function' ? labelFn(value) : labelFn;
}

export function getOverallHealth(badges) {
  if (badges.some((b) => b.severity === 'red')) return 'red';
  if (badges.some((b) => b.severity === 'yellow')) return 'yellow';
  return 'green';
}

export function getBranchStatus(health) {
  if (health === 'red') return 'review';
  if (health === 'yellow') return 'messy';
  return 'healthy';
}

export function getBranchStatusLabel(status, mode) {
  if (mode === 'simple') {
    if (status === 'review') return 'Needs attention';
    if (status === 'messy') return 'Getting messy';
    return 'Looking good';
  }
  return status;
}

export { THRESHOLDS };
