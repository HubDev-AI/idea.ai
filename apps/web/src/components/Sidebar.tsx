// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React, { useEffect, useState } from 'react';
import type { AgentStatusRecord, AiHealthRecord, ConnectorRecord, InfraStatusRecord, ThesisListItem } from '../api';

type SidebarProps = {
  connectors: ConnectorRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
  infraStatus: InfraStatusRecord | null;
  theses: ThesisListItem[];
  thesisFilter: string | null;
  onThesisFilter: (key: string | null, title: string) => void;
  signalCount: number;
  latestSignalAt: string | null;
  signalCounts: Record<string, number>;
  onRunAgent?: () => void;
  agentRunning?: boolean;
  agentRunResult?: string | null;
};

const dotClass = (status: string, enabled?: boolean): string => {
  if (status === 'active' || status === 'healthy' || status === 'ok') return 'dot-ok';
  if (status === 'degraded') return 'dot-warn';
  if (status === 'error') return 'dot-err';
  if (status === 'idle' && enabled) return 'dot-standby';
  return 'dot-idle';
};

const connectorDisplayName: Record<string, string> = {
  hn: 'Hacker News',
  github_issues: 'GitHub Issues',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  yc_companies: 'YC Companies',
  reddit: 'Reddit',
  producthunt: 'Product Hunt',
  appstore_trending: 'App Store',
  indiehackers: 'IndieHackers',
  exa_byo: 'Exa',
  perigon_byo: 'Perigon',
  twitter_byo: 'Twitter/X',
};

/** Maps connector config name to the source key stored in signal_memory */
const connectorSourceKey: Record<string, string> = {
  hn: 'hacker_news',
};

