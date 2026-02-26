import React from 'react';
import type { ConnectorRecord, AiHealthRecord, AgentStatusRecord } from '../api';

type StatusCardsProps = {
  connectors: ConnectorRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
};

const statusDot = (status: string): string => {
  if (status === 'active' || status === 'healthy') return 'dot-ok';
  if (status === 'degraded' || status === 'error') return 'dot-err';
  return 'dot-idle';
};

export const StatusCards: React.FC<StatusCardsProps> = ({ connectors, aiHealth, agentStatus }) => {
  const activeConnectors = connectors.filter((c) => c.status === 'active').length;
  const enabledProviders = aiHealth?.providers?.filter((p) => p.enabled) ?? [];

  return (
    <div className="status-cards">
      <div className="status-card">
        <h4>Connector Health</h4>
        <div className="status-card-body">
          {connectors.map((c) => (
            <div key={c.name} className="status-row">
              <span className={`status-dot ${statusDot(c.status)}`} />
              <span className="status-name">{c.name}</span>
              <span className="status-detail">{c.status}</span>
            </div>
          ))}
          {connectors.length === 0 && <p className="status-empty">No connectors</p>}
        </div>
        <div className="status-card-footer">{activeConnectors}/{connectors.length} active</div>
      </div>

      <div className="status-card">
        <h4>AI Agents</h4>
        <div className="status-card-body">
          {enabledProviders.map((p) => (
            <div key={p.provider} className="status-row">
              <span className={`status-dot ${statusDot(p.status)}`} />
              <span className="status-name">{p.provider}</span>
              <span className="status-detail">
                {p.succeeded}ok {p.failed > 0 ? `${p.failed}err` : ''}
              </span>
            </div>
          ))}
          {enabledProviders.length === 0 && <p className="status-empty">No providers</p>}
        </div>
        {aiHealth?.run_id && (
          <div className="status-card-footer">Run: {aiHealth.run_id.slice(0, 12)}</div>
        )}
      </div>

      <div className="status-card">
        <h4>Research Agent</h4>
        <div className="status-card-body">
          {agentStatus?.lastRun ? (
            <>
              <div className="status-row">
                <span className="status-name">Last run</span>
                <span className="status-detail">
                  {new Date(agentStatus.lastRun.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="status-row">
                <span className="status-name">Results</span>
                <span className="status-detail">
                  {agentStatus.lastRun.thesesUpdated} updated, {agentStatus.lastRun.newCandidates} new
                </span>
              </div>
            </>
          ) : (
            <p className="status-empty">No runs yet</p>
          )}
        </div>
        {agentStatus?.investigateNext && (
          <div className="status-card-footer">Next: {agentStatus.investigateNext}</div>
        )}
      </div>
    </div>
  );
};
