// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import type { ConnectorRecord } from '../api';

type ConnectorStatusProps = {
  connectors: ConnectorRecord[];
};

export const ConnectorStatus = ({ connectors }: ConnectorStatusProps) => (
  <section className="connector-card">
    <h2>Connector Health</h2>
    <ul>
      {connectors.map((connector) => (
        <li key={connector.name} className={`connector ${connector.status}`}>
          <span className="connector-name">
            <span className={`status-dot ${connector.status}`} aria-hidden="true" />
            {connector.name}
          </span>
          <span className="connector-state">{connector.status}</span>
          <span className="connector-run">{connector.last_run ?? 'never'}</span>
        </li>
      ))}
    </ul>
  </section>
);
