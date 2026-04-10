import { useState, useRef, useMemo, useCallback } from 'react';
import { hierarchy, tree as d3Tree } from 'd3-hierarchy';
import { useExperienceMode } from './ExperienceModeContext';
import { getOverallHealth, getBranchStatus as computeBranchStatus } from '../analysis/healthBadges';

const TREE_CONFIG = {
  nodeWidth: 140,
  nodeHeight: 32,
  levelIndent: 180,
  verticalGap: 4,
};

function getHealthColor(node) {
  const badges = node.data.badges || [];
  if (badges.length > 0) return getOverallHealth(badges);

  if (node.data.type === 'dir') {
    if (!node.children) return 'green';
    const childColors = node.children.map(c => getHealthColor(c));
    if (childColors.includes('red')) return 'red';
    if (childColors.includes('yellow')) return 'yellow';
    return 'green';
  }

  // Fallback: use metadata directly
  if (!node.data.metadata) return 'green';
  const { lines, imports, exports } = node.data.metadata;
  if (lines > 500 || imports > 25 || exports > 10) return 'red';
  if (lines > 300 || imports > 15) return 'yellow';
  return 'green';
}

function getBranchStatus(healthColor) {
  return computeBranchStatus(healthColor);
}

export default function BranchTree({ treeData, onSelectNode, selectedPath, recentPaths, activityMap }) {
  const { mode } = useExperienceMode();
  const svgRef = useRef(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [focusedPath, setFocusedPath] = useState(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0 });
  const [breadcrumbs, setBreadcrumbs] = useState([]);

  const toggleCollapse = useCallback((path) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleDoubleClick = useCallback((node) => {
    if (node.data.type !== 'dir') return;
    if (focusedPath === node.data.path) {
      // Unfocus
      setFocusedPath(null);
      setBreadcrumbs([]);
    } else {
      setFocusedPath(node.data.path);
      // Build breadcrumbs
      const parts = node.data.path.split('/');
      const crumbs = [];
      for (let i = 0; i < parts.length; i++) {
        crumbs.push({
          name: parts[i] === '.' ? 'root' : parts[i],
          path: parts.slice(0, i + 1).join('/'),
        });
      }
      setBreadcrumbs(crumbs);
    }
  }, [focusedPath]);

  const handleBackToFull = useCallback(() => {
    setFocusedPath(null);
    setBreadcrumbs([]);
  }, []);

  // Build filtered tree based on collapsed state and focus
  const filteredTree = useMemo(() => {
    if (!treeData || !treeData.children || treeData.children.length === 0) return null;

    function filterNode(node) {
      if (node.type === 'file') return { ...node, children: [] };
      const isCollapsedNode = collapsed.has(node.path);
      return {
        ...node,
        children: isCollapsedNode ? [] : (node.children || []).map(filterNode),
      };
    }

    // If focused, find the focused subtree
    let root = treeData;
    if (focusedPath) {
      function findNode(node, targetPath) {
        if (node.path === targetPath) return node;
        if (!node.children) return null;
        for (const child of node.children) {
          const found = findNode(child, targetPath);
          if (found) return found;
        }
        return null;
      }
      root = findNode(treeData, focusedPath) || treeData;
    }

    return filterNode(root);
  }, [treeData, collapsed, focusedPath]);

  // Compute d3 layout
  const layout = useMemo(() => {
    if (!filteredTree) return null;

    const root = hierarchy(filteredTree, d => d.children);

    // Use d3 tree layout
    const treeLayout = d3Tree()
      .nodeSize([TREE_CONFIG.nodeHeight + TREE_CONFIG.verticalGap, TREE_CONFIG.levelIndent])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2));

    treeLayout(root);
    return root;
  }, [filteredTree]);

  // Compute SVG dimensions
  const svgDimensions = useMemo(() => {
    if (!layout) return { width: 400, height: 300 };

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    layout.each((node) => {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    });

    const padding = 40;
    return {
      width: (maxY - minY) + TREE_CONFIG.nodeWidth + padding * 2,
      height: (maxX - minX) + TREE_CONFIG.nodeHeight + padding * 2,
      offsetX: -minX + padding,
      offsetY: -minY + padding,
    };
  }, [layout]);

  if (!treeData || !treeData.children || treeData.children.length === 0) {
    return (
      <div className="tree-empty">
        Watching for changes...
      </div>
    );
  }

  // Generate link paths (curved connections between nodes)
  const links = [];
  if (layout) {
    layout.links().forEach((link, i) => {
      const sx = link.source.y + svgDimensions.offsetY;
      const sy = link.source.x + svgDimensions.offsetX;
      const tx = link.target.y + svgDimensions.offsetY;
      const ty = link.target.x + svgDimensions.offsetX;
      const mx = (sx + tx) / 2;

      links.push(
        <path
          key={`link-${i}`}
          d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
          className="tree-link"
          style={{
            stroke: getHealthColor(link.target) === 'red' ? 'var(--red)' :
                    getHealthColor(link.target) === 'yellow' ? 'var(--yellow)' :
                    'var(--border)',
            opacity: getHealthColor(link.target) === 'green' ? 0.4 : 0.7,
          }}
        />
      );
    });
  }

  // Generate nodes
  const nodes = [];
  if (layout) {
    layout.each((node) => {
      const x = node.y + svgDimensions.offsetY;
      const y = node.x + svgDimensions.offsetX;
      const health = getHealthColor(node);
      const isSelected = selectedPath === node.data.path;
      const isRecent = recentPaths?.has(node.data.path);
      const activity = activityMap?.get(node.data.path);
      const activityLevel = activity?.level || (isRecent ? 'recent' : '');
      const isDir = node.data.type === 'dir';
      const hasChildren = node.data.children && node.data.children.length > 0;
      const isCollapsedNode = collapsed.has(node.data.path);
      const status = getBranchStatus(health);

      nodes.push(
        <g
          key={node.data.path}
          transform={`translate(${x}, ${y})`}
          className={`tree-node ${activityLevel}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isDir) toggleCollapse(node.data.path);
            onSelectNode(node.data);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            handleDoubleClick(node);
          }}
          style={{ cursor: 'pointer' }}
        >
          {/* Node background */}
          <rect
            x={-4}
            y={-12}
            width={TREE_CONFIG.nodeWidth}
            height={24}
            rx={4}
            className={`node-bg ${isSelected ? 'selected' : ''} health-${health}`}
          />

          {/* Collapse indicator for dirs */}
          {isDir && hasChildren && (
            <text x={-2} y={4} className="node-collapse-indicator" fontSize="10">
              {isCollapsedNode ? '▸' : '▾'}
            </text>
          )}

          {/* Node label */}
          <text
            x={isDir ? 14 : 6}
            y={4}
            className={`node-label health-text-${health}`}
            fontSize="11"
          >
            {node.data.name.length > 18
              ? node.data.name.slice(0, 16) + '…'
              : node.data.name}
          </text>

          {/* Health indicator dot */}
          {health !== 'green' && (
            <circle
              cx={TREE_CONFIG.nodeWidth - 14}
              cy={0}
              r={4}
              className={`health-indicator-${health}`}
            />
          )}

          {/* Simple mode status badge */}
          {mode === 'simple' && isDir && status !== 'healthy' && (
            <text
              x={TREE_CONFIG.nodeWidth - 8}
              y={4}
              className={`status-badge status-${status}`}
              fontSize="9"
              textAnchor="end"
            >
              {status === 'review' ? '!' : '~'}
            </text>
          )}

          {/* Recent change pulse ring */}
          {isRecent && (
            <circle
              cx={TREE_CONFIG.nodeWidth / 2}
              cy={0}
              r={16}
              className="pulse-ring"
            />
          )}
        </g>
      );
    });
  }

  return (
    <div className="branch-tree-container">
      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <div className="tree-breadcrumbs">
          <button className="breadcrumb-back" onClick={handleBackToFull}>
            ← Full tree
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path}>
              {i > 0 && <span className="breadcrumb-sep"> › </span>}
              <span className="breadcrumb-item">{crumb.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* SVG Tree */}
      <div className="tree-svg-wrapper">
        <svg
          ref={svgRef}
          width={svgDimensions.width}
          height={svgDimensions.height}
          className="tree-svg"
        >
          <g>
            {links}
            {nodes}
          </g>
        </svg>
      </div>
    </div>
  );
}
