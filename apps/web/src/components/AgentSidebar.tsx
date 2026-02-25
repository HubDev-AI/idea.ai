import React from 'react';

export type AgentRunSummary = {
  timestamp: string;
  thesesUpdated: number;
  newCandidates: number;
};

export type AgentSidebarProps = {
  lastRun: AgentRunSummary | null;
  investigateNext: string | null;
};

export const AgentSidebar: React.FC<AgentSidebarProps> = ({ lastRun, investigateNext }) => {
  return (
    <aside className="agent-sidebar">
      <h3>Research Agent</h3>
      {lastRun ? (
        <div className="agent-run-info">
          <p className="agent-last-run">
            Last run: {new Date(lastRun.timestamp).toLocaleString()}
          </p>
          <p className="agent-stats">
            {lastRun.thesesUpdated} theses updated, {lastRun.newCandidates} new candidates
          </p>
        </div>
      ) : (
        <p className="agent-pending">No runs yet</p>
      )}
      {investigateNext ? (
        <div className="agent-next">
          <span className="agent-next-label">Next target:</span>
          <span className="agent-next-topic">{investigateNext}</span>
        </div>
      ) : null}
    </aside>
  );
};
