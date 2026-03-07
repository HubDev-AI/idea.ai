import React, { useEffect, useState } from 'react';
import type { ThesisExplainRecord } from '../api';
import { fetchThesisExplain } from '../api';

type Props = {
  canonicalKey: string;
};

const DimensionBar: React.FC<{
  label: string;
  score: number;
  weight: number;
  contribution: number;
}> = ({ label, score, weight, contribution }) => (
  <div className="explain-bar-row">
    <span className="explain-bar-label">{label}</span>
    <div className="explain-bar-track">
      <div
        className="explain-bar-fill"
        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
      />
    </div>
    <span className="explain-bar-value">
      {score.toFixed(0)} x {weight.toFixed(2)} = {contribution.toFixed(1)}
    </span>
  </div>
);

export const ThesisExplainTab: React.FC<Props> = ({ canonicalKey }) => {
  const [data, setData] = useState<ThesisExplainRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchThesisExplain(canonicalKey)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load explanation');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [canonicalKey]);

  if (loading) {
    return (
      <div className="deep-dive-loading">
        <div className="deep-dive-skeleton" />
        <div className="deep-dive-skeleton short" />
        <div className="deep-dive-skeleton" />
        <p className="deep-dive-loading-text">Loading score breakdown...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="deep-dive-error">
        <p>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { weightBreakdown: wb, debate, bayesianTrail: trail, topEvidence } = data;

  return (
    <div className="explain-content">
      {/* Weight Breakdown */}
      <section className="explain-section">
        <h3>Score Breakdown</h3>
        <div className="explain-bars">
          <DimensionBar label="Demand" score={wb.demand.score} weight={wb.demand.weight} contribution={wb.demand.contribution} />
          <DimensionBar label="Timing" score={wb.timing.score} weight={wb.timing.weight} contribution={wb.timing.contribution} />
          <DimensionBar label="Buildability" score={wb.buildability.score} weight={wb.buildability.weight} contribution={wb.buildability.contribution} />
          <DimensionBar label="Virality" score={wb.virality.score} weight={wb.virality.weight} contribution={wb.virality.contribution} />
        </div>
        <div className="explain-blended">
          <span>Blended Score</span>
          <strong>{wb.blended.toFixed(1)}</strong>
          {wb.weightsSource === 'optimized' && (
            <span className="explain-weights-badge">optimized</span>
          )}
        </div>
      </section>

      {/* Debate Summary */}
      {debate && (
        <section className="explain-section">
          <h3>Debate Summary</h3>
          <div className="explain-debate">
            <div className="explain-debate-case bull">
              <span className="explain-debate-label">Bull Case</span>
              <p>{debate.bullCase}</p>
              <span className="explain-debate-strength">Strength: {debate.bullStrength}/100</span>
            </div>
            <div className="explain-debate-case bear">
              <span className="explain-debate-label">Bear Case</span>
              <p>{debate.bearCase}</p>
              <span className="explain-debate-strength">Strength: {debate.bearStrength}/100</span>
            </div>
          </div>
          <div className="explain-verdict">
            <span className={`explain-verdict-badge ${debate.verdict.replace(/_/g, '-')}`}>
              {debate.verdict.replace(/_/g, ' ')}
            </span>
            <span className="explain-verdict-conf">
              Confidence: {(debate.confidence * 100).toFixed(0)}%
            </span>
          </div>
          {debate.missingEvidence.length > 0 && (
            <div className="explain-missing">
              <span className="explain-missing-label">Missing evidence:</span>
              {debate.missingEvidence.map((item, i) => (
                <span key={i} className="explain-missing-item">{item}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Bayesian Confidence Trail */}
      <section className="explain-section">
        <h3>Confidence Trail</h3>
        <div className="explain-trail">
          <div className="explain-trail-summary">
            <span>Prior: {trail.prior.toFixed(1)}</span>
            <span className="explain-trail-arrow">-&gt;</span>
            <span>Posterior: {trail.posterior.toFixed(1)}</span>
          </div>
          {trail.updates.length > 0 && (
            <div className="explain-trail-updates">
              {trail.updates.map((u, i) => (
                <div
                  key={i}
                  className={`explain-trail-update ${u.delta >= 0 ? 'positive' : 'negative'}`}
                >
                  <span className="explain-trail-source">{u.source}</span>
                  <span className="explain-trail-delta">
                    {u.delta >= 0 ? '+' : ''}{u.delta.toFixed(1)}
                  </span>
                  <span className="explain-trail-date">
                    {new Date(u.at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
          {trail.updates.length === 0 && (
            <p className="explain-trail-empty">No Bayesian updates yet.</p>
          )}
        </div>
      </section>

      {/* Top Evidence */}
      {topEvidence.length > 0 && (
        <section className="explain-section">
          <h3>Top Evidence</h3>
          <div className="explain-evidence">
            {topEvidence.map((ev, i) => (
              <div key={i} className="explain-evidence-item">
                <span className="explain-evidence-score">{ev.score.toFixed(2)}</span>
                <div className="explain-evidence-body">
                  <p className="explain-evidence-text">{ev.text}</p>
                  <span className="explain-evidence-source">{ev.source}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
