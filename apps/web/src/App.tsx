// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentStatusRecord,
  type AiHealthRecord,
  buildApiUrl,
  type ConnectorRecord,
  type ExecutionLogRecord,
  fetchAgentStatus,
  fetchAiHealth,
  fetchConnectors,
  fetchLogs,
  fetchSignals,
  fetchTheses,
  type SignalRecord,
  type ThesisListItem
} from './api';
import { SignalRow } from './components/SignalRow';
import { StatusCards } from './components/StatusCards';
import { ThesisCard } from './components/ThesisCard';

const PAGE_SIZE = 8;
const LOG_POLL_INTERVAL_MS = 3_000;
const LOG_LIMIT = 120;
const DATA_POLL_INTERVAL_MS = 15_000;

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
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [logsRealtime, setLogsRealtime] = useState(false);
  const [logsCollapsed, setLogsCollapsed] = useState(true);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [thesisFilter, setThesisFilter] = useState<string | null>(null);
  const [thesisFilterTitle, setThesisFilterTitle] = useState<string>('');
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });
  const activeConnectors = connectors.filter((connector) => connector.status === 'active').length;
  const latestSignalAt = signals[0]?.updated_at ?? null;
  const topThesis = theses.length > 0 ? theses[0] : null;
  const agentLastRun = agentStatus?.lastRun
    ? new Date(agentStatus.lastRun.timestamp).toLocaleTimeString()
    : 'pending';
  const renderedLogs = useMemo(() => logs.slice().reverse(), [logs]);
  const logListRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const load = async (showLoading = false) => {
      if (showLoading) {
        setIsLoading(true);
      }
      const [signalResult, connectorResult, aiHealthResult, thesesResult, agentResult] = await Promise.allSettled([
        fetchSignals({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          source: sourceFilter === 'all' ? undefined : sourceFilter,
          thesisKey: thesisFilter ?? undefined,
        }),
        fetchConnectors(),
        fetchAiHealth(),
        fetchTheses(),
        fetchAgentStatus()
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
        setTheses(thesesResult.value);
      }
      // Thesis/agent failures are non-critical; don't add to warnings

      if (agentResult.status === 'fulfilled') {
        setAgentStatus(agentResult.value);
      }

      if (warnings.length > 0) {
        setLoadWarning(`Some data could not be loaded (${warnings.join(', ')})`);
      } else {
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
  }, [requestedPage, sourceFilter, thesisFilter]);

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

  useEffect(() => {
    const list = logListRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
  }, []);

  const displayTheses = theses.slice(0, 3);

  return (
    <main className="future-shell">
      <div className="halo halo-one" />
      <div className="halo halo-two" />

      {/* HEADER: Stats bar */}
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Sixth Sense Idea Engine</p>
          <h1>Future Market Radar</h1>
          <p className="refresh">Live opportunity intelligence with memory-aware scoring.</p>
        </div>
        <div className="stat-grid">
          <article className="stat-card">
            <span>Signals</span>
            <strong>{pageInfo.totalItems}</strong>
          </article>
          <article className="stat-card">
            <span>Connectors</span>
            <strong>{activeConnectors}</strong>
          </article>
          <article className="stat-card">
            <span>Last Update</span>
            <strong>{latestSignalAt ? new Date(latestSignalAt).toLocaleTimeString() : 'pending'}</strong>
          </article>
          <article className="stat-card">
            <span>Top Thesis</span>
            <strong>{topThesis ? `${topThesis.title.slice(0, 22)}${topThesis.title.length > 22 ? '\u2026' : ''}` : 'none'}</strong>
          </article>
          <article className="stat-card">
            <span>Agent Last Run</span>
            <strong>{agentLastRun}</strong>
          </article>
        </div>
      </header>

      {loadWarning ? <p role="alert">{loadWarning}</p> : null}

      {/* TOP THESES: horizontal cards */}
      <section className="thesis-board-section">
        <h2 className="section-heading">Top Theses</h2>
        <div className="thesis-board">
          {displayTheses.map((t) => (
            <ThesisCard
              key={t.canonicalKey}
              thesis={t}
              isActive={thesisFilter === t.canonicalKey}
              onClick={() => {
                if (thesisFilter === t.canonicalKey) {
                  setThesisFilter(null);
                  setThesisFilterTitle('');
                } else {
                  setThesisFilter(t.canonicalKey);
                  setThesisFilterTitle(t.title);
                  setRequestedPage(1);
                }
              }}
            />
          ))}
        </div>
        {theses.length === 0 && (
          <p className="thesis-empty">No theses yet. The research agent will synthesize theses from incoming signals.</p>
        )}
      </section>

      {/* Status Cards Row */}
      <StatusCards
        connectors={connectors}
        aiHealth={aiHealth}
        agentStatus={agentStatus}
      />

      {/* Thesis filter banner */}
      {thesisFilter && (
        <div className="thesis-filter-banner">
          <span>Showing signals for: <strong>{thesisFilterTitle}</strong></span>
          <button type="button" onClick={() => { setThesisFilter(null); setThesisFilterTitle(''); setRequestedPage(1); }}>
            Clear filter
          </button>
        </div>
      )}

      {/* Opportunity Signals — full width */}
      <section className="signal-card">
        <div className="signal-header">
          <h2>Opportunity Signals</h2>
          <div className="signal-controls">
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
            <div className="signal-pagination">
              <span>
                Page {pageInfo.page} / {pageInfo.totalPages}
              </span>
              <button
                type="button"
                onClick={() => setRequestedPage((value) => Math.max(1, value - 1))}
                disabled={!pageInfo.hasPrev || isLoading}
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setRequestedPage((value) => value + 1)}
                disabled={!pageInfo.hasNext || isLoading}
              >
                Next
              </button>
            </div>
          </div>
        </div>
        <ul className="signal-list">
          {signals.map((signal) => (
            <SignalRow key={`${signal.idea}-${signal.updated_at}`} signal={signal} />
          ))}
          {signals.length === 0 && (
            <li className="signal-empty">No signals found for the current filters.</li>
          )}
        </ul>
      </section>

      {/* LOGS: collapsed drawer at bottom */}
      <section className={`log-drawer ${logsCollapsed ? 'collapsed' : ''}`}>
        <button
          type="button"
          className="log-drawer-toggle"
          onClick={() => setLogsCollapsed((prev) => !prev)}
        >
          <span>
            Runtime Logs
            <span className={`log-hint ${logsRealtime ? 'online' : 'offline'}`}>
              {' '}<span className={`status-dot ${logsRealtime ? 'active' : 'disabled'}`} aria-hidden="true" />
              {' '}{logsRealtime ? 'LIVE' : 'POLLING'} &middot; {logs.length} entries
            </span>
          </span>
          <span className="log-drawer-chevron">{logsCollapsed ? '\u25BC' : '\u25B2'}</span>
        </button>
        <ul ref={logListRef} className="log-list terminal-list">
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
      </section>
    </main>
  );
};

export default App;
