import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ThesisDeepDive, ThesisListItem } from '../api';
import { fetchThesisDeepDive, generateThesisDeepDive } from '../api';
import { FormatText } from './FormatText';
import { ThesisExplainTab } from './ThesisExplainTab';

type Props = {
  thesis: ThesisListItem;
  cachedData?: ThesisDeepDive | null;
  onClose: () => void;
};

export const ThesisDeepDiveModal: React.FC<Props> = ({ thesis, cachedData, onClose }) => {
  const [data, setData] = useState<ThesisDeepDive | null>(cachedData ?? null);
  const [loading, setLoading] = useState(!cachedData);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'deep-dive' | 'explain'>('deep-dive');
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cachedData || data) return;

    let cancelled = false;
    (async () => {
      try {
        let result = await fetchThesisDeepDive(thesis.canonicalKey);
        if (!result) {
          result = await generateThesisDeepDive(thesis.canonicalKey);
        }
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate deep-dive');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [thesis.canonicalKey, cachedData, data]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose]
  );

  const buildMarkdown = (): string => {
    const lines = [
      `# ${thesis.title}`,
      '',
      `**Confidence:** ${thesis.confidence}%${thesis.estimatedScope ? ` | **Scope:** ${thesis.estimatedScope}` : ''} | **Evidence:** ${thesis.evidenceCount} | **Sources:** ${thesis.sourceCount}`,
      '',
      `## Problem`,
      thesis.problemStatement,
    ];
    if (data) {
      lines.push('', `## What is this?`, data.summary);
      lines.push('', `## How it works`, data.howItWorks);
      lines.push('', `## Growth strategy`, data.growthStrategy);
      lines.push('', `## Build suggestions`, data.buildSuggestions);
    }
    return lines.join('\n');
  };

  return (
    <div
      className="deep-dive-backdrop"
      ref={backdropRef}
      onClick={handleBackdropClick}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Deep dive: ${thesis.title}`}
    >
      <div className="deep-dive-modal">
        <div className="deep-dive-header">
          <h2 className="deep-dive-title">{thesis.title}</h2>
          <div className="deep-dive-header-actions">
            {data && (
              <button
                className="deep-dive-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(buildMarkdown());
                }}
                type="button"
                title="Copy as Markdown"
              >
                Copy MD
              </button>
            )}
            <button className="deep-dive-close" onClick={onClose} type="button">&times;</button>
          </div>
        </div>

        <div className="deep-dive-tabs">
          <button
            className={`deep-dive-tab${activeTab === 'deep-dive' ? ' active' : ''}`}
            onClick={() => setActiveTab('deep-dive')}
            type="button"
          >
            Deep Dive
          </button>
          <button
            className={`deep-dive-tab${activeTab === 'explain' ? ' active' : ''}`}
            onClick={() => setActiveTab('explain')}
            type="button"
          >
            Why this score?
          </button>
        </div>

        <div className="deep-dive-meta">
          <span className="deep-dive-confidence">
            Confidence: {thesis.confidence}%
          </span>
          {thesis.estimatedScope && (
            <span className="deep-dive-scope">
              Scope: {thesis.estimatedScope}
            </span>
          )}
          <span className="deep-dive-evidence">
            {thesis.evidenceCount} evidence &middot; {thesis.sourceCount} sources
          </span>
        </div>

        {activeTab === 'deep-dive' && (
          <>
            {loading && (
              <div className="deep-dive-loading">
                <div className="deep-dive-skeleton" />
                <div className="deep-dive-skeleton short" />
                <div className="deep-dive-skeleton" />
                <div className="deep-dive-skeleton short" />
                <p className="deep-dive-loading-text">Generating insights...</p>
              </div>
            )}

            {error && (
              <div className="deep-dive-error">
                <p>{error}</p>
                <button onClick={onClose} type="button">Close</button>
              </div>
            )}

            {data && (
              <div className="deep-dive-content">
                <section className="deep-dive-section">
                  <h3>What is this?</h3>
                  <FormatText text={data.summary} />
                </section>
                <section className="deep-dive-section">
                  <h3>How it works</h3>
                  <FormatText text={data.howItWorks} />
                </section>
                <section className="deep-dive-section">
                  <h3>Growth strategy</h3>
                  <FormatText text={data.growthStrategy} />
                </section>
                <section className="deep-dive-section">
                  <h3>Build suggestions</h3>
                  <FormatText text={data.buildSuggestions} />
                </section>
                {data.generatedBy && (
                  <p className="deep-dive-provider">
                    Generated by {data.generatedBy}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'explain' && (
          <ThesisExplainTab canonicalKey={thesis.canonicalKey} />
        )}
      </div>
    </div>
  );
};
