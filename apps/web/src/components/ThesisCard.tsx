import React from 'react';

export type ThesisCardProps = {
  thesis: {
    canonicalKey: string;
    title: string;
    confidence: number;
    status: string;
    evidenceCount: number;
    problemStatement: string;
    sourceCount: number;
  };
};

const confidenceColor = (confidence: number): string => {
  if (confidence >= 70) return 'var(--ok)';
  if (confidence >= 40) return 'var(--warn)';
  return 'var(--muted)';
};

export const ThesisCard: React.FC<ThesisCardProps> = ({ thesis }) => {
  const statusClass = thesis.status === 'promoted' ? 'promoted' : thesis.status === 'watching' ? 'watching' : 'candidate';

  return (
    <article className={`thesis-card ${statusClass}`}>
      <div className="thesis-header">
        <h3>{thesis.title}</h3>
        <span className={`thesis-confidence ${statusClass}`}>{thesis.confidence}%</span>
      </div>
      <div className="thesis-confidence-bar">
        <div
          className="thesis-confidence-fill"
          style={{ width: `${Math.min(thesis.confidence, 100)}%`, background: confidenceColor(thesis.confidence) }}
        />
      </div>
      <p className="thesis-problem">{thesis.problemStatement}</p>
      <div className="thesis-meta">
        <span className={`thesis-status ${statusClass}`}>{thesis.status}</span>
        <span className="thesis-evidence">{thesis.evidenceCount} signals</span>
        <span className="thesis-sources">{thesis.sourceCount} sources</span>
      </div>
    </article>
  );
};
