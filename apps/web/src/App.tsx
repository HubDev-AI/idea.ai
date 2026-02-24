import React, { useEffect, useState } from 'react';
import { ConnectorStatus } from './components/ConnectorStatus';
import { SignalRow } from './components/SignalRow';
import { fetchConnectors, fetchSignals, type ConnectorRecord, type SignalRecord } from './api';

const App = () => {
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);

  useEffect(() => {
    const load = async () => {
      const [signalData, connectorData] = await Promise.all([fetchSignals(), fetchConnectors()]);
      setSignals(signalData);
      setConnectors(connectorData);
    };

    void load();
  }, []);

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <p className="eyebrow">Sixth Sense Idea Engine</p>
          <h1>Ranked Signal Feed</h1>
        </div>
        <p className="refresh">Refresh cadence: hourly + daily</p>
      </header>

      <ConnectorStatus connectors={connectors} />

      <section className="signal-card">
        <h2>Opportunity Signals</h2>
        <ul className="signal-list">
          {signals.map((signal) => (
            <SignalRow key={`${signal.idea}-${signal.updated_at}`} signal={signal} />
          ))}
        </ul>
      </section>
    </main>
  );
};

export default App;
