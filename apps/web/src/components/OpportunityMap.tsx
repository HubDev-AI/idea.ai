import React, { useEffect, useState } from 'react';

type OpportunityNode = {
  id: string;
  label: string;
  type: 'market' | 'category' | 'thesis';
  confidence: number;
  velocity: number;
  supply: number;
  demand: number;
  supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
  emerging?: boolean;
  children?: OpportunityNode[];
};

type OpportunityMap = {
  roots: OpportunityNode[];
  generatedAt: string;
};

const velocityColor = (v: number): string => {
  if (v >= 2) return 'var(--ok)';
  if (v >= 1) return 'var(--warn)';
  return 'var(--muted)';
};

const NodeView: React.FC<{ node: OpportunityNode; depth: number }> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="omap-node" style={{ paddingLeft: `${depth * 20}px` }}>
      <div
        className={`omap-row omap-type-${node.type}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        onKeyDown={(e) => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {hasChildren && (
          <span className="omap-toggle">{expanded ? '\u25BC' : '\u25B6'}</span>
        )}
        <span className="omap-label">{node.label}</span>
        <span className="omap-confidence" style={{ color: velocityColor(node.velocity) }}>
          {node.confidence}%
        </span>
        {node.velocity > 0 && (
          <span className="omap-velocity" style={{ color: velocityColor(node.velocity) }}>
            {node.velocity >= 2 ? '\u2191' : node.velocity >= 1 ? '\u2197' : '\u2192'}{node.velocity.toFixed(1)}x
          </span>
        )}
        {node.supplyDemand && node.supplyDemand !== 'competitive' && (
          <span className={`omap-imbalance imbalance-${node.supplyDemand}`}>
            {node.supplyDemand}
          </span>
        )}
        {node.emerging && <span className="omap-emerging">new</span>}
        <span className="omap-demand">{node.demand} signals</span>
      </div>
      {expanded && hasChildren && (
        <div className="omap-children">
          {node.children!.map(child => (
            <NodeView key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const OpportunityMapView: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
  const [map, setMap] = useState<OpportunityMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/v1/opportunity-map`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<OpportunityMap>;
      })
      .then(setMap)
      .catch(err => setError(err.message));
  }, [apiUrl]);

  if (error) return <div className="omap-error">Failed to load opportunity map: {error}</div>;
  if (!map) return <div className="omap-loading">Loading opportunity map...</div>;

  return (
    <div className="omap-container">
      <div className="omap-header">
        <h2>Opportunity Map</h2>
        <span className="omap-updated">{new Date(map.generatedAt).toLocaleString()}</span>
      </div>
      {map.roots.length === 0 ? (
        <p className="omap-empty">No opportunities mapped yet. Run the research agent first.</p>
      ) : (
        map.roots.map(root => <NodeView key={root.id} node={root} depth={0} />)
      )}
    </div>
  );
};
