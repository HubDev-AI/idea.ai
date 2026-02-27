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
  fetchSignalCounts,
  fetchSignals,
  fetchTheses,
  type InfraStatusRecord,
  type SignalRecord,
  type ThesisListItem,
  triggerAgentRun
} from './api';
import { Sidebar } from './components/Sidebar';
import { SignalRow } from './components/SignalRow';
import { ThesisCard } from './components/ThesisCard';

const PAGE_SIZE = 8;
const LOG_POLL_INTERVAL_MS = 3_000;
const LOG_LIMIT = 120;
const DATA_POLL_INTERVAL_MS = 15_000;
const MIN_PANE_PCT = 20;
const MAX_PANE_PCT = 80;

const formatLogContext = (context: Record<string, unknown> | undefined): string => {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  const serialized = JSON.stringify(context);
  if (serialized.length <= 280) {
    return serialized;
  }

  return `${serialized.slice(0, 277)}...`;
};

const formatTerminalLine = (entry: ExecutionLogRecord): string => {
  const timestamp = new Date(entry.ts).toLocaleTimeString();
  const context = formatLogContext(entry.context);
  const suffix = context ? ` | ${context}` : '';
  return `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] run=${entry.run_id} ${entry.message}${suffix}`;
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
  const [isLoading, setIsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [thesisFilter, setThesisFilter] = useState<string | null>(null);
  const [thesisFilterTitle, setThesisFilterTitle] = useState<string>('');
  const [requestedPage, setRequestedPage] = useState(1);
  const [requestedThesisPage, setRequestedThesisPage] = useState(1);
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
  const latestSignalAt = signals[0]?.updated_at ?? null;
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
      const [signalResult, connectorResult, aiHealthResult, thesesResult, agentResult, countsResult, infraResult] = await Promise.allSettled([
        fetchSignals({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
          ...(thesisFilter !== null ? { thesisKey: thesisFilter } : {}),
        }),
        fetchConnectors(),
        fetchAiHealth(),
        fetchTheses({ page: requestedThesisPage, pageSize: 10 }),
        fetchAgentStatus(),
        fetchSignalCounts(),
        fetchInfraStatus()
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

      if (thesesResult.status === 'fulfilled') {
        const tp = thesesResult.value;
        if (Array.isArray(tp)) {
          // Legacy flat array response (server not yet updated)
          setTheses(tp);
        } else {
          setTheses(tp.items);
          setThesisPageInfo({
            page: tp.page,
            pageSize: tp.page_size,
            totalItems: tp.total_items,
            totalPages: tp.total_pages,
            hasNext: tp.has_next,
            hasPrev: tp.has_prev
          });
        }
      }

      if (agentResult.status === 'fulfilled') {
        setAgentStatus(agentResult.value);
      }

      if (countsResult.status === 'fulfilled') {
        setSignalCounts(countsResult.value);
      }

      if (infraResult.status === 'fulfilled') {
        setInfraStatus(infraResult.value);
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
  }, [requestedPage, requestedThesisPage, sourceFilter, thesisFilter]);

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

  const handleRunAgent = async () => {
    setAgentRunning(true);
    setAgentRunResult(null);
    setLogDrawerOpen(true);
    try {
      const result = await triggerAgentRun();
      // Refresh all data since the agent creates/updates theses
      const [statusRes, thesesRes, signalsRes, countsRes] = await Promise.allSettled([
        fetchAgentStatus(),
        fetchTheses({ page: 1, pageSize: 10 }),
        fetchSignals({ page: requestedPage, pageSize: PAGE_SIZE }),
        fetchSignalCounts()
      ]);
      if (statusRes.status === 'fulfilled') setAgentStatus(statusRes.value);
      if (thesesRes.status === 'fulfilled') {
        const tp = thesesRes.value;
        if (Array.isArray(tp)) {
          setTheses(tp);
        } else {
          setTheses(tp.items);
          setRequestedThesisPage(1);
          setThesisPageInfo({
            page: tp.page,
            pageSize: tp.page_size,
            totalItems: tp.total_items,
            totalPages: tp.total_pages,
            hasNext: tp.has_next,
            hasPrev: tp.has_prev
          });
        }
      }
      if (signalsRes.status === 'fulfilled') {
        setSignals(signalsRes.value.items);
        setPageInfo({
          page: signalsRes.value.page,
          pageSize: signalsRes.value.page_size,
          totalItems: signalsRes.value.total_items,
          totalPages: signalsRes.value.total_pages,
          hasNext: signalsRes.value.has_next,
          hasPrev: signalsRes.value.has_prev
        });
      }
      if (countsRes.status === 'fulfilled') setSignalCounts(countsRes.value);
      setAgentRunResult(`${result.thesesUpdated} updated, ${result.newCandidates} new`);
    } catch {
      setAgentRunResult('failed');
    } finally {
      setAgentRunning(false);
    }
  };

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <Sidebar
        connectors={connectors}
        aiHealth={aiHealth}
        agentStatus={agentStatus}
        infraStatus={infraStatus}
        theses={theses}
        thesisFilter={thesisFilter}
        onThesisFilter={handleThesisFilter}
        signalCount={pageInfo.totalItems}
        latestSignalAt={latestSignalAt}
        signalCounts={signalCounts}
        onRunAgent={handleRunAgent}
        agentRunning={agentRunning}
        agentRunResult={agentRunResult}
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
              <span className="pane-count">{thesisPageInfo.totalItems}</span>
              {thesisPageInfo.totalPages > 1 && (
                <div className="pane-header-right">
                  <button
                    type="button"
                    className="page-btn"
                    onClick={() => setRequestedThesisPage((v) => Math.max(1, v - 1))}
                    disabled={!thesisPageInfo.hasPrev}
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
                    disabled={!thesisPageInfo.hasNext}
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
                  onClick={() => {
                    if (thesisFilter === t.canonicalKey) {
                      setThesisFilter(null);
                      setThesisFilterTitle('');
                      setRequestedPage(1);
                    } else {
                      setThesisFilter(t.canonicalKey);
                      setThesisFilterTitle(t.title);
                      setRequestedPage(1);
                    }
                  }}
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
                  {connectors.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
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
            <span className="log-drawer-chevron">{logDrawerOpen ? '\u25BC' : '\u25B2'}</span>
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
    </div>
  );
};

export default App;
