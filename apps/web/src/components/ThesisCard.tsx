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
  isActive?: boolean;
  onClick?: () => void;
};

const confidenceColor = (confidence: number): string => {
  if (confidence >= 70) return 'var(--ok)';
  if (confidence >= 40) return 'var(--warn)';
  return 'var(--muted)';
};

export const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, isActive, onClick }) => {
  const statusClass = thesis.status === 'promoted' ? 'promoted' : thesis.status === 'watching' ? 'watching' : '';

  return (
    <div
      className={`thesis-card ${statusClass} ${isActive ? 'thesis-active' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="thesis-header">
        <h3 className="thesis-title">{thesis.title}</h3>
        <span className="thesis-confidence" style={{ color: confidenceColor(thesis.confidence) }}>
          {thesis.confidence}%
        </span>
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
        <span>{thesis.evidenceCount} evidence</span>
        <span>{thesis.sourceCount} sources</span>
      </div>
    </div>
  );
};