const providerDisplayName: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** Server-side refresh interval — all connectors run together every 5 min */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const formatCountdown = (ms: number): string => {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const useRefreshCountdown = (connectors: ConnectorRecord[]): string | null => {
  const [now, setNow] = useState(Date.now());

  const lastRunIso = connectors.find((c) => c.status === 'active' && c.last_run)?.last_run ?? null;

  useEffect(() => {
    if (!lastRunIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastRunIso]);

  if (!lastRunIso) return null;

  const nextRefreshAt = new Date(lastRunIso).getTime() + REFRESH_INTERVAL_MS;
  const remaining = nextRefreshAt - now;

  if (remaining <= 0) return 'now';
  return formatCountdown(remaining);
};

export const Sidebar: React.FC<SidebarProps> = ({
  connectors, aiHealth, agentStatus, infraStatus, theses,
  thesisFilter, onThesisFilter, signalCount, latestSignalAt, signalCounts,
  onRunAgent, agentRunning, agentRunResult,
}) => {
  const activeConnectors = connectors.filter((c) => c.status === 'active').length;
  const enabledProviders = aiHealth?.providers?.filter((p) => p.enabled) ?? [];
  const countdown = useRefreshCountdown(connectors);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">Sixth Sense</span>
        <span className="sidebar-subtitle">Idea Engine</span>
      </div>

      <div className="sidebar-stats">
        <div className="sidebar-stat">
          <span className="sidebar-stat-value">{signalCount}</span>
          <span className="sidebar-stat-label">signals</span>
        </div>
        <div className="sidebar-stat">
          <span className="sidebar-stat-value">{activeConnectors}</span>
          <span className="sidebar-stat-label">active</span>
        </div>
        <div className="sidebar-stat">
          <span className="sidebar-stat-value">
            {latestSignalAt ? new Date(latestSignalAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
          </span>
          <span className="sidebar-stat-label">last update</span>
        </div>
      </div>

      <nav className="sidebar-section">
        <h3 className="sidebar-label">Infrastructure</h3>
        <div className="sidebar-row">
          <span className={`status-dot ${dotClass(infraStatus?.postgres ?? 'idle')}`} />
          <span className="sidebar-row-name">Postgres</span>
        </div>
        <div className="sidebar-row">
          <span className={`status-dot ${dotClass(infraStatus?.ollama ?? 'idle')}`} />
          <span className="sidebar-row-name">Ollama</span>
        </div>
        <div className="sidebar-row">
          <span className={`status-dot ${infraStatus && infraStatus.embeddings.withEmbedding > 0 ? 'dot-ok' : 'dot-warn'}`} />
          <span className="sidebar-row-name">Embeddings</span>
          {infraStatus && (
            <span className="sidebar-row-detail detail-count">
              {infraStatus.embeddings.withEmbedding}/{infraStatus.embeddings.total}
            </span>
          )}
        </div>
      </nav>

      <nav className="sidebar-section">
        <div className="sidebar-label-row">
          <h3 className="sidebar-label">Connectors</h3>
          {countdown && (
            <span className={`sidebar-countdown ${countdown === 'now' ? 'refreshing' : ''}`}>
              {countdown === 'now' ? 'refreshing\u2026' : countdown}
            </span>
          )}
        </div>
        {connectors.map((c) => {
          const sourceKey = connectorSourceKey[c.name] ?? c.name;
          const count = signalCounts[sourceKey];
          return (
            <div key={c.name} className="sidebar-row">
              <span className={`status-dot ${dotClass(c.status)}`} />
              <span className="sidebar-row-name">{connectorDisplayName[c.name] ?? c.name}</span>
              {count != null && count > 0 && (
                <span className="sidebar-row-detail detail-count">{count}</span>
              )}
            </div>
          );
        })}
        {connectors.length === 0 && <p className="sidebar-empty">No connectors</p>}
      </nav>

      <nav className="sidebar-section">
        <h3 className="sidebar-label">AI Agents</h3>
        {enabledProviders.map((p) => (
          <div key={p.provider} className="sidebar-row">
            <span className={`status-dot ${dotClass(p.status, p.enabled)}`} />
            <span className="sidebar-row-name">{providerDisplayName[p.provider] ?? p.provider}</span>
            {p.status === 'idle' && p.attempted === 0 ? (
              <span className="sidebar-row-detail detail-standby">standby</span>
            ) : (
              <span className={`sidebar-row-detail ${p.failed > 0 ? 'detail-standby' : 'detail-ok'}`}>
                {p.succeeded}/{p.attempted}
              </span>
            )}
          </div>
        ))}
        {enabledProviders.length === 0 && <p className="sidebar-empty">No providers</p>}
      </nav>

      <nav className="sidebar-section">
        <div className="sidebar-label-row">
          <h3 className="sidebar-label">Research Agent</h3>
          {onRunAgent && (
            <button
              type="button"
              className={`sidebar-run-btn ${agentRunning ? 'running' : ''}`}
              onClick={onRunAgent}
              disabled={agentRunning}
            >
              {agentRunning ? 'Running\u2026' : 'Run'}
            </button>
          )}
        </div>
        {agentRunning && (
          <p className="sidebar-agent-status running">Analyzing signals and updating theses{'\u2026'}</p>
        )}
        {!agentRunning && agentRunResult && (
          <p className={`sidebar-agent-status ${agentRunResult === 'failed' ? 'error' : 'success'}`}>
            {agentRunResult === 'failed' ? 'Run failed' : agentRunResult}
          </p>
        )}
        {agentStatus?.lastRun ? (
          <>
            <div className="sidebar-row">
              <span className="sidebar-row-name">Last run</span>
              <span className="sidebar-row-detail">{new Date(agentStatus.lastRun.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="sidebar-row">
              <span className="sidebar-row-name">Updated</span>
              <span className="sidebar-row-detail detail-count">{agentStatus.lastRun.thesesUpdated}</span>
            </div>
            <div className="sidebar-row">
              <span className="sidebar-row-name">New</span>
              <span className="sidebar-row-detail detail-count">{agentStatus.lastRun.newCandidates}</span>
            </div>
            <div className="sidebar-row">
              <span className="sidebar-row-name">Clusters</span>
              <span className="sidebar-row-detail detail-count">{agentStatus.lastRun.clustersAnalyzed}</span>
            </div>
            <div className="sidebar-row">
              <span className="sidebar-row-name">Deep dives</span>
              <span className="sidebar-row-detail detail-count">{agentStatus.lastRun.deepDivesPerformed}</span>
            </div>
            <div className="sidebar-row">
              <span className="sidebar-row-name">Journal</span>
              <span className="sidebar-row-detail detail-count">{agentStatus.lastRun.journalEntriesWritten}</span>
            </div>
          </>
        ) : (
          !agentRunning && <p className="sidebar-empty">No runs yet</p>
        )}
      </nav>

      {theses.length > 0 && (
        <nav className="sidebar-section">
          <h3 className="sidebar-label">Theses Overview</h3>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Total</span>
            <span className="sidebar-row-detail detail-count">{theses.length}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Promoted</span>
            <span className="sidebar-row-detail detail-count">{theses.filter((t) => t.status === 'promoted').length}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Watching</span>
            <span className="sidebar-row-detail detail-count">{theses.filter((t) => t.status === 'watching').length}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Evidence</span>
            <span className="sidebar-row-detail detail-count">{theses.reduce((sum, t) => sum + (t.evidenceCount || 0), 0)}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Sources</span>
            <span className="sidebar-row-detail detail-count">{theses.reduce((sum, t) => sum + (t.sourceCount || 0), 0)}</span>
          </div>
        </nav>
      )}
    </aside>
  );
};
