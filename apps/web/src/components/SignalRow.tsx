// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React, { useState } from 'react';
import type { SignalRecord } from '../api';

type SignalRowProps = {
  signal: SignalRecord;
};

const hasBreakdown = (signal: SignalRecord): boolean =>
  signal.pain != null || signal.timing != null || signal.buildability != null;

const hasExpandedContent = (signal: SignalRecord): boolean =>
  hasBreakdown(signal) || signal.reasoning != null;

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const ScoreBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className="score-bar-group">
    <span className="score-bar-label">{label}</span>
    <div className="score-bar-track">
      <div className="score-bar-fill" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
    </div>
    <span className="score-bar-value">{value}</span>
  </div>
);

export const SignalRow = ({ signal }: SignalRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const expandable = hasExpandedContent(signal);

  return (
    <li className="signal-row">
      <div className="signal-top">
        {signal.source_url ? (
          <a className="signal-idea signal-idea-link" href={signal.source_url} target="_blank" rel="noreferrer">
            {signal.idea.split('|')[0].trim()}
          </a>
        ) : (
          <h3 className="signal-idea">{signal.idea.split('|')[0].trim()}</h3>
        )}
        <span className="score">{signal.score}</span>
      </div>
      <p className="meta">
        <span className="source-badge">{signal.top_source}</span>
        {signal.snippet}
      </p>
      <div className="signal-footer">
        <div className="signal-footer-left">
          <span className="next-action">{signal.next_action}</span>
          <span className="signal-time">{relativeTime(signal.updated_at)}</span>
        </div>
        {signal.source_url ? (
          <a className="source-link" href={signal.source_url} target="_blank" rel="noreferrer">
            Source
          </a>
        ) : null}
      </div>

      {expandable && (
        <>
          <button
            type="button"
            className="signal-expand-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>

          {expanded && (
            <div className="signal-details">
              {hasBreakdown(signal) && (
                <div className="score-breakdown-bars">
                  {signal.pain != null && <ScoreBar label="Pain" value={signal.pain} color="var(--err)" />}
                  {signal.timing != null && <ScoreBar label="Timing" value={signal.timing} color="var(--warn)" />}
                  {signal.buildability != null && <ScoreBar label="Build" value={signal.buildability} color="var(--ok)" />}
                </div>
              )}
              {signal.reasoning != null && (
                <p className="signal-reasoning">{signal.reasoning}</p>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
};
