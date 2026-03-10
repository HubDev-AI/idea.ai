// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React, { useState } from 'react';
import type { SignalRecord } from '../api';
import { relativeTime } from '../relativeTime';

const safeHref = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

type SignalRowProps = {
  signal: SignalRecord;
};

const hasBreakdown = (signal: SignalRecord): boolean =>
  signal.demand != null || signal.timing != null || signal.buildability != null || signal.virality != null;

export const SignalRow = ({ signal }: SignalRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const showBreakdown = hasBreakdown(signal);
  const hasReasoning = signal.reasoning != null;

  return (
    <li className="signal-row">
      <div className="signal-top">
        {safeHref(signal.source_url) ? (
          <a className="signal-idea signal-idea-link" href={safeHref(signal.source_url)!} target="_blank" rel="noreferrer">
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
          {showBreakdown && (
            <>
              {signal.demand != null && <span className="breakdown-chip">Demand <strong>{signal.demand}</strong></span>}
              {signal.timing != null && <span className="breakdown-chip">Timing <strong>{signal.timing}</strong></span>}
              {signal.buildability != null && <span className="breakdown-chip">Build <strong>{signal.buildability}</strong></span>}
              {signal.virality != null && <span className="breakdown-chip">Viral <strong>{signal.virality}</strong></span>}
            </>
          )}
          <span className="signal-time">{relativeTime(signal.updated_at)}</span>
        </div>
        {safeHref(signal.source_url) ? (
          <a className="source-link" href={safeHref(signal.source_url)!} target="_blank" rel="noreferrer">
            Source
          </a>
        ) : null}
      </div>

      {hasReasoning && (
        <>
          <button
            type="button"
            className="signal-expand-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide reasoning' : 'Show reasoning'}
          </button>

          {expanded && (
            <div className="signal-details">
              <p className="signal-reasoning">{signal.reasoning}</p>
            </div>
          )}
        </>
      )}
    </li>
  );
};
