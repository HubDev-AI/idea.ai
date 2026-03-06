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
    label?: 'favourite' | 'later' | 'dismissed' | null;
    posteriorConfidence?: number;
    velocity?: number;
    corroborationScore?: number;
  };
  profileDisplay?: { badge: string; badgeColor: string } | null;
  isActive?: boolean;
  isGenerating?: boolean;
  onClick?: () => void;
  onExplore?: () => void;
  onView?: () => void;
  onLabelChange?: (label: 'favourite' | 'later' | 'dismissed' | null) => void;
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

const velocityLabel = (v: number | undefined): { text: string; color: string } | null => {
  if (v == null || v === 0) return null;
  if (v >= 3) return { text: `\u2191${v.toFixed(1)}x`, color: 'var(--ok)' };
  if (v >= 1.5) return { text: `\u2197${v.toFixed(1)}x`, color: 'var(--warn)' };
  if (v > 0) return { text: `\u2192${v.toFixed(1)}x`, color: 'var(--muted)' };
  return null;
};

const corroborationDots = (score: number | undefined): { filled: number; total: number } => {
  if (score == null) return { filled: 0, total: 5 };
  const filled = Math.min(5, Math.max(0, Math.round(score * 5)));
  return { filled, total: 5 };
};

export const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, profileDisplay, isActive, isGenerating, onClick, onExplore, onView, onLabelChange }) => {
  const statusClass = thesis.status === 'promoted' ? 'promoted' : thesis.status === 'watching' ? 'watching' : '';
  const hasData = thesis.hasDeepDive === true;
  const displayConfidence = thesis.posteriorConfidence ?? thesis.confidence;

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
    <article
      className={`thesis-card ${statusClass} ${isActive ? 'thesis-active' : ''} ${thesis.label === 'dismissed' ? 'thesis-dismissed' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(); } }}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="thesis-header">
        <h3 className="thesis-title">{thesis.title}</h3>
        <div className="thesis-header-right">
          {profileDisplay && (
            <span
              className="thesis-profile-badge"
              style={{ background: profileDisplay.badgeColor }}
            >
              {profileDisplay.badge}
            </span>
          )}
          {thesis.estimatedScope && scopeLabel[thesis.estimatedScope] && (
            <span
              className="thesis-scope-badge"
              style={{ borderColor: scopeLabel[thesis.estimatedScope].color, color: scopeLabel[thesis.estimatedScope].color }}
              title={`${thesis.estimatedScope} app`}
            >
              {scopeLabel[thesis.estimatedScope].text}
            </span>
          )}
          <span className="thesis-confidence" style={{ color: confidenceColor(displayConfidence) }}>
            {displayConfidence}%
          </span>
        </div>
      </div>
      <div className="thesis-confidence-bar">
        <div
          className="thesis-confidence-fill"
          style={{ width: `${Math.min(displayConfidence, 100)}%`, background: confidenceColor(displayConfidence) }}
        />
      </div>
      <p className="thesis-problem">{thesis.problemStatement}</p>
      <div className="thesis-meta">
        <span className={`thesis-status ${statusClass}`}>{thesis.status}</span>
        <span>{thesis.evidenceCount} evidence</span>
        <span>{thesis.sourceCount} sources</span>
        {(() => {
          const vel = velocityLabel(thesis.velocity);
          return vel ? (
            <span className="thesis-velocity" style={{ color: vel.color }} title={`Velocity: ${thesis.velocity?.toFixed(1)}x`}>
              {vel.text}
            </span>
          ) : null;
        })()}
        {(() => {
          const dots = corroborationDots(thesis.corroborationScore);
          return dots.filled > 0 ? (
            <span className="thesis-corroboration" title={`Corroboration: ${((thesis.corroborationScore ?? 0) * 100).toFixed(0)}% cross-source`}>
              {Array.from({ length: dots.total }, (_, i) => (
                <span key={i} className={i < dots.filled ? 'dot filled' : 'dot'}>{'\u25CF'}</span>
              ))}
            </span>
          ) : null;
        })()}
        {thesis.lastSeenAt && <span>{relativeTime(thesis.lastSeenAt)}</span>}
        {onLabelChange && (
          <span className="thesis-label-btns">
            <button
              type="button"
              className={`thesis-label-btn ${thesis.label === 'favourite' ? 'active favourite' : ''}`}
              title="Favourite"
              onClick={(e) => { e.stopPropagation(); onLabelChange(thesis.label === 'favourite' ? null : 'favourite'); }}
            >
              {thesis.label === 'favourite' ? '\u2605' : '\u2606'}
            </button>
            <button
              type="button"
              className={`thesis-label-btn ${thesis.label === 'later' ? 'active later' : ''}`}
              title="Later"
              onClick={(e) => { e.stopPropagation(); onLabelChange(thesis.label === 'later' ? null : 'later'); }}
            >
              {'\u23F0'}
            </button>
            <button
              type="button"
              className={`thesis-label-btn ${thesis.label === 'dismissed' ? 'active dismissed' : ''}`}
              title="Dismiss"
              onClick={(e) => { e.stopPropagation(); onLabelChange(thesis.label === 'dismissed' ? null : 'dismissed'); }}
            >
              {'\u2715'}
            </button>
          </span>
        )}
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
    </article>
  );
};
