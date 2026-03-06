import React from 'react';
import { relativeTime } from '../relativeTime';

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
    lastSeenAt?: string;
    hasDeepDive?: boolean;
    profileId?: string;
  };
  profileDisplay?: { badge: string; badgeColor: string } | null;
  isActive?: boolean;
  isGenerating?: boolean;
  onClick?: () => void;
  onExplore?: () => void;
  onView?: () => void;
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

export const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, profileDisplay, isActive, isGenerating, onClick, onExplore, onView }) => {
  const statusClass = thesis.status === 'promoted' ? 'promoted' : thesis.status === 'watching' ? 'watching' : '';
  const hasData = thesis.hasDeepDive === true;

  const handleExploreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGenerating) return;
    if (hasData && onView) {
      onView();
    } else if (onExplore) {
      onExplore();
    }
  };

  return (
    <div
      className={`thesis-card ${statusClass} ${isActive ? 'thesis-active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(); } }}
    >
      <div className="thesis-header">
        <h3 className="thesis-title">{thesis.title}</h3>
        {profileDisplay && (
          <span
            className="thesis-profile-badge"
            style={{ background: profileDisplay.badgeColor }}
          >
            {profileDisplay.badge}
          </span>
        )}
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
        {thesis.lastSeenAt && <span>{relativeTime(thesis.lastSeenAt)}</span>}
        {(onExplore || onView) && (
          <button
            type="button"
            className={`thesis-explore-btn ${hasData ? 'has-data' : ''} ${isGenerating ? 'generating' : ''}`}
            onClick={handleExploreClick}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating\u2026' : hasData ? 'View' : 'Explore'}
          </button>
        )}
      </div>
    </div>
  );
};
