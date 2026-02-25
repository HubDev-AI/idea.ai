import React from 'react';
import type { AiHealthRecord } from '../api';

type AiHealthPanelProps = {
  aiHealth: AiHealthRecord | null;
};

const statusLabel = (status: AiHealthRecord['providers'][number]['status']): string => {
  if (status === 'healthy') {
    return 'ok';
  }

  if (status === 'degraded') {
    return 'partial';
  }

  if (status === 'error') {
    return 'failed';
  }

  if (status === 'disabled') {
    return 'disabled';
  }

  return 'idle';
};

export const AiHealthPanel = ({ aiHealth }: AiHealthPanelProps) => {
  const providers = (aiHealth?.providers ?? []).filter((provider) => provider.enabled || provider.attempted > 0);

  return (
    <section className="ai-health-card">
      <div className="signal-header">
        <h2>AI Agents</h2>
        <span className="ai-meta">{aiHealth?.run_id ? `run ${aiHealth.run_id.slice(0, 12)}` : 'no runs yet'}</span>
      </div>
      <ul className="ai-health-list">
        {providers.map((provider) => (
          <li key={provider.provider} className="ai-health-row">
            <span className="ai-health-name">
              <span className={`status-dot ${provider.status}`} aria-hidden="true" />
              {provider.provider}
            </span>
            <span className="ai-health-stats">
              {statusLabel(provider.status)} · ok {provider.succeeded} · fail {provider.failed} · retry {provider.retries}
            </span>
          </li>
        ))}
      </ul>
      {providers.length === 0 ? <p className="ai-last-error">No AI providers enabled.</p> : null}
      {providers.some((provider) => provider.last_error) ? (
        <p className="ai-last-error">
          last error:{' '}
          {providers
            .filter((provider) => provider.last_error)
            .map((provider) => `${provider.provider}: ${provider.last_error}`)
            .join(' | ')}
        </p>
      ) : null}
    </section>
  );
};
