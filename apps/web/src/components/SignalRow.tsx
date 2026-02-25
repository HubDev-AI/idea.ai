import React from 'react';
import type { SignalRecord } from '../api';

type SignalRowProps = {
  signal: SignalRecord;
};

export const SignalRow = ({ signal }: SignalRowProps) => (
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
  </li>
);
