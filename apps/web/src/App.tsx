import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentStatusRecord,
  type ExecutionLogRecord,
  fetchProfiles,
  fetchSignals,
  fetchTheses,
  fetchThesis,
  fetchThesisDeepDive,
  generateThesisDeepDive,
  type ProfileDisplay,
  type SignalRecord,
  type SortField,
  setThesisLabel,
  type ThesisDeepDive,
  type ThesisLabel,
  type ThesisListItem,
  type ThesisSortField,
  type ThesisStats,
  triggerAgentRun,
  triggerConnectorRefresh,
} from './api';
import { ConnectionsView } from './components/ConnectionsView';
import { OpportunityMapView } from './components/OpportunityMap';
import { ScoringHealth } from './components/ScoringHealth';
import { Sidebar } from './components/Sidebar';
import { SignalRow } from './components/SignalRow';
import { ThesisCard } from './components/ThesisCard';
import { ThesisDeepDiveModal } from './components/ThesisDeepDiveModal';
import { connectorDisplayName, connectorSourceKey } from './connectorNames';
import { useSocket } from './useSocket';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_SIGNAL_PAGE_SIZE = 10;
const DEFAULT_THESIS_PAGE_SIZE = 10;
const MIN_PANE_PCT = 20;
const MAX_PANE_PCT = 80;

const parsePageSize = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return PAGE_SIZE_OPTIONS.some((size) => size === parsed) ? parsed : fallback;
};

const toTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
};

const isLatestOutcomeFailed = (status: AgentStatusRecord): boolean => {
  if (status.lastAttempt?.status !== 'failed') return false;
  const failedAt = toTimestamp(status.lastAttempt.timestamp);
  const lastSuccessAt = toTimestamp(status.lastRun?.timestamp);
  if (failedAt == null) return true;
  if (lastSuccessAt == null) return true;
  return failedAt >= lastSuccessAt;
};

const formatContextValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(formatContextValue).join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.map(([k, v]) => `${k}=${formatContextValue(v)}`).join(', ');
  }
  return String(value);
};

const formatLogContext = (context: Record<string, unknown> | undefined): string => {
  if (!context || Object.keys(context).length === 0) return '';
  const entries = Object.entries(context);
  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
  return entries
    .map(([key, value]) => `    ${key.padEnd(maxKeyLen)} = ${formatContextValue(value)}`)
    .join('\n');
};

const formatTerminalLine = (entry: ExecutionLogRecord): string => {
  const timestamp = new Date(entry.ts).toLocaleTimeString();
  const context = formatLogContext(entry.context);
  const suffix = context ? `\n${context}` : '';
  return `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}${suffix}`;
};

const logLevelIcons: Record<ExecutionLogRecord['level'], string> = {
  debug: '\u25CB',
  info: '\u25CF',
  warn: '\u25B2',
  error: '\u2716'
};

