// Shared session state store
// Used by both the React renderer (via import) and the MCP server (via bridge or direct)
// Wraps sessionTracker + healthBadges into a single source of truth

import { createSessionTracker } from '../analysis/sessionTracker.js';

export function createSessionState() {
  const tracker = createSessionTracker();

  return {
    addEvent(event) {
      tracker.addEvent(event);
    },

    getEvents() {
      return tracker.getEvents();
    },

    getRecentEvents(sinceTimestamp, limit = 50) {
      let events = tracker.getEvents();
      if (sinceTimestamp) {
        events = events.filter(e => e.timestamp > sinceTimestamp);
      }
      return events.slice(-limit);
    },

    getTreeData() {
      return tracker.buildTreeData();
    },

    getStats() {
      return tracker.getStats();
    },

    getFileMap() {
      return tracker.getFileMap();
    },

    clear() {
      tracker.clear();
    },

    // Serializable snapshot for MCP responses
    getSnapshot() {
      return {
        tree: tracker.buildTreeData(),
        stats: tracker.getStats(),
        eventCount: tracker.getEvents().length,
      };
    },
  };
}
