import { useExperienceMode } from './ExperienceModeContext';

export default function SessionSummary({ stats }) {
  const { mode } = useExperienceMode();

  if (!stats || stats.totalEvents === 0) return null;

  if (mode === 'simple') {
    const parts = [];
    if (stats.created > 0) parts.push(`${stats.created} files created`);
    if (stats.modified > 0) parts.push(`${stats.modified} modified`);
    if (stats.deleted > 0) parts.push(`${stats.deleted} removed`);

    return (
      <div className="session-summary simple">
        <div className="summary-headline">
          {parts.join(', ') || 'No changes yet'}
        </div>
        {stats.hottestBranch && stats.hottestBranch !== '.' && (
          <div className="summary-detail">
            Most active area: <strong>{stats.hottestBranch}</strong>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="session-summary builder">
      <div className="summary-row">
        <span className="summary-label">Created</span>
        <span className="summary-value green">{stats.created}</span>
      </div>
      <div className="summary-row">
        <span className="summary-label">Modified</span>
        <span className="summary-value yellow">{stats.modified}</span>
      </div>
      <div className="summary-row">
        <span className="summary-label">Deleted</span>
        <span className="summary-value red">{stats.deleted}</span>
      </div>
      {stats.hottestBranch && stats.hottestBranch !== '.' && (
        <div className="summary-row">
          <span className="summary-label">Hottest</span>
          <span className="summary-value">{stats.hottestBranch} ({stats.hottestCount})</span>
        </div>
      )}
      <div className="summary-row">
        <span className="summary-label">Total events</span>
        <span className="summary-value">{stats.totalEvents}</span>
      </div>
    </div>
  );
}
