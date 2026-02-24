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
          <span>{connector.name}</span>
          <span>{connector.status}</span>
          <span>{connector.last_run ?? 'never'}</span>
        </li>
      ))}
    </ul>
  </section>
);
