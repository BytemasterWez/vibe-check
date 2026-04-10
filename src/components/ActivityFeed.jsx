import { useExperienceMode } from './ExperienceModeContext';

const EVENT_ICONS = {
  add: { icon: '+', color: 'green', simple: 'Added' },
  change: { icon: '~', color: 'yellow', simple: 'Modified' },
  unlink: { icon: '−', color: 'red', simple: 'Removed' },
  addDir: { icon: '📁+', color: 'green', simple: 'New folder' },
  unlinkDir: { icon: '📁−', color: 'red', simple: 'Folder removed' },
};

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function simplifyPath(filePath) {
  const parts = filePath.split('/');
  if (parts.length <= 2) return filePath;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export default function ActivityFeed({ events }) {
  const { mode } = useExperienceMode();

  if (events.length === 0) {
    return (
      <div className="pane-placeholder">
        {mode === 'simple' ? 'Waiting for the AI to start building...' : 'Waiting for changes...'}
      </div>
    );
  }

  // Group consecutive similar events in simple mode
  const displayEvents = mode === 'simple' ? groupEvents(events) : events;

  return (
    <div className="activity-list">
      {[...displayEvents].reverse().slice(0, 100).map((event, i) => {
        const info = EVENT_ICONS[event.eventType] || EVENT_ICONS.change;

        if (event._grouped) {
          return (
            <div key={`group-${i}`} className="activity-item grouped">
              <span className={`activity-type ${event.eventType}`}>{info.icon}</span>
              <span className="activity-path">
                {event._count} files {info.simple.toLowerCase()} in {event.branchPath || 'root'}
              </span>
              <span className="activity-time">{formatRelativeTime(event.timestamp)}</span>
            </div>
          );
        }

        return (
          <div key={`${event.filePath}-${event.timestamp}-${i}`} className="activity-item">
            <span className={`activity-type ${event.eventType}`}>
              {mode === 'simple' ? info.simple : info.icon}
            </span>
            <span className="activity-path">
              {mode === 'simple' ? simplifyPath(event.filePath) : event.filePath}
            </span>
            <span className="activity-time">
              {mode === 'simple' ? formatRelativeTime(event.timestamp) : formatTime(event.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Group rapid consecutive events of the same type in the same branch
function groupEvents(events) {
  if (events.length === 0) return [];

  const result = [];
  let group = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const curr = events[i];
    const prev = events[i - 1];
    const sameType = curr.eventType === prev.eventType;
    const sameBranch = curr.branchPath === prev.branchPath;
    const closeInTime = curr.timestamp - prev.timestamp < 5000;

    if (sameType && sameBranch && closeInTime) {
      group.push(curr);
    } else {
      if (group.length >= 3) {
        result.push({
          ...group[group.length - 1],
          _grouped: true,
          _count: group.length,
        });
      } else {
        result.push(...group);
      }
      group = [curr];
    }
  }

  // Final group
  if (group.length >= 3) {
    result.push({
      ...group[group.length - 1],
      _grouped: true,
      _count: group.length,
    });
  } else {
    result.push(...group);
  }

  return result;
}
