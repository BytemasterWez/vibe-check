import { useState, useEffect, useRef, useMemo } from 'react';
import { ExperienceModeProvider, useExperienceMode } from './components/ExperienceModeContext';
import OnboardingModal from './components/OnboardingModal';
import Toolbar from './components/Toolbar';
import BranchTree from './components/BranchTree';
import FocusFilters, { filterEvents, getFilteredPaths } from './components/FocusFilters';
import ActivityFeed from './components/ActivityFeed';
import SessionSummary from './components/SessionSummary';
import FileInspector from './components/FileInspector';
import SecondOpinion from './components/SecondOpinion';
import ScaffoldWizard from './components/ScaffoldWizard';
import { createSessionTracker } from './analysis/sessionTracker';

function AppContent() {
  const { mode, loading } = useExperienceMode();
  const [projectPath, setProjectPath] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [treeData, setTreeData] = useState(null);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);
  const [showScaffold, setShowScaffold] = useState(false);
  const trackerRef = useRef(createSessionTracker());

  // Track activity levels for pulsing
  // active: changed in last 20s (strong pulse)
  // recent: changed in last 60s (gentle pulse)
  // thrashing: 3+ edits to same file in last 60s (warning throb)
  const activityMap = useMemo(() => {
    const now = Date.now();
    const activeCutoff = now - 20000;
    const recentCutoff = now - 60000;
    const map = new Map(); // path -> { level, editCount }

    // Count edits per file in last 60s
    const editCounts = new Map();
    for (const event of events) {
      if (event.timestamp > recentCutoff && event.eventType !== 'addDir' && event.eventType !== 'unlinkDir') {
        const count = editCounts.get(event.filePath) || 0;
        editCounts.set(event.filePath, count + 1);
      }
    }

    for (const event of events) {
      if (event.timestamp > recentCutoff) {
        const edits = editCounts.get(event.filePath) || 1;
        let level = 'recent';
        if (event.timestamp > activeCutoff) level = 'active';
        if (edits >= 3) level = 'thrashing';

        map.set(event.filePath, { level, editCount: edits });

        // Also mark parent branches
        const parts = event.filePath.split('/');
        for (let i = 1; i < parts.length; i++) {
          const branchPath = parts.slice(0, i).join('/');
          if (!map.has(branchPath) || map.get(branchPath).level === 'recent') {
            map.set(branchPath, { level: level === 'thrashing' ? 'thrashing' : 'branch-active', editCount: 0 });
          }
        }
      }
    }

    return map;
  }, [events]);

  // Simple set for backward compat
  const recentPaths = useMemo(() => {
    return new Set(activityMap.keys());
  }, [activityMap]);

  // Filtered events based on focus mode
  const filteredEvents = useMemo(
    () => filterEvents(events, activeFilter),
    [events, activeFilter]
  );

  const filteredPaths = useMemo(
    () => activeFilter ? getFilteredPaths(events, activeFilter) : null,
    [events, activeFilter]
  );

  // Listen for file events from watcher
  useEffect(() => {
    const cleanup = window.electronAPI?.onFileEvent((event) => {
      const tracker = trackerRef.current;
      tracker.addEvent(event);
      setTreeData(tracker.buildTreeData());
      setStats(tracker.getStats());
      setEvents([...tracker.getEvents()]);
    });

    return () => cleanup?.();
  }, []);

  const startWatchingDir = async (dir) => {
    trackerRef.current.clear();
    setTreeData(null);
    setEvents([]);
    setStats(null);
    setSelectedNode(null);
    setActiveFilter(null);
    setShowScaffold(false);
    setProjectPath(dir);
    await window.electronAPI?.startWatching(dir);
  };

  const handleSelectProject = async () => {
    const dir = await window.electronAPI?.openDirectory();
    if (dir) await startWatchingDir(dir);
  };

  if (loading) {
    return <div className="app-loading">Loading...</div>;
  }

  if (!mode) {
    return <OnboardingModal />;
  }

  return (
    <div className="app">
      <Toolbar projectPath={projectPath} onSelectProject={handleSelectProject} />

      {!projectPath ? (
        showScaffold ? (
          <ScaffoldWizard
            onComplete={startWatchingDir}
            onCancel={() => setShowScaffold(false)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">◉</div>
            <h2>{mode === 'simple' ? 'What would you like to do?' : 'Get started'}</h2>
            <p>
              {mode === 'simple'
                ? 'Open an existing project or start building something new.'
                : 'Watch an existing project or scaffold a new one.'}
            </p>
            <div className="empty-state-buttons">
              <button className="primary-btn" onClick={handleSelectProject}>
                📂 Open existing project
              </button>
              <button className="secondary-btn" onClick={() => setShowScaffold(true)}>
                ✨ Start from scratch
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="main-layout">
          {/* Left pane: Tree */}
          <div className="pane pane-tree">
            <div className="pane-header">
              {mode === 'simple' ? 'Project' : 'Branch Tree'}
              {stats && (
                <span className="pane-header-stat">
                  {stats.totalEvents} events
                </span>
              )}
            </div>
            <div className="pane-content">
              <BranchTree
                treeData={treeData}
                onSelectNode={setSelectedNode}
                selectedPath={selectedNode?.path}
                recentPaths={recentPaths}
                activityMap={activityMap}
                filteredPaths={filteredPaths}
              />
            </div>
          </div>

          {/* Middle pane: Activity + Filters */}
          <div className="pane pane-activity">
            <div className="pane-header">
              {mode === 'simple' ? 'What happened' : 'Activity'}
            </div>
            <FocusFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />
            <div className="pane-content">
              <ActivityFeed events={filteredEvents} />
            </div>
            <div className="pane-footer">
              <SessionSummary stats={stats} />
            </div>
          </div>

          {/* Right pane: Inspect */}
          <div className="pane pane-inspect">
            <div className="pane-header">
              {mode === 'simple' ? 'Details' : 'Inspect'}
            </div>
            <div className="pane-content">
              <FileInspector
                node={selectedNode}
                projectPath={projectPath}
                stats={stats}
              />
              <SecondOpinion
                events={events}
                treeData={treeData}
                stats={stats}
                projectPath={projectPath}
                selectedNode={selectedNode}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ExperienceModeProvider>
      <AppContent />
    </ExperienceModeProvider>
  );
}
