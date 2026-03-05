// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentStatusRecord,
  type AiHealthRecord,
  buildApiUrl,
  type ConnectorRecord,
  type ExecutionLogRecord,
  fetchAgentStatus,
  fetchAiHealth,
  fetchConnectors,
  fetchInfraStatus,
  fetchLogs,
  fetchRefreshMeta,
  fetchSignalCounts,
  fetchSignals,
  fetchTheses,
  type InfraStatusRecord,
  type RefreshMeta,
  type SignalRecord,
  type SortField,
  type ThesisListItem,
  type ThesisSortField,
  type ThesisStats,
  triggerAgentRun,
  triggerConnectorRefresh
} from './api';
import { Sidebar } from './components/Sidebar';
import { SignalRow } from './components/SignalRow';
import { ThesisCard } from './components/ThesisCard';
import { ThesisDeepDiveModal } from './components/ThesisDeepDiveModal';
import { connectorDisplayName, connectorSourceKey } from './connectorNames';

const PAGE_SIZE = 8;
const LOG_POLL_INTERVAL_MS = 3_000;
const LOG_LIMIT = 120;
const DATA_POLL_INTERVAL_MS = 15_000;
const MIN_PANE_PCT = 20;
const MAX_PANE_PCT = 80;

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
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [aiHealth, setAiHealth] = useState<AiHealthRecord | null>(null);
  const [theses, setTheses] = useState<ThesisListItem[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusRecord | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentRunResult, setAgentRunResult] = useState<string | null>(null);
  const [infraStatus, setInfraStatus] = useState<InfraStatusRecord | null>(null);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [logsRealtime, setLogsRealtime] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const failCountRef = useRef(0);
  const prevRunningRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('newest');
  const [thesisFilter, setThesisFilter] = useState<string | null>(null);
  const [thesisFilterTitle, setThesisFilterTitle] = useState<string>('');
  const [deepDiveThesis, setDeepDiveThesis] = useState<ThesisListItem | null>(null);
  const [refreshMeta, setRefreshMeta] = useState<RefreshMeta | null>(null);
  const [requestedPage, setRequestedPage] = useState(1);
  const [requestedThesisPage, setRequestedThesisPage] = useState(1);
  const [thesisSortField, setThesisSortField] = useState<ThesisSortField>('newest');
  const [thesisStats, setThesisStats] = useState<ThesisStats>({ total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 });
  const [thesisPageInfo, setThesisPageInfo] = useState({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [logAtBottom, setLogAtBottom] = useState(true);
  const [splitPct, setSplitPct] = useState(50);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pageInfo, setPageInfo] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });
  const [latestSignalAt, setLatestSignalAt] = useState<string | null>(null);
  const renderedLogs = useMemo(() => logs.slice().reverse(), [logs]);
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
    const load = async (showLoading = false) => {
      if (showLoading) {
        setIsLoading(true);
      }
      const [signalResult, connectorResult, aiHealthResult, agentResult, countsResult, infraResult, refreshMetaResult] = await Promise.allSettled([
        fetchSignals({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
          ...(thesisFilter !== null ? { thesisKey: thesisFilter } : {}),
          sort: sortField,
        }),
        fetchConnectors(),
        fetchAiHealth(),
        fetchAgentStatus(),
        fetchSignalCounts(),
        fetchInfraStatus(),
        fetchRefreshMeta()
      ]);
      const warnings: string[] = [];

      if (signalResult.status === 'fulfilled') {
        setSignals(signalResult.value.items);
        setPageInfo({
          page: signalResult.value.page,
          pageSize: signalResult.value.page_size,
          totalItems: signalResult.value.total_items,
          totalPages: signalResult.value.total_pages,
          hasNext: signalResult.value.has_next,
          hasPrev: signalResult.value.has_prev
        });
        if (signalResult.value.page === 1 && signalResult.value.items.length > 0) {
          setLatestSignalAt(signalResult.value.items[0].updated_at);
        }
        if (signalResult.value.page !== requestedPage) {
          setRequestedPage(signalResult.value.page);
        }
      } else {
        warnings.push('signals');
      }

      if (connectorResult.status === 'fulfilled') {
        setConnectors(connectorResult.value);
      } else {
        warnings.push('connectors');
      }

      if (aiHealthResult.status === 'fulfilled') {
        setAiHealth(aiHealthResult.value);
      } else {
        warnings.push('ai_health');
      }

      if (agentResult.status === 'fulfilled') {
        const wasRunning = prevRunningRef.current;
        const nowRunning = agentResult.value.isRunning;
        prevRunningRef.current = nowRunning;
        setAgentStatus(agentResult.value);
        setAgentRunning(nowRunning);
        // Agent just finished — show result and refresh theses/signals
        if (wasRunning && !nowRunning && agentResult.value.lastRun) {
          const lr = agentResult.value.lastRun;
          setAgentRunResult(`${lr.thesesUpdated} updated, ${lr.newCandidates} new`);
          // Refresh theses and signals to reflect agent changes
          Promise.allSettled([
            fetchTheses({ page: 1, pageSize: 10, sort: thesisSortField }),
            fetchSignals({ page: requestedPage, pageSize: PAGE_SIZE }),
            fetchSignalCounts()
          ]).then(([thesesRes, signalsRes, countsRes]) => {
            if (thesesRes.status === 'fulfilled') {
              const tp = thesesRes.value;
              setTheses(tp.items);
              setRequestedThesisPage(1);
              setThesisPageInfo({ page: tp.page, pageSize: tp.page_size, totalItems: tp.total_items, totalPages: tp.total_pages, hasNext: tp.has_next, hasPrev: tp.has_prev });
              if (tp.stats) setThesisStats(tp.stats);
            }
            if (signalsRes.status === 'fulfilled') {
              setSignals(signalsRes.value.items);
              setPageInfo({ page: signalsRes.value.page, pageSize: signalsRes.value.page_size, totalItems: signalsRes.value.total_items, totalPages: signalsRes.value.total_pages, hasNext: signalsRes.value.has_next, hasPrev: signalsRes.value.has_prev });
              if (signalsRes.value.items.length > 0) setLatestSignalAt(signalsRes.value.items[0].updated_at);
            }
            if (countsRes.status === 'fulfilled') setSignalCounts(countsRes.value);
          });
        }
      }

      if (countsResult.status === 'fulfilled') {
        setSignalCounts(countsResult.value);
      }

      if (infraResult.status === 'fulfilled') {
        setInfraStatus(infraResult.value);
      }

      if (refreshMetaResult.status === 'fulfilled') {
        setRefreshMeta(refreshMetaResult.value);
      }

      if (warnings.length > 0) {
        failCountRef.current++;
        // Show warning immediately on initial load, after 2+ consecutive on background polls
        if (showLoading || failCountRef.current >= 2) {
          setLoadWarning(`Some data could not be loaded (${warnings.join(', ')})`);
        }
      } else {
        failCountRef.current = 0;
        setLoadWarning(null);
      }

      if (showLoading) {
        setIsLoading(false);
      }
    };

    void load(true);
    const timer = setInterval(() => {
      void load(false);
    }, DATA_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [requestedPage, sourceFilter, thesisFilter, sortField]);

  // Separate thesis-only fetch (avoids 7-endpoint refresh on page change)
  useEffect(() => {
    let isCancelled = false;
    const loadTheses = async () => {
      try {
        const tp = await fetchTheses({
          page: requestedThesisPage,
          pageSize: 10,
          sort: thesisSortField,
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
      } catch { /* handled by bulk fetch warning */ }
    };
    void loadTheses();
    return () => { isCancelled = true; };
  }, [requestedThesisPage, thesisSortField]);

  useEffect(() => {
    let isCancelled = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let eventSource: EventSource | null = null;

    const loadLogs = async () => {
      try {
        const data = await fetchLogs({ limit: LOG_LIMIT });
        if (!isCancelled) {
          setLogs(data);
        }
      } catch {
        if (!isCancelled) {
          setLoadWarning((current) => current ?? 'Some data could not be loaded (logs)');
        }
      }
    };

    const startFallbackPolling = () => {
      if (fallbackTimer) {
        return;
      }

      void loadLogs();
      fallbackTimer = setInterval(() => {
        void loadLogs();
      }, LOG_POLL_INTERVAL_MS);
    };

    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource(buildApiUrl(`/v1/logs/stream?limit=${LOG_LIMIT}`));
      eventSource.addEventListener('open', () => {
        if (!isCancelled) {
          setLogsRealtime(true);
        }
      });
      eventSource.addEventListener('logs', (event) => {
        if (isCancelled) {
          return;
        }

        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as ExecutionLogRecord[];
          setLogs(parsed);
          setLogsRealtime(true);
        } catch {
          setLogsRealtime(false);
        }
      });
      eventSource.addEventListener('heartbeat', () => {
        if (!isCancelled) {
          setLogsRealtime(true);
        }
      });
      eventSource.addEventListener('stream_error', () => {
        if (!isCancelled) {
          setLogsRealtime(false);
          setLoadWarning((current) => current ?? 'Log stream reported an error. Falling back to polling when needed.');
        }
      });
      eventSource.onerror = () => {
        if (isCancelled) {
          return;
        }

        setLogsRealtime(false);
        eventSource?.close();
        eventSource = null;
        startFallbackPolling();
      };
    } else {
      startFallbackPolling();
    }

    return () => {
      isCancelled = true;
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
      }
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderedLogs+logDrawerOpen trigger scroll-to-bottom
  useEffect(() => {
    const list = logListRef.current;
    if (!list || !logAtBottom) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, [renderedLogs, logDrawerOpen]);

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

  const handleRunAgent = async () => {
    setAgentRunning(true);
    setAgentRunResult(null);
    setLogDrawerOpen(true);
    try {
      await triggerAgentRun();
      // 202 accepted — agent runs in background.
      // Polling via GET /v1/agent/status handles running→done transition.
    } catch {
      setAgentRunning(false);
      setAgentRunResult('failed');
    }
  };

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <Sidebar
        connectors={connectors}
        aiHealth={aiHealth}
        agentStatus={agentStatus}
        infraStatus={infraStatus}
        thesisStats={thesisStats}
        thesisFilter={thesisFilter}
        onThesisFilter={handleThesisFilter}
        signalCount={pageInfo.totalItems}
        latestSignalAt={latestSignalAt}
        signalCounts={signalCounts}
        onRunAgent={handleRunAgent}
        agentRunning={agentRunning}
        agentRunResult={agentRunResult}
        refreshMeta={refreshMeta}
        onForceRefresh={handleForceRefresh}
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
              <select
                className="source-filter"
                value={thesisSortField}
                onChange={(e) => { setThesisSortField(e.target.value as ThesisSortField); setRequestedThesisPage(1); }}
              >
                <option value="newest">Newest</option>
                <option value="score">By Score</option>
                <option value="latest">Latest Activity</option>
                <option value="evidence">Most Evidence</option>
              </select>
              {thesisPageInfo.totalPages > 1 && (
                <div className="pane-header-right">
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
                </div>
              )}
            </div>
            <div className="pane-scroll">
              {theses.map((t) => (
                <ThesisCard
                  key={t.canonicalKey}
                  thesis={t}
                  isActive={thesisFilter === t.canonicalKey}
                  onClick={() => handleThesisFilter(
                    thesisFilter === t.canonicalKey ? null : t.canonicalKey,
                    thesisFilter === t.canonicalKey ? '' : t.title
                  )}
                  onExplore={() => setDeepDiveThesis(t)}
                />
              ))}
              {theses.length === 0 && (
                <div className="pane-empty">
                  <p>No theses yet</p>
                  <p className="pane-empty-hint">The research agent will synthesize top ideas from incoming signals.</p>
                </div>
              )}
            </div>
          </section>

          {/* Resize handle */}
          {/* biome-ignore lint/a11y/useKeyboardHandler: resize is mouse-only, keyboard users can use default 50/50 */}
          <div className="resize-handle" onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" />

          {/* Right pane — Signal Feed */}
          <section className="pane pane-right" style={{ width: `${100 - splitPct}%` }}>
            <div className="pane-header">
              <div className="pane-header-left">
                <h2 className="pane-title">Signals</h2>
                <select
                  className="source-filter"
                  value={sourceFilter}
                  onChange={(e) => { setSourceFilter(e.target.value); setRequestedPage(1); }}
                >
                  <option value="all">All Sources</option>
                  {connectors.filter((c) => c.status === 'active').map((c) => (
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
                  <option value="newest">Newest</option>
                  <option value="score">By Score</option>
                  <option value="virality">By Virality</option>
                  <option value="demand">By Demand</option>
                </select>
                {thesisFilter && (
                  <div className="filter-chip">
                    <span>{thesisFilterTitle}</span>
                    <button type="button" onClick={() => { setThesisFilter(null); setThesisFilterTitle(''); setRequestedPage(1); }}>
                      &times;
                    </button>
                  </div>
                )}
              </div>
              <div className="pane-header-right">
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
                {signals.map((signal) => (
                  <SignalRow key={`${signal.idea}-${signal.updated_at}`} signal={signal} />
                ))}
                {signals.length === 0 && (
                  <li className="signal-empty">No signals found for the current filters.</li>
                )}
              </ul>
            </div>
          </section>
        </div>

        {/* Log drawer — collapsible bottom */}
        <section className={`log-drawer ${logDrawerOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="log-drawer-toggle"
            onClick={() => setLogDrawerOpen((v) => !v)}
          >
            <span className="log-drawer-title">
              Logs
              <span className="log-drawer-count">{logs.length}</span>
              <span className={`log-drawer-status ${logsRealtime ? 'live' : ''}`}>
                {logsRealtime ? 'LIVE' : 'POLLING'}
              </span>
            </span>
            <span className="log-drawer-right">
              {logDrawerOpen && (
                <>
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
                  <button
                    type="button"
                    className="log-action-btn"
                    title="Clear log view"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLogs([]);
                    }}
                  >
                    Clear
                  </button>
                </>
              )}
              <span className="log-drawer-chevron">{logDrawerOpen ? '\u25BC' : '\u25B2'}</span>
            </span>
          </button>
          {logDrawerOpen && (
            <div className="log-scroll-wrapper">
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
                {logs.length === 0 ? <li className="log-empty">No execution logs yet.</li> : null}
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
          onClose={() => setDeepDiveThesis(null)}
        />
      )}
    </div>
  );
};

export default App;