const App = () => {
  const ws = useSocket();
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [theses, setTheses] = useState<ThesisListItem[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusRecord | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentRunResult, setAgentRunResult] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const prevRunningRef = useRef(false);
  const manualRunRequestedRef = useRef(false);
  const pendingManualRunIdRef = useRef<string | null>(null);
  const latestWsAgentStatusRef = useRef<AgentStatusRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('newest');
  const [thesisFilter, setThesisFilter] = useState<string | null>(null);
  const [thesisFilterTitle, setThesisFilterTitle] = useState<string>('');
  const [deepDiveThesis, setDeepDiveThesis] = useState<ThesisListItem | null>(null);
  const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(new Set());
  const generatingKeysRef = useRef(generatingKeys);
  generatingKeysRef.current = generatingKeys;
  const deepDiveCache = useRef(new Map<string, ThesisDeepDive>());
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
  const toastIdRef = useRef(0);
  const [requestedPage, setRequestedPage] = useState(1);
  const [requestedThesisPage, setRequestedThesisPage] = useState(1);
  const [signalPageSize, setSignalPageSize] = useState<number>(DEFAULT_SIGNAL_PAGE_SIZE);
  const [thesisPageSize, setThesisPageSize] = useState<number>(DEFAULT_THESIS_PAGE_SIZE);
  const [thesisSortField, setThesisSortField] = useState<ThesisSortField>('newest');
  const [thesisPageInfo, setThesisPageInfo] = useState({
    page: 1,
    pageSize: DEFAULT_THESIS_PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });
  const [profiles, setProfiles] = useState<ProfileDisplay[]>([]);
  const [activeProfile, setActiveProfile] = useState('all');
  const [labelFilter, setLabelFilter] = useState<string>('all');
  const [ideaSearch, setIdeaSearch] = useState('');
  const [signalSearch, setSignalSearch] = useState('');
  const [omapSelectedThesis, setOmapSelectedThesis] = useState<ThesisListItem | null>(null);
  const [omapOpen, setOmapOpen] = useState(false);
  const [scoringHealthOpen, setScoringHealthOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logAtBottom, setLogAtBottom] = useState(true);
  const [logComponentFilter, setLogComponentFilter] = useState('all');
  const [logLevelFilter, setLogLevelFilter] = useState<Set<ExecutionLogRecord['level']>>(new Set(['info', 'warn', 'error']));
  const [thesisStats, setThesisStats] = useState<ThesisStats>({ total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 });
  const [splitPct, setSplitPct] = useState(50);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pageInfo, setPageInfo] = useState({
    page: 1,
    pageSize: DEFAULT_SIGNAL_PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });
  // latestSignalAt now comes from ws.latestSignalAt (real-time from DB)
  const logComponents = useMemo(() => {
    const set = new Set<string>();
    for (const entry of ws.logs) set.add(entry.component);
    return Array.from(set).sort();
  }, [ws.logs]);

  const renderedLogs = useMemo(() => {
    let filtered = ws.logs;
    if (logLevelFilter.size < 4) {
      filtered = filtered.filter((entry) => logLevelFilter.has(entry.level));
    }
    if (logComponentFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.component === logComponentFilter);
    }
    return filtered.slice().reverse();
  }, [ws.logs, logLevelFilter, logComponentFilter]);
  const logListRef = useRef<HTMLUListElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  // Resize handle drag logic
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, pct)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    fetchProfiles().then(setProfiles).catch(() => {});
  }, []);

  // Sync thesis stats from WebSocket
  useEffect(() => {
    setThesisStats(ws.thesisStats);
  }, [ws.thesisStats]);

  const summarizeAgentRun = useCallback((status: AgentStatusRecord): string | null => {
    if (isLatestOutcomeFailed(status)) {
      return 'failed';
    }
    if (status.lastRun) {
      return `${status.lastRun.thesesUpdated} updated, ${status.lastRun.newCandidates} new`;
    }
    return null;
  }, []);

  // Track agent running state from WebSocket
  useEffect(() => {
    latestWsAgentStatusRef.current = ws.agentStatus ?? null;
    if (!ws.agentStatus) return;
    const nowRunning = ws.agentStatus.isRunning;
    const pendingRunId = pendingManualRunIdRef.current;
    const waitingForManualOutcome = manualRunRequestedRef.current;

    if (waitingForManualOutcome && !nowRunning) {
      if (pendingRunId === null) return;
      const matchesPendingRun =
        ws.agentStatus.activeRunId === pendingRunId ||
        ws.agentStatus.lastAttempt?.runId === pendingRunId;
      if (!matchesPendingRun) return;
    }

    const wasRunning = prevRunningRef.current;
    setAgentStatus(ws.agentStatus);
    prevRunningRef.current = nowRunning;
    setAgentRunning(nowRunning);

    if (nowRunning) {
      setAgentRunResult(null);
      return;
    }

    const summarized = summarizeAgentRun(ws.agentStatus);

    // If a manual trigger temporarily set a local failure, reconcile it with
    // the authoritative websocket status once a later success is visible.
    if (agentRunResult === 'failed' && summarized && summarized !== 'failed') {
      setAgentRunResult(summarized);
    }

    if (waitingForManualOutcome && pendingRunId !== null && ws.agentStatus.lastAttempt?.runId === pendingRunId) {
      manualRunRequestedRef.current = false;
      pendingManualRunIdRef.current = null;
      setAgentRunResult(summarized);
      return;
    }

    if (wasRunning && !nowRunning) {
      setAgentRunResult(summarized);
    }
  }, [agentRunResult, summarizeAgentRun, ws.agentStatus]);

  // Connection lost warning
  useEffect(() => {
    if (!ws.connected) {
      setLoadWarning('Connection lost \u2014 reconnecting\u2026');
    } else {
      setLoadWarning(null);
    }
  }, [ws.connected]);

  // Fetch signals on page/filter change or when server pushes signalsUpdated
  useEffect(() => {
    let cancelled = false;
    const loadSignals = async () => {
      setIsLoading(true);
      try {
        const result = await fetchSignals({
          page: requestedPage,
          pageSize: signalPageSize,
          ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
          ...(thesisFilter !== null ? { thesisKey: thesisFilter } : {}),
          sort: sortField,
        });
        if (cancelled) return;
        setSignals(result.items);
        setPageInfo({
          page: result.page,
          pageSize: result.page_size,
          totalItems: result.total_items,
          totalPages: result.total_pages,
          hasNext: result.has_next,
          hasPrev: result.has_prev
        });
        if (result.page !== requestedPage) {
          setRequestedPage(result.page);
        }
      } catch {
        if (!cancelled) setLoadWarning('Could not load signals');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void loadSignals();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPage, signalPageSize, sourceFilter, thesisFilter, sortField, ws.signalsUpdatedAt]);

  // Fetch theses on page/sort/filter change or when server pushes thesesUpdated
  useEffect(() => {
    let isCancelled = false;
    const loadTheses = async () => {
      try {
        const tp = await fetchTheses({
          page: requestedThesisPage,
          pageSize: thesisPageSize,
          sort: thesisSortField,
          profile: activeProfile,
          ...(labelFilter !== 'all' ? { label: labelFilter } : {}),
        });
        if (isCancelled) return;
        setTheses(tp.items);
        setThesisPageInfo({
          page: tp.page,
          pageSize: tp.page_size,
          totalItems: tp.total_items,
          totalPages: tp.total_pages,
          hasNext: tp.has_next,
          hasPrev: tp.has_prev
        });
        if (tp.stats) setThesisStats(tp.stats);
      } catch { /* handled by connection warning */ }
    };
    void loadTheses();
    return () => { isCancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedThesisPage, thesisPageSize, thesisSortField, activeProfile, labelFilter, ws.thesesUpdatedAt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderedLogs+logDrawerOpen trigger scroll-to-bottom
  useEffect(() => {
    const list = logListRef.current;
    if (!list || !logAtBottom) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [renderedLogs, logDrawerOpen]);

  const toggleLogLevel = useCallback((level: ExecutionLogRecord['level']) => {
    setLogLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const handleLogScroll = useCallback(() => {
    const list = logListRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    setLogAtBottom(atBottom);
  }, []);

  const scrollLogsToBottom = useCallback(() => {
    const list = logListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    setLogAtBottom(true);
  }, []);

  const handleThesisFilter = (key: string | null, title: string) => {
    setThesisFilter(key);
    setThesisFilterTitle(title);
    setRequestedPage(1);
  };

  const handleForceRefresh = async (cadence?: 'hourly' | 'daily') => {
    try {
      await triggerConnectorRefresh(cadence);
    } catch {
      // Ignore — will be visible in logs
    }
  };

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const handleExploreThesis = useCallback((thesis: ThesisListItem) => {
    const key = thesis.canonicalKey;
    if (generatingKeysRef.current.has(key)) return;

    setGeneratingKeys((prev) => new Set(prev).add(key));

    (async () => {
      try {
        // Check if already generated server-side
        let data = await fetchThesisDeepDive(key);
        if (!data) {
          data = await generateThesisDeepDive(key);
        }
        deepDiveCache.current.set(key, data);
        // Update hasDeepDive on the thesis in local state
        setTheses((prev) => prev.map((t) =>
          t.canonicalKey === key ? { ...t, hasDeepDive: true } : t
        ));
        setOmapSelectedThesis((prev) =>
          prev && prev.canonicalKey === key ? { ...prev, hasDeepDive: true } : prev
        );
        showToast(`Deep dive ready: ${thesis.title.slice(0, 50)}`);
      } catch (err) {
        showToast(
          `Failed to generate deep dive: ${err instanceof Error ? err.message : 'unknown error'}`,
          'error'
        );
      } finally {
        setGeneratingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  const handleViewThesis = useCallback((thesis: ThesisListItem) => {
    const cached = deepDiveCache.current.get(thesis.canonicalKey);
    if (cached) {
      setDeepDiveThesis(thesis);
      return;
    }
    // Data exists server-side but not in local cache — fetch first then open
    (async () => {
      try {
        const data = await fetchThesisDeepDive(thesis.canonicalKey);
        if (data) {
          deepDiveCache.current.set(thesis.canonicalKey, data);
        }
      } catch {
        // Modal will handle loading
      }
      setDeepDiveThesis(thesis);
    })();
  }, []);

  const handleLabelChange = useCallback(async (canonicalKey: string, label: ThesisLabel) => {
    try {
      await setThesisLabel(canonicalKey, label);
      const shouldRemoveFromFilteredList = labelFilter !== 'all' && label !== labelFilter;
      setTheses((prev) => prev.flatMap((t) => {
        if (t.canonicalKey !== canonicalKey) return [t];
        if (shouldRemoveFromFilteredList) return [];
        return [{ ...t, label }];
      }));
      if (shouldRemoveFromFilteredList) {
        setThesisPageInfo((prev) => ({
          ...prev,
          totalItems: Math.max(0, prev.totalItems - 1),
        }));
        setOmapSelectedThesis((prev) => prev?.canonicalKey === canonicalKey ? null : prev);
        if (thesisFilter === canonicalKey) {
          setThesisFilter(null);
          setThesisFilterTitle('');
        }
      }
    } catch {
      showToast('Failed to update label', 'error');
    }
  }, [labelFilter, showToast, thesisFilter]);

  const handleRunAgent = async () => {
    manualRunRequestedRef.current = true;
    pendingManualRunIdRef.current = null;
    setAgentRunning(true);
    setAgentRunResult(null);
    setLogDrawerOpen(true);
    try {
      const run = await triggerAgentRun();
      pendingManualRunIdRef.current = run.runId;
      const latestStatus = latestWsAgentStatusRef.current;
      if (latestStatus && !latestStatus.isRunning && latestStatus.lastAttempt?.runId === run.runId) {
        manualRunRequestedRef.current = false;
        pendingManualRunIdRef.current = null;
        setAgentStatus(latestStatus);
        setAgentRunning(false);
        setAgentRunResult(summarizeAgentRun(latestStatus));
      }
    } catch {
      manualRunRequestedRef.current = false;
      pendingManualRunIdRef.current = null;
      setAgentRunning(false);
      setAgentRunResult('failed');
    }
  };

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <Sidebar
        connectors={ws.connectors}
        aiHealth={ws.aiHealth}
        agentStatus={agentStatus ?? ws.agentStatus}
        infraStatus={ws.infraStatus}
        thesisStats={thesisStats}
        signalCount={
          ws.signalCount
          ?? (Object.keys(ws.signalCounts).length > 0
            ? Object.values(ws.signalCounts).reduce((a, b) => a + b, 0)
            : undefined)
          ?? pageInfo.totalItems
        }
        latestSignalAt={ws.latestSignalAt}
        signalCounts={ws.signalCounts}
        onRunAgent={handleRunAgent}
        agentRunning={agentRunning}
        agentRunResult={agentRunResult}
        refreshMeta={ws.refreshMeta}
        onForceRefresh={handleForceRefresh}
        connected={ws.connected}
      />
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((v) => !v)}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        {sidebarOpen ? '\u25C0' : '\u25B6'}
      </button>

      <main className="main-content">
        {loadWarning ? <p role="alert">{loadWarning}</p> : null}

        {/* Split pane: theses | signals */}
        <div className="split-pane" ref={splitContainerRef}>
          {/* Left pane — Top Ideas (theses) */}
          <section className="pane pane-left" style={{ width: `${splitPct}%` }}>
            <div className="pane-header">
              <h2 className="pane-title">Top Ideas</h2>
              <div className="pane-header-right">
                <input
                  type="text"
                  className="pane-search"
                  placeholder="Search ideas..."
                  value={ideaSearch}
                  onChange={(e) => setIdeaSearch(e.target.value)}
                />
                <div className="profile-tabs">
                  <button
                    type="button"
                    className={`profile-tab ${activeProfile === 'all' ? 'active' : ''}`}
                    onClick={() => { setActiveProfile('all'); setRequestedThesisPage(1); }}
                  >
                    All
                  </button>
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`profile-tab ${activeProfile === p.id ? 'active' : ''}`}
                      onClick={() => { setActiveProfile(p.id); setRequestedThesisPage(1); }}
                      style={{ '--tab-color': p.display.badgeColor } as React.CSSProperties}
                    >
                      {p.display.badge}
                    </button>
                  ))}
                </div>
                <select
                  className="source-filter"
                  value={labelFilter}
                  onChange={(e) => { setLabelFilter(e.target.value); setRequestedThesisPage(1); }}
                >
                  <option value="all">All Labels</option>
                  <option value="favourite">Favourites</option>
                  <option value="later">Later</option>
                  <option value="dismissed">Dismissed</option>
                </select>
                <select
                  className="source-filter"
                  value={thesisSortField}
                  onChange={(e) => { setThesisSortField(e.target.value as ThesisSortField); setRequestedThesisPage(1); }}
                >
                  <option value="newest">Newest Added</option>
                  <option value="score">By Score</option>
                  <option value="latest">Latest Activity</option>
                  <option value="evidence">Most Evidence</option>
                </select>
                <select
                  className="source-filter"
                  value={thesisPageSize}
                  onChange={(e) => {
                    setThesisPageSize(parsePageSize(e.target.value, DEFAULT_THESIS_PAGE_SIZE));
                    setRequestedThesisPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}/page
                    </option>
                  ))}
                </select>
                {thesisPageInfo.totalPages > 1 && (
                  <>
                    <button
                      type="button"
                      className="page-btn"
                      onClick={() => setRequestedThesisPage((v) => Math.max(1, v - 1))}
                      disabled={!thesisPageInfo.hasPrev || isLoading}
                    >
                      Prev
                    </button>
                    <span className="page-info">
                      {thesisPageInfo.page} / {thesisPageInfo.totalPages}
                    </span>
                    <button
                      type="button"
                      className="page-btn"
                      onClick={() => setRequestedThesisPage((v) => v + 1)}
                      disabled={!thesisPageInfo.hasNext || isLoading}
                    >
                      Next
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="pane-scroll">
              {(omapSelectedThesis ? [omapSelectedThesis] : theses.filter(t => {
                if (!ideaSearch) return true;
                const q = ideaSearch.toLowerCase();
                return t.title.toLowerCase().includes(q) || t.problemStatement.toLowerCase().includes(q);
              })).map((t) => (
                <ThesisCard
                  key={t.canonicalKey}
                  thesis={t}
                  profileDisplay={profiles.find(p => p.id === (t as any).profileId)?.display ?? null}
                  isActive={thesisFilter === t.canonicalKey}
                  onClick={() => {
                    if (thesisFilter === t.canonicalKey) {
                      setOmapSelectedThesis(null);
                      handleThesisFilter(null, '');
                    } else {
                      setOmapSelectedThesis(null);
                      handleThesisFilter(t.canonicalKey, t.title);
                    }
                  }}
                  isGenerating={generatingKeys.has(t.canonicalKey)}
                  onExplore={() => handleExploreThesis(t)}
                  onView={() => handleViewThesis(t)}
                  onLabelChange={(label) => handleLabelChange(t.canonicalKey, label)}
                />
              ))}
              {theses.length === 0 && !omapSelectedThesis && (
                <div className="pane-empty">
                  <p>No theses yet</p>
                  <p className="pane-empty-hint">The research agent will synthesize top ideas from incoming signals.</p>
                </div>
              )}
            </div>
          </section>

          {/* Resize handle */}
          {/* biome-ignore lint/a11y/useSemanticElements: separator needs to be a draggable div, not an hr */}
          <div
            className="resize-handle"
            onMouseDown={onResizeStart}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); setSplitPct((v) => Math.max(MIN_PANE_PCT, v - 2)); }
              if (e.key === 'ArrowRight') { e.preventDefault(); setSplitPct((v) => Math.min(MAX_PANE_PCT, v + 2)); }
            }}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-valuenow={Math.round(splitPct)}
            aria-valuemin={MIN_PANE_PCT}
            aria-valuemax={MAX_PANE_PCT}
            aria-label="Resize panes"
          />

          {/* Right pane — Signal Feed */}
          <section className="pane pane-right" style={{ width: `${100 - splitPct}%` }}>
            <div className="pane-header">
              <h2 className="pane-title">Signals</h2>
              <div className="pane-header-right">
                <input
                  type="text"
                  className="pane-search"
                  placeholder="Search signals..."
                  value={signalSearch}
                  onChange={(e) => setSignalSearch(e.target.value)}
                />
                <select
                  className="source-filter"
                  value={sourceFilter}
                  onChange={(e) => { setSourceFilter(e.target.value); setRequestedPage(1); }}
                >
                  <option value="all">All Sources</option>
                  {ws.connectors.filter((c) => c.status === 'active').map((c) => (
                    <option key={c.name} value={connectorSourceKey[c.name] ?? c.name}>
                      {connectorDisplayName[c.name] ?? c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="source-filter"
                  value={sortField}
                  onChange={(e) => { setSortField(e.target.value as SortField); setRequestedPage(1); }}
                >
                  <option value="newest">Newest Added</option>
                  <option value="score">By Score</option>
                  <option value="virality">By Virality</option>
                  <option value="demand">By Demand</option>
                </select>
                <select
                  className="source-filter"
                  value={signalPageSize}
                  onChange={(e) => {
                    setSignalPageSize(parsePageSize(e.target.value, DEFAULT_SIGNAL_PAGE_SIZE));
                    setRequestedPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}/page
                    </option>
                  ))}
                </select>
                {thesisFilter && (
                  <div className="filter-chip">
                    <span>{thesisFilterTitle}</span>
                    <button type="button" onClick={() => { setThesisFilter(null); setThesisFilterTitle(''); setRequestedPage(1); }}>
                      &times;
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => setRequestedPage(1)}
                  disabled={!pageInfo.hasPrev || isLoading}
                  title="First page"
                >
                  &laquo;
                </button>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => setRequestedPage((value) => Math.max(1, value - 1))}
                  disabled={!pageInfo.hasPrev || isLoading}
                >
                  Prev
                </button>
                <span className="page-info">
                  {pageInfo.page} / {pageInfo.totalPages}
                </span>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => setRequestedPage((value) => value + 1)}
                  disabled={!pageInfo.hasNext || isLoading}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => setRequestedPage(pageInfo.totalPages)}
                  disabled={!pageInfo.hasNext || isLoading}
                  title="Last page"
                >
                  &raquo;
                </button>
              </div>
            </div>
            <div className="pane-scroll">
              <ul className="signal-list">
                {signals.filter(s => {
                  if (!signalSearch) return true;
                  const q = signalSearch.toLowerCase();
                  return s.idea.toLowerCase().includes(q) || s.snippet.toLowerCase().includes(q) || s.top_source.toLowerCase().includes(q);
                }).map((signal) => (
                  <SignalRow key={`${signal.idea}-${signal.updated_at}`} signal={signal} />
                ))}
                {signals.length === 0 && (
                  <li className="signal-empty">No signals found for the current filters.</li>
                )}
              </ul>
            </div>
          </section>
        </div>

        {/* Opportunity Map drawer — collapsible bottom */}
        <section className={`omap-drawer ${omapOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="omap-drawer-toggle"
            onClick={() => setOmapOpen((v) => !v)}
          >
            <span className="omap-drawer-title">
              Opportunity Map
            </span>
            <span className="omap-drawer-chevron">{omapOpen ? '\u25BC' : '\u25B2'}</span>
          </button>
          {omapOpen && (
            <div className="omap-drawer-scroll">
              <OpportunityMapView
                onViewThesis={(key, title) => {
                  if (thesisFilter === key) {
                    // Toggle off
                    setOmapSelectedThesis(null);
                    handleThesisFilter(null, '');
                    return;
                  }
                  // Filter signals by this thesis
                  handleThesisFilter(key, title);
                  // Show this thesis in the Top Ideas pane
                  const cached = theses.find(t => t.canonicalKey === key);
                  if (cached) {
                    setOmapSelectedThesis(cached);
                  } else {
                    fetchThesis(key)
                      .then(setOmapSelectedThesis)
                      .catch(() => setOmapSelectedThesis(null));
                  }
                }}
              />
            </div>
          )}
        </section>

        {/* Scoring Health drawer — collapsible bottom */}
        <section className={`omap-drawer ${scoringHealthOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="omap-drawer-toggle"
            onClick={() => setScoringHealthOpen((v) => !v)}
          >
            <span className="omap-drawer-title">
              Scoring Health
            </span>
            <span className="omap-drawer-chevron">{scoringHealthOpen ? '\u25BC' : '\u25B2'}</span>
          </button>
          {scoringHealthOpen && (
            <div className="omap-drawer-scroll">
              <ScoringHealth profiles={profiles} />
            </div>
          )}
        </section>

        {/* Connections drawer — collapsible bottom */}
        <section className={`omap-drawer ${connectionsOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="omap-drawer-toggle"
            onClick={() => setConnectionsOpen((v) => !v)}
          >
            <span className="omap-drawer-title">
              Connections
            </span>
            <span className="omap-drawer-chevron">{connectionsOpen ? '\u25BC' : '\u25B2'}</span>
          </button>
          {connectionsOpen && (
            <div className="omap-drawer-scroll">
              <ConnectionsView />
            </div>
          )}
        </section>

        {/* Log drawer — collapsible bottom */}
        <section className={`log-drawer ${logDrawerOpen ? 'open' : ''}`}>
          <div
            className="log-drawer-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={logDrawerOpen}
            onClick={() => setLogDrawerOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setLogDrawerOpen((v) => !v);
              }
            }}
          >
            <span className="log-drawer-title">
              Logs
              <span className="log-drawer-count">{ws.logs.length}</span>
              <span className={`log-drawer-status ${ws.connected ? 'live' : ''}`}>
                {ws.connected ? 'LIVE' : 'DISCONNECTED'}
              </span>
            </span>
            <span className="log-drawer-right">
              {logDrawerOpen && (
                <button
                  type="button"
                  className="log-action-btn"
                  title="Copy logs to clipboard"
                  onClick={(e) => {
                    e.stopPropagation();
                    const text = renderedLogs.map(formatTerminalLine).join('\n');
                    navigator.clipboard.writeText(text);
                  }}
                >
                  Copy
                </button>
              )}
              <span className="log-drawer-chevron">{logDrawerOpen ? '\u25BC' : '\u25B2'}</span>
            </span>
          </div>
          {logDrawerOpen && (
            <div className="log-scroll-wrapper">
              <div className="log-filters">
                <select
                  className="log-filter-select"
                  value={logComponentFilter}
                  onChange={(e) => setLogComponentFilter(e.target.value)}
                >
                  <option value="all">All components</option>
                  {logComponents.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <span className="log-level-toggles">
                  {(['info', 'warn', 'error', 'debug'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`log-level-toggle ${lvl} ${logLevelFilter.has(lvl) ? 'active' : ''}`}
                      onClick={() => toggleLogLevel(lvl)}
                    >
                      {logLevelIcons[lvl]} {lvl}
                    </button>
                  ))}
                </span>
                <span className="log-filter-count">{renderedLogs.length} entries</span>
              </div>
              <ul ref={logListRef} className="log-list terminal-list" onScroll={handleLogScroll}>
                {renderedLogs.map((entry, index) => (
                  <li
                    key={`${entry.ts}-${entry.run_id}-${entry.component}-${entry.message}-${index}`}
                    className={`log-row terminal-row ${entry.level}`}
                  >
                    <code className="terminal-line">
                      <span className={`terminal-icon ${entry.level}`} aria-hidden="true">
                        {logLevelIcons[entry.level]}
                      </span>
                      {formatTerminalLine(entry)}
                    </code>
                  </li>
                ))}
                {ws.logs.length === 0 ? <li className="log-empty">No execution logs yet.</li> : null}
              </ul>
              {!logAtBottom && (
                <button type="button" className="log-scroll-bottom" onClick={scrollLogsToBottom}>
                  {'\u25BC'} Latest
                </button>
              )}
            </div>
          )}
        </section>
      </main>
      {deepDiveThesis && (
        <ThesisDeepDiveModal
          thesis={deepDiveThesis}
          cachedData={deepDiveCache.current.get(deepDiveThesis.canonicalKey) ?? null}
          onClose={() => setDeepDiveThesis(null)}
        />
      )}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default App;
