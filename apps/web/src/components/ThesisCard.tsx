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
    estimatedScope?: 'small' | 'medium' | 'large' | null;
  };
  isActive?: boolean;
  onClick?: () => void;
};

const confidenceColor = (confidence: number): string => {
  if (confidence >= 70) return 'var(--ok)';
  if (confidence >= 40) return 'var(--warn)';
  return 'var(--muted)';
};

const scopeLabel: Record<string, { text: string; color: string }> = {
  small: { text: 'S', color: 'var(--ok)' },
  medium: { text: 'M', color: 'var(--warn)' },
  large: { text: 'L', color: 'var(--err)' }
};

export const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, isActive, onClick }) => {
  const statusClass = thesis.status === 'promoted' ? 'promoted' : thesis.status === 'watching' ? 'watching' : '';

  return (
    <button
      type="button"
      className={`thesis-card ${statusClass} ${isActive ? 'thesis-active' : ''}`}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="thesis-header">
        <h3 className="thesis-title">{thesis.title}</h3>
        <div className="thesis-header-right">
          {thesis.estimatedScope && scopeLabel[thesis.estimatedScope] && (
            <span
              className="thesis-scope-badge"
              style={{ borderColor: scopeLabel[thesis.estimatedScope].color, color: scopeLabel[thesis.estimatedScope].color }}
              title={`${thesis.estimatedScope} app`}
            >
              {scopeLabel[thesis.estimatedScope].text}
            </span>
          )}
          <span className="thesis-confidence" style={{ color: confidenceColor(thesis.confidence) }}>
            {thesis.confidence}%
          </span>
        </div>
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
    </button>
  );
};
