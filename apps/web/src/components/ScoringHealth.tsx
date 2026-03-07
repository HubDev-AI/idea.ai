import type { ScoringHealthRecord } from '@idea/contracts/src/api';
import React, { useEffect, useState } from 'react';

export const ScoringHealth: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
  const [data, setData] = useState<ScoringHealthRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState('consumer');

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`${apiUrl}/v1/scoring-health?profile=${profile}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<ScoringHealthRecord>;
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [apiUrl, profile]);

  if (error) return <div className="scoring-error">Failed to load scoring health: {error}</div>;
  if (!data) return <div className="scoring-loading">Loading scoring health...</div>;

  const { currentWeights, optimizationHistory, predictionTrackRecord, experienceLibrarySize } = data;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <div className="scoring-container">
      <div className="profile-tabs" style={{ marginBottom: '0.75rem' }}>
        <button
          type="button"
          className={`profile-tab ${profile === 'consumer' ? 'active' : ''}`}
          onClick={() => setProfile('consumer')}
        >
          Consumer
        </button>
        <button
          type="button"
          className={`profile-tab ${profile === 'b2b' ? 'active' : ''}`}
          onClick={() => setProfile('b2b')}
        >
          B2B
        </button>
      </div>
      <div className="scoring-grid">
        {/* Current weights card */}
        <div className="scoring-card">
          <h3>
            Current Weights
            <span className={`scoring-badge ${currentWeights.source}`}>
              {currentWeights.source}
            </span>
          </h3>
          <div className="scoring-stat-row">
            <span>Profile</span>
            <span>{currentWeights.profileId}</span>
          </div>
          <div className="scoring-stat-row">
            <span>Demand</span>
            <span>{pct(currentWeights.demand)}</span>
          </div>
          <div className="scoring-stat-row">
            <span>Timing</span>
            <span>{pct(currentWeights.timing)}</span>
          </div>
          <div className="scoring-stat-row">
            <span>Buildability</span>
            <span>{pct(currentWeights.buildability)}</span>
          </div>
          <div className="scoring-stat-row">
            <span>Virality</span>
            <span>{pct(currentWeights.virality)}</span>
          </div>
        </div>

        {/* Prediction track record card */}
        <div className="scoring-card">
          <h3>Prediction Track Record</h3>
          <div className="scoring-stat-row">
            <span>Total Checked</span>
            <span>{predictionTrackRecord.total}</span>
          </div>
          <div className="scoring-stat-row">
            <span>Validated</span>
            <span>{predictionTrackRecord.validated}</span>
          </div>
          <div className="scoring-stat-row">
            <span>Accuracy</span>
            <span>
              {predictionTrackRecord.accuracy !== null
                ? `${predictionTrackRecord.accuracy}%`
                : '--'}
            </span>
          </div>
        </div>

        {/* Experience library card */}
        <div className="scoring-card">
          <h3>Experience Library</h3>
          <div className="scoring-stat-row">
            <span>Entries</span>
            <span>{experienceLibrarySize}</span>
          </div>
        </div>
      </div>

      {/* Optimization history table */}
      {optimizationHistory.length > 0 && (
        <div className="scoring-card scoring-history-section">
          <h3>Optimization History</h3>
          <table className="scoring-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>D%</th>
                <th>T%</th>
                <th>B%</th>
                <th>V%</th>
                <th>Precision</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {optimizationHistory.map((h) => (
                <tr key={h.computedAt}>
                  <td>{new Date(h.computedAt).toLocaleDateString()}</td>
                  <td>{pct(h.demand)}</td>
                  <td>{pct(h.timing)}</td>
                  <td>{pct(h.buildability)}</td>
                  <td>{pct(h.virality)}</td>
                  <td>{h.precision !== null ? `${(h.precision * 100).toFixed(1)}%` : '--'}</td>
                  <td>{h.sampleSize ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
