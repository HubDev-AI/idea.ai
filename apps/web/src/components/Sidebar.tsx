// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React, { useEffect, useState } from 'react';
import type { AgentStatusRecord, AiHealthRecord, ConnectorRecord, InfraStatusRecord, RefreshMeta, ThesisStats } from '../api';
import { connectorDisplayName, connectorSourceKey } from '../connectorNames';

type SidebarProps = {
  connectors: ConnectorRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
  infraStatus: InfraStatusRecord | null;
  thesisStats: ThesisStats;
  thesisFilter: string | null;
  onThesisFilter: (key: string | null, title: string) => void;
  signalCount: number;
  latestSignalAt: string | null;
  signalCounts: Record<string, number>;
  onRunAgent?: () => void;
  agentRunning?: boolean;
  agentRunResult?: string | null;
  refreshMeta: RefreshMeta | null;
  onForceRefresh?: (cadence?: 'hourly' | 'daily') => void;
};

const dotClass = (status: string, opts?: { enabled?: boolean; lastRun?: string | null }): string => {
  if (status === 'active' && opts?.lastRun === null) return 'dot-pending';
  if (status === 'active' || status === 'healthy' || status === 'ok') return 'dot-ok';
  if (status === 'degraded') return 'dot-warn';
  if (status === 'error') return 'dot-err';
  if (status === 'idle' && opts?.enabled) return 'dot-standby';
  return 'dot-idle';
};

const providerDisplayName: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

const formatCountdown = (ms: number): string => {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec >= 3600) {
    const hrs = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    return `${hrs}h ${min}m`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const useCountdown = (lastRunIso: string | null, intervalMs: number): string | null => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!lastRunIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastRunIso]);

  if (!lastRunIso) return null;

  const nextAt = new Date(lastRunIso).getTime() + intervalMs;
  const remaining = nextAt - now;

  if (remaining <= 0) return 'now';
  return formatCountdown(remaining);
};

const AGENT_INTERVAL_MS = 1 * 60 * 60 * 1000;

export const Sidebar: React.FC<SidebarProps> = ({
  connectors, aiHealth, agentStatus, infraStatus, thesisStats,
  thesisFilter, onThesisFilter, signalCount, latestSignalAt, signalCounts,
  onRunAgent, agentRunning, agentRunResult, refreshMeta, onForceRefresh,
}) => {
  const activeConnectors = connectors.filter((c) => c.status === 'active').length;
  const enabledProviders = aiHealth?.providers?.filter((p) => p.enabled) ?? [];

  const hourlyCountdown = useCountdown(
    refreshMeta?.last_hourly_run ?? null,
    refreshMeta?.hourly_interval_ms ?? 3600000
  );
  const dailyCountdown = useCountdown(
    refreshMeta?.last_daily_run ?? null,
    refreshMeta?.daily_interval_ms ?? 86400000
  );
  const agentCountdown = useCountdown(
    agentStatus?.lastRun?.timestamp ?? null,
    AGENT_INTERVAL_MS
  );

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
        <h3 className="sidebar-label">Connectors</h3>
        {(['hourly', 'daily'] as const).map((cadence) => {
          const group = connectors.filter((c) => c.cadence === cadence);
          if (group.length === 0) return null;
          const countdown = cadence === 'hourly' ? hourlyCountdown : dailyCountdown;
          const isRefreshing = refreshMeta?.refreshing === cadence;
          return (
            <div key={cadence} className="sidebar-cadence-group">
              <div className="sidebar-cadence-header">
                <span className="sidebar-cadence-label">{cadence}</span>
                <span className={`sidebar-countdown ${countdown === 'now' || isRefreshing ? 'refreshing' : ''}`}>
                  {isRefreshing ? 'refreshing\u2026' : countdown === null ? 'pending' : countdown === 'now' ? 'refreshing\u2026' : countdown}
                </span>
                {onForceRefresh && (
                  <button
                    type="button"
                    className="sidebar-fetch-btn"
                    onClick={() => onForceRefresh(cadence)}
                    title={`Force refresh ${cadence} connectors`}
                  >
                    Fetch
                  </button>
                )}
              </div>
              {group.map((c) => {
                const sourceKey = connectorSourceKey[c.name] ?? c.name;
                const count = signalCounts[sourceKey];
                return (
                  <div key={c.name} className="sidebar-row">
                    <span className={`status-dot ${dotClass(c.status, { lastRun: c.last_run })}`} />
                    <span className="sidebar-row-name">{connectorDisplayName[c.name] ?? c.name}</span>
                    {count != null && count > 0 && (
                      <span className="sidebar-row-detail detail-count">{count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {connectors.filter((c) => !c.cadence).map((c) => {
          const sourceKey = connectorSourceKey[c.name] ?? c.name;
          const count = signalCounts[sourceKey];
          return (
            <div key={c.name} className="sidebar-row">
              <span className={`status-dot ${dotClass(c.status, { lastRun: c.last_run })}`} />
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
        {enabledProviders.map((p) => {
          const role = aiHealth?.provider_setting === 'both'
            ? (p.provider === aiHealth.primary_provider ? 'primary' : 'fallback')
            : null;
          return (
            <div key={p.provider} className="sidebar-row">
              <span className={`status-dot ${dotClass(p.status, { enabled: p.enabled })}`} />
              <span className="sidebar-row-name">
                {providerDisplayName[p.provider] ?? p.provider}
                {role && <span className={`sidebar-role-tag ${role}`}>{role}</span>}
              </span>
              {p.status === 'idle' && p.attempted === 0 ? (
                <span className="sidebar-row-detail detail-standby">standby</span>
              ) : (
                <span className={`sidebar-row-detail ${p.failed > 0 ? 'detail-standby' : 'detail-ok'}`}>
                  {p.succeeded}/{p.attempted}
                </span>
              )}
            </div>
          );
        })}
        {enabledProviders.length === 0 && <p className="sidebar-empty">No providers</p>}
      </nav>

      <nav className="sidebar-section">
        <div className="sidebar-label-row">
          <h3 className="sidebar-label">Research Agent</h3>
          <div className="sidebar-agent-controls">
            {!agentRunning && (
              <span className={`sidebar-countdown ${agentCountdown === 'now' ? 'refreshing' : ''}`}>
                {agentCountdown === null ? 'pending' : agentCountdown === 'now' ? 'due' : agentCountdown}
              </span>
            )}
            {onRunAgent && enabledProviders.length > 0 && (
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
              <span className="sidebar-row-name">Provider</span>
              <span className={`sidebar-row-detail ${agentStatus.lastRun.provider ? 'detail-ok' : 'detail-standby'}`}>
                {agentStatus.lastRun.provider ? (providerDisplayName[agentStatus.lastRun.provider] ?? agentStatus.lastRun.provider) : 'n/a'}
              </span>
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

      {thesisStats.total > 0 && (
        <nav className="sidebar-section">
          <h3 className="sidebar-label">Theses Overview</h3>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Total</span>
            <span className="sidebar-row-detail detail-count">{thesisStats.total}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Promoted</span>
            <span className="sidebar-row-detail detail-count">{thesisStats.promoted}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Watching</span>
            <span className="sidebar-row-detail detail-count">{thesisStats.watching}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Evidence</span>
            <span className="sidebar-row-detail detail-count">{thesisStats.totalEvidence}</span>
          </div>
          <div className="sidebar-row">
            <span className="sidebar-row-name">Sources</span>
            <span className="sidebar-row-detail detail-count">{thesisStats.totalSources}</span>
          </div>
        </nav>
      )}
    </aside>
  );
};
