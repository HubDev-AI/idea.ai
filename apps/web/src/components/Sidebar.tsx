// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import type { AgentStatusRecord, AiHealthRecord, ConnectorRecord, ThesisListItem } from '../api';

type SidebarProps = {
  connectors: ConnectorRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
  theses: ThesisListItem[];
  thesisFilter: string | null;
  onThesisFilter: (key: string | null, title: string) => void;
  signalCount: number;
  latestSignalAt: string | null;
  signalCounts: Record<string, number>;
};

const dotClass = (status: string, enabled?: boolean): string => {
  if (status === 'active' || status === 'healthy') return 'dot-ok';
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
  connectors, aiHealth, agentStatus, theses,
  thesisFilter, onThesisFilter, signalCount, latestSignalAt, signalCounts,
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
        <h3 className="sidebar-label">Research Agent</h3>
        {agentStatus?.lastRun ? (
          <div className="sidebar-agent-info">
            <span>{new Date(agentStatus.lastRun.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="sidebar-row-detail">{agentStatus.lastRun.thesesUpdated} updated</span>
          </div>
        ) : (
          <p className="sidebar-empty">No runs yet</p>
        )}
      </nav>

      {theses.length > 0 && (
        <nav className="sidebar-section">
          <h3 className="sidebar-label">Theses</h3>
          {theses.slice(0, 5).map((t) => (
            <button
              key={t.canonicalKey}
              type="button"
              className={`sidebar-thesis ${thesisFilter === t.canonicalKey ? 'active' : ''}`}
              onClick={() => {
                if (thesisFilter === t.canonicalKey) {
                  onThesisFilter(null, '');
                } else {
                  onThesisFilter(t.canonicalKey, t.title);
                }
              }}
            >
              <span className="sidebar-thesis-title">{t.title}</span>
              <span className={`sidebar-thesis-conf ${t.status === 'promoted' ? 'promoted' : ''}`}>
                {t.confidence}%
              </span>
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
};
