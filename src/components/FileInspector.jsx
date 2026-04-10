import { useState, useEffect } from 'react';
import { useExperienceMode } from './ExperienceModeContext';
import { getBadgeLabel, getBranchStatusLabel, getOverallHealth, getBranchStatus } from '../analysis/healthBadges';

// Standard action prompts (locked per build contract)
const ACTION_PROMPTS = {
  continue: { label: 'Continue', desc: 'This area looks fine. Safe to keep going.' },
  splitFile: { label: 'Ask AI to split this file', prompt: 'Split this file into smaller, focused modules' },
  refactor: { label: 'Ask AI to refactor', prompt: 'Refactor this area to separate concerns' },
  addTests: { label: 'Ask AI to add tests', prompt: 'Add tests for the recently added code' },
  inspect: { label: 'Inspect manually', desc: 'Unusual pattern — take a closer look before continuing.' },
  secondOpinion: { label: 'Get second opinion', desc: 'Multiple warnings — click the review button.' },
};

function getActionForBadges(badges) {
  if (!badges || badges.length === 0) return 'continue';
  const ids = badges.map(b => b.id);
  if (badges.some(b => b.severity === 'red') && badges.length >= 2) return 'secondOpinion';
  if (ids.includes('oversized') || ids.includes('highSurfaceArea')) return 'splitFile';
  if (ids.includes('importHeavy')) return 'refactor';
  return 'inspect';
}

// "Why this matters" guidance — contextual engineering education
const GUIDANCE = {
  simple: {
    oversized: {
      why: 'When one file gets very long, it becomes harder to understand, test, and change safely.',
      knockOn: 'Small changes in a long file can accidentally break things you didn\'t mean to touch.',
      better: 'Keep files focused on one job. Move different concerns into separate files.',
      prompt: 'Split this file into smaller files, each focused on one responsibility',
    },
    importHeavy: {
      why: 'When a file depends on too many other files, changing any of those files might break this one.',
      knockOn: 'The more connections a file has, the more fragile it becomes.',
      better: 'Group related imports behind a single interface or reduce what this file is responsible for.',
      prompt: 'Reduce dependencies in this file by extracting shared logic into a helper',
    },
    highSurfaceArea: {
      why: 'When a file exposes too many things to the rest of the app, it becomes a bottleneck.',
      knockOn: 'Every part of the app that uses this file is affected when it changes.',
      better: 'Keep what\'s exposed minimal. Move internal helpers into separate files.',
      prompt: 'Reduce the exports from this file by moving internal utilities to separate modules',
    },
    flatDump: {
      why: 'Too many files in one folder makes it hard to find things and understand the structure.',
      knockOn: 'New files keep getting dumped here because there\'s no clear organization.',
      better: 'Group related files into subfolders by feature or purpose.',
      prompt: 'Organize this folder into subfolders grouped by feature',
    },
  },
  builder: {
    oversized: {
      note: 'This file exceeds recommended line count. High line count correlates with higher defect density and harder testing.',
      knockOn: 'Merge conflicts increase. Code review becomes less effective. Test setup grows complex.',
      pattern: 'Extract into modules by responsibility: UI, business logic, data access, config.',
      prompt: 'Split this file by concern — separate UI components, hooks, and business logic',
    },
    importHeavy: {
      note: 'High import fan-in increases coupling. This file is a dependency hub.',
      knockOn: 'Changes to imported modules may cascade. Testing requires more mocking.',
      pattern: 'Introduce facade patterns or consolidate related imports behind barrel exports.',
      prompt: 'Reduce coupling by introducing a facade for the most-used imports',
    },
    highSurfaceArea: {
      note: 'High export count suggests mixed responsibilities. This file serves multiple consumers.',
      knockOn: 'Breaking changes affect many dependents. Refactoring becomes high-risk.',
      pattern: 'Apply interface segregation — split into focused modules with narrow exports.',
      prompt: 'Apply interface segregation — split exports into focused modules',
    },
    flatDump: {
      note: 'Flat directory with high file count suggests missing architectural grouping.',
      knockOn: 'Feature boundaries become unclear. New code lands wherever is convenient.',
      pattern: 'Group by feature (co-locate related components, tests, types) or by layer.',
      prompt: 'Restructure this directory into feature-based subdirectories',
    },
  },
};

