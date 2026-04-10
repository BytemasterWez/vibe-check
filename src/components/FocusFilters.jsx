import { useExperienceMode } from './ExperienceModeContext';

const FILTERS = [
  { id: 'session', label: 'This session', simpleLabel: 'This session' },
  { id: 'last15', label: 'Last 15 min', simpleLabel: 'Recent' },
  { id: 'last30', label: 'Last 30 min', simpleLabel: 'Last 30 min' },
  { id: 'last60', label: 'Last hour', simpleLabel: 'Last hour' },
  { id: 'unhealthy', label: 'Unhealthy only', simpleLabel: 'Needs attention' },
  { id: 'newOnly', label: 'New files only', simpleLabel: 'New files' },
];

export default function FocusFilters({ activeFilter, onFilterChange }) {
  const { mode } = useExperienceMode();

  return (
    <div className="focus-filters">
      <button
        className={`filter-btn ${!activeFilter ? 'active' : ''}`}
        onClick={() => onFilterChange(null)}
      >
        All
      </button>
      {FILTERS.map((filter) => (
        <button
          key={filter.id}
          className={`filter-btn ${activeFilter === filter.id ? 'active' : ''}`}
          onClick={() => onFilterChange(activeFilter === filter.id ? null : filter.id)}
        >
          {mode === 'simple' ? filter.simpleLabel : filter.label}
        </button>
      ))}
    </div>
  );
}

// Filter logic — applies to both events and tree nodes
export function filterEvents(events, filterId) {
  if (!filterId) return events;

  const now = Date.now();
  switch (filterId) {
    case 'session':
      return events; // All events are from current session
    case 'last15':
      return events.filter((e) => now - e.timestamp < 15 * 60 * 1000);
    case 'last30':
      return events.filter((e) => now - e.timestamp < 30 * 60 * 1000);
    case 'last60':
      return events.filter((e) => now - e.timestamp < 60 * 60 * 1000);
    case 'unhealthy':
      return events.filter((e) => e.badges && e.badges.length > 0);
    case 'newOnly':
      return events.filter((e) => e.eventType === 'add');
    default:
      return events;
  }
}

export function getFilteredPaths(events, filterId) {
  const filtered = filterEvents(events, filterId);
  return new Set(filtered.map((e) => e.filePath));
}
