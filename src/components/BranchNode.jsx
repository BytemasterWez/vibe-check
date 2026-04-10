import { useExperienceMode } from './ExperienceModeContext';

const FILE_ICONS = {
  js: '📄', jsx: '⚛', ts: '📘', tsx: '⚛',
  css: '🎨', scss: '🎨', html: '🌐',
  json: '📋', md: '📝', py: '🐍',
  test: '🧪', spec: '🧪',
  config: '⚙', env: '🔒',
  default: '📄',
};

function getFileIcon(name) {
  if (name.includes('.test.') || name.includes('.spec.')) return FILE_ICONS.test;
  if (name.includes('config') || name === '.env') return FILE_ICONS.config;
  const ext = name.split('.').pop();
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

function getHealthColor(node) {
  if (node.type === 'dir') return null;
  if (!node.metadata) return null;

  const { lines, imports, exports } = node.metadata;
  if (lines > 500 || imports > 25 || exports > 10) return 'red';
  if (lines > 300 || imports > 15) return 'yellow';
  return 'green';
}

export default function BranchNode({
  node,
  depth,
  collapsed,
  onToggle,
  onSelect,
  selectedPath,
  recentPaths,
}) {
  const { mode } = useExperienceMode();
  const isCollapsed = collapsed.has(node.path);
  const isSelected = selectedPath === node.path;
  const isRecent = recentPaths?.has(node.path);
  const isDir = node.type === 'dir';
  const healthColor = getHealthColor(node);
  const childCount = isDir ? node.children?.length || 0 : 0;

  const handleClick = (e) => {
    e.stopPropagation();
    if (isDir) {
      onToggle(node.path);
    }
    onSelect(node);
  };

  return (
    <div className="branch-node-container">
      <div
        className={[
          'branch-node',
          isSelected ? 'selected' : '',
          isRecent ? 'recent' : '',
          healthColor ? `health-${healthColor}` : '',
        ].filter(Boolean).join(' ')}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        {isDir ? (
          <span className="node-toggle">{isCollapsed ? '▸' : '▾'}</span>
        ) : (
          <span className="node-icon">{getFileIcon(node.name)}</span>
        )}

        <span className="node-name">
          {isDir ? `📁 ${node.name}` : node.name}
        </span>

        {isDir && childCount > 0 && (
          <span className="node-count">{childCount}</span>
        )}

        {healthColor && healthColor !== 'green' && (
          <span className={`health-dot ${healthColor}`} title={
            mode === 'simple'
              ? healthColor === 'red' ? 'Needs attention' : 'Getting messy'
              : `Health: ${healthColor}`
          } />
        )}

        {node.metadata && mode === 'builder' && node.type === 'file' && (
          <span className="node-meta">
            {node.metadata.lines}L
          </span>
        )}
      </div>

      {isDir && !isCollapsed && node.children && (
        <div className="branch-children">
          {node.children
            .sort((a, b) => {
              // Dirs first, then alphabetical
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
              <BranchNode
                key={child.path}
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
                selectedPath={selectedPath}
                recentPaths={recentPaths}
              />
            ))}
        </div>
      )}
    </div>
  );
}
