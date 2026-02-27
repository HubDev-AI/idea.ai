// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
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
  exa_byo: 'Exa',
  perigon_byo: 'Perigon',
};

/** Maps connector config name to the source key stored in signal_memory */
const connectorSourceKey: Record<string, string> = {
  hn: 'hacker_news',
};

const providerDisplayName: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export const Sidebar: React.FC<SidebarProps> = ({
  connectors, aiHealth, agentStatus, infraStatus, theses,
  thesisFilter, onThesisFilter, signalCount, latestSignalAt, signalCounts,
  onRunAgent, agentRunning, agentRunResult,
}) => {
  const activeConnectors = connectors.filter((c) => c.status === 'active').length;
  const enabledProviders = aiHealth?.providers?.filter((p) => p.enabled) ?? [];

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
          <span className={`sidebar-row-detail ${infraStatus?.postgres === 'ok' ? 'detail-ok' : 'detail-standby'}`}>
            {infraStatus?.postgres ?? 'unknown'}
          </span>
        </div>
        <div className="sidebar-row">
          <span className={`status-dot ${dotClass(infraStatus?.ollama ?? 'idle')}`} />
          <span className="sidebar-row-name">Ollama</span>
          <span className={`sidebar-row-detail ${infraStatus?.ollama === 'ok' ? 'detail-ok' : 'detail-standby'}`}>
            {infraStatus?.ollama ?? 'unknown'}
          </span>
        </div>
        <div className="sidebar-row">
          <span className={`status-dot ${infraStatus && infraStatus.embeddings.withEmbedding > 0 ? 'dot-ok' : 'dot-warn'}`} />
          <span className="sidebar-row-name">Embeddings</span>
          <span className="sidebar-row-detail">
            {infraStatus ? `${infraStatus.embeddings.withEmbedding}/${infraStatus.embeddings.total}` : '--'}
          </span>
        </div>
      </nav>

      <nav className="sidebar-section">
        <h3 className="sidebar-label">Connectors</h3>
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
          <p className="sidebar-agent-status running">Analyzing signals and updating theses\u2026</p>
        )}
        {!agentRunning && agentRunResult && (
          <p className={`sidebar-agent-status ${agentRunResult === 'failed' ? 'error' : 'success'}`}>
            {agentRunResult === 'failed' ? 'Run failed' : agentRunResult}
          </p>
        )}
        {agentStatus?.lastRun ? (
          <div className="sidebar-agent-info">
            <span>{new Date(agentStatus.lastRun.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="sidebar-row-detail">{agentStatus.lastRun.thesesUpdated} updated</span>
            <span className="sidebar-row-detail">{agentStatus.lastRun.newCandidates} new</span>
          </div>
        ) : (
          !agentRunning && <p className="sidebar-empty">No runs yet</p>
        )}
        {agentStatus?.lastRun && (
          <div className="sidebar-agent-details">
            <span>{agentStatus.lastRun.clustersAnalyzed} clusters</span>
            <span>{agentStatus.lastRun.deepDivesPerformed} deep dives</span>
            <span>{agentStatus.lastRun.journalEntriesWritten} journal</span>
          </div>
        )}
      </nav>

      {theses.length > 0 && (
        <nav className="sidebar-section">
          <h3 className="sidebar-label">Theses Overview</h3>
          <div className="sidebar-thesis-stats">
            <span>{theses.length} total</span>
            <span>{theses.filter((t) => t.status === 'promoted').length} promoted</span>
            <span>{theses.filter((t) => t.status === 'watching').length} watching</span>
          </div>
          <div className="sidebar-thesis-stats">
            <span>{theses.reduce((sum, t) => sum + t.evidenceCount, 0)} evidence</span>
            <span>{theses.reduce((sum, t) => sum + t.sourceCount, 0)} sources</span>
          </div>
        </nav>
      )}
    </aside>
  );
};
