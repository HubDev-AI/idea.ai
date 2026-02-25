import React, { useState } from 'react';
import type { SignalRecord } from '../api';

type SignalRowProps = {
  signal: SignalRecord;
};

const hasBreakdown = (signal: SignalRecord): boolean =>
  signal.pain != null || signal.timing != null || signal.buildability != null;

const hasExpandedContent = (signal: SignalRecord): boolean =>
  hasBreakdown(signal) || signal.reasoning != null;

export const SignalRow = ({ signal }: SignalRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const expandable = hasExpandedContent(signal);

  return (
    <li className="signal-row">
      <div className="signal-top">
        <h3>{signal.idea}</h3>
        <span className="score">{signal.score}</span>
      </div>
      <p className="meta">
        <strong>{signal.top_source}</strong> - {signal.snippet}
      </p>
      <div className="signal-footer">
        <span className="next-action">{signal.next_action}</span>
        {signal.source_url ? (
          <a className="source-link" href={signal.source_url} target="_blank" rel="noreferrer">
            Open Source
          </a>
        ) : (
          <span className="source-link disabled">No Source Link</span>
        )}
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
                <div className="score-breakdown">
                  {signal.pain != null && (
                    <span className="breakdown-item breakdown-pain">
                      Pain: {signal.pain}
                    </span>
                  )}
                  {signal.timing != null && (
                    <span className="breakdown-item breakdown-timing">
                      Timing: {signal.timing}
                    </span>
                  )}
                  {signal.buildability != null && (
                    <span className="breakdown-item breakdown-buildability">
                      Buildability: {signal.buildability}
                    </span>
                  )}
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
