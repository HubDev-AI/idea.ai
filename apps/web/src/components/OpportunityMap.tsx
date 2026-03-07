import type { OpportunityMapRecord, OpportunityNode } from '@idea/contracts/src/api';
import React, { useEffect, useState } from 'react';

const velocityLabel = (v: number): string => {
  if (v >= 2) return '\u2191 accelerating';
  if (v >= 1) return '\u2197 growing';
  return '';
};

const supplyDemandLabel: Record<string, string> = {
  opportunity: 'opportunity',
  niche: 'niche',
  saturated: 'saturated',
  competitive: 'competitive',
};

const statusLabel: Record<string, string> = {
  promoted: 'promoted',
  watching: 'watching',
  candidate: 'candidate',
  stale: 'stale',
};

type Props = {
  apiUrl: string;
  onViewThesis?: (canonicalKey: string, title: string) => void;
};

export const OpportunityMapView: React.FC<Props> = ({ apiUrl, onViewThesis }) => {
  const [map, setMap] = useState<OpportunityMapRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/v1/opportunity-map`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<OpportunityMapRecord>;
      })
      .then(setMap)
      .catch(err => setError(err.message));
  }, [apiUrl]);

  if (error) return <div className="omap-error">Failed to load opportunity map: {error}</div>;
  if (!map) return <div className="omap-loading">Loading opportunity map...</div>;

  if (map.roots.length === 0) {
    return <p className="omap-empty">No opportunities mapped yet. Run the research agent first.</p>;
  }

  return (
    <div className="omap-container">
      <table className="omap-table">
        <colgroup>
          <col className="omap-col-idea" />
          <col className="omap-col-status" />
          <col className="omap-col-conf" />
          <col className="omap-col-vel" />
          <col className="omap-col-signals" />
          <col className="omap-col-market" />
        </colgroup>
        <thead>
          <tr>
            <th>Idea</th>
            <th>Status</th>
            <th className="omap-td-num">Confidence</th>
            <th className="omap-td-num">Velocity</th>
            <th className="omap-td-num">Signals</th>
            <th>Market</th>
          </tr>
        </thead>
        <tbody>
          {map.roots.flatMap(root => root.children ?? []).map((node: OpportunityNode) => (
            <tr
              key={node.id}
              className={`omap-idea-row ${onViewThesis ? 'clickable' : ''}`}
              onClick={() => onViewThesis?.(node.id, node.label)}
            >
              <td className="omap-td-title">
                <span className="omap-idea-name">{node.label}</span>
                {node.problemStatement && (
                  <span className="omap-idea-problem">{node.problemStatement}</span>
                )}
              </td>
              <td>
                {node.status && (
                  <span className={`omap-status omap-status-${node.status}`}>
                    {statusLabel[node.status] ?? node.status}
                  </span>
                )}
              </td>
              <td className="omap-td-num">{node.confidence}%</td>
              <td className="omap-td-num">
                {node.velocity > 0 && (
                  <span className={`omap-vel ${node.velocity >= 2 ? 'fast' : 'moderate'}`}>
                    {velocityLabel(node.velocity)}
                  </span>
                )}
              </td>
              <td className="omap-td-num">{node.demand}</td>
              <td>
                {node.supplyDemand && node.supplyDemand !== 'competitive' && (
                  <span className={`omap-market omap-market-${node.supplyDemand}`}>
                    {supplyDemandLabel[node.supplyDemand] ?? node.supplyDemand}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
