import React, { useEffect, useState } from 'react';
import type { EntityInsights, EntityRecord } from '@idea/contracts/src/api';
import { apiFetch } from '../api';

const ENTITY_TYPES = ['pain_point', 'technology', 'market', 'competitor', 'trend'] as const;

const TYPE_LABELS: Record<string, string> = {
  pain_point: 'Pain Point',
  technology: 'Technology',
  market: 'Market',
  competitor: 'Competitor',
  trend: 'Trend',
};

export const ConnectionsView: React.FC = () => {
  const [insights, setInsights] = useState<EntityInsights | null>(null);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      apiFetch('/v1/entities/insights').then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<EntityInsights>;
      }),
      apiFetch('/v1/entities?limit=50').then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<EntityRecord[]>;
      }),
    ])
      .then(([insightsData, entitiesData]) => {
        if (cancelled) return;
        setInsights(insightsData);
        setEntities(entitiesData);
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="conn-loading">Loading knowledge graph...</div>;
  if (error) return <div className="conn-error">Failed to load knowledge graph: {error}</div>;
  if (!insights) return <div className="conn-empty">No entity data available.</div>;

  const filtered = typeFilter === 'all'
    ? entities
    : entities.filter(e => e.entityType === typeFilter);

  return (
    <div className="conn-container">
      {/* Stats bar */}
      <div className="conn-stats">
        <span>{insights.totalEntities} entities</span>
        <span>{insights.totalRelations} relations</span>
      </div>

      {/* Unaddressed Pain Points */}
      {insights.unaddressedPains.length > 0 && (
        <div className="conn-section">
          <h4>Unaddressed Pain Points</h4>
          <ul className="conn-insight-list">
            {insights.unaddressedPains.map(p => (
              <li key={p.name} className="conn-insight-item pain">
                <strong>{p.name}</strong>
                <span className="conn-mention-count">{p.mentionCount} mentions</span>
                {p.description && <p className="conn-insight-desc">{p.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Emerging Technologies */}
      {insights.emergingTech.length > 0 && (
        <div className="conn-section">
          <h4>Emerging Technologies</h4>
          <ul className="conn-insight-list">
            {insights.emergingTech.map(t => (
              <li key={t.name} className="conn-insight-item tech">
                <strong>{t.name}</strong>
                <span className="conn-mention-count">{t.mentionCount} mentions</span>
                {t.description && <p className="conn-insight-desc">{t.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* All Entities */}
      <div className="conn-section">
        <h4>All Entities</h4>
        <div className="conn-type-filters">
          <button
            type="button"
            className={`conn-type-btn ${typeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setTypeFilter('all')}
          >
            All
          </button>
          {ENTITY_TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={`conn-type-btn ${typeFilter === t ? 'active' : ''}`}
              onClick={() => setTypeFilter(t)}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="conn-empty">No entities match the current filter.</div>
        )}

        <ul className="conn-entity-list">
          {filtered.map(entity => (
            <li key={entity.id} className="conn-entity-item">
              <button
                type="button"
                className="conn-entity-row"
                onClick={() => setExpandedId(expandedId === entity.id ? null : entity.id)}
              >
                <span className={`conn-entity-type ${entity.entityType}`}>
                  {TYPE_LABELS[entity.entityType] ?? entity.entityType}
                </span>
                <span className="conn-entity-name">{entity.name}</span>
                <span className="conn-entity-meta">
                  {entity.mentionCount} mentions
                  {entity.relations.length > 0 && (
                    <> &middot; {entity.relations.length} relations</>
                  )}
                </span>
              </button>
              {expandedId === entity.id && entity.relations.length > 0 && (
                <ul className="conn-relations">
                  {entity.relations.map((rel, i) => (
                    <li key={`${rel.relationType}-${rel.targetName}-${i}`} className="conn-relation">
                      <span className="conn-rel-type">{rel.relationType}</span>
                      <span className="conn-rel-target">
                        {rel.targetType}:{rel.targetName}
                      </span>
                      <span className="conn-rel-confidence">
                        {(rel.confidence * 100).toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