function getGuidance(badges, mode) {
  if (!badges || badges.length === 0) return null;
  const modeGuide = GUIDANCE[mode] || GUIDANCE.simple;
  // Return guidance for the most severe badge
  const sorted = [...badges].sort((a, b) => (a.severity === 'red' ? -1 : 1));
  const topBadge = sorted[0];
  return modeGuide[topBadge.id] || null;
}

function DiffPreview({ diff }) {
  if (!diff) return null;

  const lines = diff.split('\n').slice(0, 50); // Limit preview

  return (
    <div className="diff-preview">
      <div className="inspect-label">Diff Preview</div>
      <pre className="diff-code">
        {lines.map((line, i) => {
          let cls = 'diff-line';
          if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
          else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-remove';
          else if (line.startsWith('@@')) cls += ' diff-hunk';
          return <div key={i} className={cls}>{line}</div>;
        })}
        {diff.split('\n').length > 50 && (
          <div className="diff-truncated">... {diff.split('\n').length - 50} more lines</div>
        )}
      </pre>
    </div>
  );
}

function BranchSummaryCard({ node, badges, action, mode }) {
  const actionInfo = ACTION_PROMPTS[action];
  const guidance = getGuidance(badges, mode || 'simple');

  return (
    <div className="branch-summary-card">
      <div className="summary-card-section">
        <div className="summary-card-label">What happened</div>
        <div className="summary-card-value">
          {node.eventType === 'add' ? 'New file created' :
           node.eventType === 'change' ? 'File was modified' :
           node.type === 'dir' ? 'Folder contents changed' :
           'File changed'}
        </div>
      </div>

      <div className="summary-card-section">
        <div className="summary-card-label">Health</div>
        <div className={`summary-card-value health-text-${getOverallHealth(badges || [])}`}>
          {getBranchStatusLabel(getBranchStatus(getOverallHealth(badges || [])), 'simple')}
        </div>
      </div>

      {badges && badges.length > 0 && (
        <div className="summary-card-section">
          <div className="summary-card-label">Concerns</div>
          {badges.map((badge, i) => (
            <div key={i} className={`summary-card-value badge-text-${badge.severity}`}>
              {getBadgeLabel(badge.id, badge.value, 'simple')}
            </div>
          ))}
        </div>
      )}

      <div className="summary-card-section summary-card-action">
        <div className="summary-card-label">What to do</div>
        {actionInfo.prompt ? (
          <>
            <div className="summary-card-value">{actionInfo.label}</div>
            <div className="action-prompt-copy">
              <code>{actionInfo.prompt}</code>
              <button
                className="copy-btn"
                onClick={() => navigator.clipboard?.writeText(actionInfo.prompt)}
                title="Copy prompt"
              >
                📋
              </button>
            </div>
          </>
        ) : (
          <div className="summary-card-value">{actionInfo.desc}</div>
        )}
      </div>

      {/* Why this matters — contextual engineering guidance */}
      {guidance && (
        <div className="summary-card-section summary-card-guidance">
          <div className="summary-card-label">Why this matters</div>
          <div className="guidance-text">{guidance.why}</div>
          <div className="guidance-knockon">
            <strong>What could happen later:</strong> {guidance.knockOn}
          </div>
          <div className="guidance-better">
            <strong>What good looks like:</strong> {guidance.better}
          </div>
          {guidance.prompt && (
            <div className="action-prompt-copy">
              <code>{guidance.prompt}</code>
              <button
                className="copy-btn"
                onClick={() => navigator.clipboard?.writeText(guidance.prompt)}
                title="Copy prompt"
              >
                📋
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FileInspector({ node, projectPath, stats }) {
  const { mode } = useExperienceMode();
  const [diff, setDiff] = useState(null);
  const [diffType, setDiffType] = useState(null);

  useEffect(() => {
    if (!node || node.type === 'dir' || !projectPath) {
      setDiff(null);
      setDiffType(null);
      return;
    }

    window.electronAPI?.gitDiff(projectPath, node.path).then((result) => {
      setDiffType(result.type);
      setDiff(result.content);
    }).catch(() => {
      setDiffType('error');
      setDiff(null);
    });
  }, [node?.path, projectPath]);

  if (!node) {
    return (
      <div className="pane-placeholder">
        {mode === 'simple'
          ? 'Click a file or folder to learn more'
          : 'Select a node to inspect'}
      </div>
    );
  }

  const badges = node.badges || [];
  const action = getActionForBadges(badges);

  // Simple mode: show Branch Summary Card
  if (mode === 'simple') {
    return (
      <div className="inspect-panel">
        <h3 className="inspect-title">{node.name}</h3>
        <p className="inspect-path">{node.path}</p>

        <BranchSummaryCard node={node} badges={badges} action={action} mode={mode} />

        {/* Expandable technical details */}
        {node.metadata && (
          <details className="inspect-details-expander">
            <summary>Show technical details</summary>
            <div className="inspect-meta">
              <div>Lines: {node.metadata.lines}</div>
              <div>Size: {node.metadata.sizeBytes} bytes</div>
              <div>Imports: {node.metadata.imports}</div>
              <div>Exports: {node.metadata.exports}</div>
            </div>
            {diff && <DiffPreview diff={diff} />}
          </details>
        )}
      </div>
    );
  }

  // Builder mode: full technical detail
  return (
    <div className="inspect-panel">
      <h3 className="inspect-title">{node.name}</h3>
      <p className="inspect-path">{node.path}</p>
      <p className="inspect-type">
        {node.type === 'dir' ? 'Directory' : 'File'}
        {node.eventType && ` · ${node.eventType}`}
      </p>

      {/* Health badges */}
      {badges.length > 0 && (() => {
        const builderGuidance = getGuidance(badges, 'builder');
        return (
          <div className={`inspect-health health-${getOverallHealth(badges)}`}>
            <div className="inspect-label">Health Badges</div>
            {badges.map((badge, i) => (
              <div key={i} className={`badge badge-${badge.severity}`}>
                {getBadgeLabel(badge.id, badge.value, 'builder')}
              </div>
            ))}
            {builderGuidance && (
              <div className="builder-guidance">
                <div className="guidance-note">{builderGuidance.note}</div>
                <div className="guidance-text"><strong>Knock-on:</strong> {builderGuidance.knockOn}</div>
                <div className="guidance-text"><strong>Pattern:</strong> {builderGuidance.pattern}</div>
                {builderGuidance.prompt && (
                  <div className="action-prompt-copy">
                    <code>{builderGuidance.prompt}</code>
                    <button
                      className="copy-btn"
                      onClick={() => navigator.clipboard?.writeText(builderGuidance.prompt)}
                      title="Copy prompt"
                    >
                      📋
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Metadata */}
      {node.metadata && (
        <div className="inspect-meta">
          <div className="inspect-label">Metadata</div>
          <div>Lines: {node.metadata.lines}</div>
          <div>Size: {node.metadata.sizeBytes} bytes</div>
          <div>Imports: {node.metadata.imports}</div>
          <div>Exports: {node.metadata.exports}</div>
        </div>
      )}

      {/* Diff */}
      {diffType === 'diff' && diff && <DiffPreview diff={diff} />}
      {diffType === 'new' && (
        <div className="inspect-meta">
          <div className="inspect-label">Status</div>
          <div className="diff-new-tag">New file (untracked)</div>
        </div>
      )}
      {diffType === 'unchanged' && (
        <div className="inspect-meta">
          <div className="inspect-label">Status</div>
          <div>No changes since last commit</div>
        </div>
      )}
      {diffType === 'no-git' && (
        <div className="inspect-meta">
          <div className="inspect-label">Status</div>
          <div>Not a git repository — diff unavailable</div>
        </div>
      )}
    </div>
  );
}
