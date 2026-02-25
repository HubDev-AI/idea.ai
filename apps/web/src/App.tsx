import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AiHealthPanel } from './components/AiHealthPanel';
import { ConnectorStatus } from './components/ConnectorStatus';
import { SignalRow } from './components/SignalRow';
import {
  fetchAiHealth,
  buildApiUrl,
  fetchConnectors,
  fetchLogs,
  fetchSignals,
  type AiHealthRecord,
  type ConnectorRecord,
  type ExecutionLogRecord,
  type SignalRecord
} from './api';
import { isIdeaCandidateSignal } from './idea';

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
  debug: '○',
  info: '●',
  warn: '▲',
  error: '✖'
};

const App = () => {
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [aiHealth, setAiHealth] = useState<AiHealthRecord | null>(null);
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [logsRealtime, setLogsRealtime] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({
    page: 1,
    pageSize: PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });
  const ideaCandidates = signals.filter((signal) => isIdeaCandidateSignal(signal)).slice(0, 3);
  const activeConnectors = connectors.filter((connector) => connector.status === 'active').length;
  const latestSignalAt = signals[0]?.updated_at ?? null;
  const renderedLogs = useMemo(() => logs.slice().reverse(), [logs]);
  const logListRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const load = async (showLoading = false) => {
      if (showLoading) {
        setIsLoading(true);
      }
      const [signalResult, connectorResult, aiHealthResult] = await Promise.allSettled([
        fetchSignals({ page: requestedPage, pageSize: PAGE_SIZE }),
        fetchConnectors(),
        fetchAiHealth()
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
  }, [requestedPage]);

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
  }, [renderedLogs]);

  return (
    <main className="future-shell">
      <div className="halo halo-one" />
      <div className="halo halo-two" />

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
        </div>
      </header>

      {loadWarning ? <p role="alert">{loadWarning}</p> : null}

      <section className="workspace-grid">
        <div className="workspace-main">
          <AiHealthPanel aiHealth={aiHealth} />

          <section className={`idea-banner ${ideaCandidates.length > 0 ? 'found' : 'waiting'}`}>
            {ideaCandidates.length > 0 ? (
              <>
                <h2>Idea Candidate Found</h2>
                <p>
                  {ideaCandidates.length} high-confidence signal{ideaCandidates.length === 1 ? '' : 's'} detected.
                </p>
                <ul>
                  {ideaCandidates.map((signal) => (
                    <li key={`${signal.idea}-${signal.updated_at}`}>{`${signal.idea} (${signal.score})`}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h2>No Strong Idea Yet</h2>
                <p>Engine is collecting evidence across runs. Keep it running and check again after new refresh cycles.</p>
              </>
            )}
          </section>

          <ConnectorStatus connectors={connectors} />

          <section className="signal-card">
            <div className="signal-header">
              <h2>Opportunity Signals</h2>
              <div className="signal-pagination">
                <span>
                  Page {pageInfo.page} / {pageInfo.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setRequestedPage((value) => Math.max(1, value - 1))}
                  disabled={!pageInfo.hasPrev || isLoading}
                >
                  Previous
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
            <ul className="signal-list">
              {signals.map((signal) => (
                <SignalRow key={`${signal.idea}-${signal.updated_at}`} signal={signal} />
              ))}
            </ul>
          </section>
        </div>

        <aside className="log-card terminal-card">
          <div className="signal-header">
            <h2>Runtime Logs</h2>
            <span className={`log-hint ${logsRealtime ? 'online' : 'offline'}`}>
              <span className={`status-dot ${logsRealtime ? 'active' : 'disabled'}`} aria-hidden="true" />
              {logsRealtime ? 'LIVE' : 'POLLING'} · {logs.length} entries
            </span>
          </div>
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
        </aside>
      </section>
    </main>
  );
};

export default App;
