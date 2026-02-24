// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import App from '../src/App';

const mockSignals = [
  {
    idea: 'SOC2 prep copilot',
    score: 82,
    top_source: 'hacker_news',
    snippet: 'Founders report repeated compliance blockers',
    next_action: 'validate_demand',
    updated_at: '2026-02-24T00:00:00.000Z'
  }
];

const mockConnectors = [
  { name: 'hn', status: 'active', last_run: '2026-02-24T01:00:00.000Z' }
];

describe('web app', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders feed rows with idea, score, source/snippet, and next action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith('/v1/signals')) {
          return Promise.resolve(new Response(JSON.stringify(mockSignals), { status: 200 }));
        }

        return Promise.resolve(new Response(JSON.stringify(mockConnectors), { status: 200 }));
      })
    );

    render(<App />);

    expect(await screen.findByText('SOC2 prep copilot')).toBeDefined();
    expect(screen.getByText('82')).toBeDefined();
    expect(screen.getByText(/hacker_news/i)).toBeDefined();
    expect(screen.getByText(/compliance blockers/i)).toBeDefined();
    expect(screen.getByText('validate_demand')).toBeDefined();
  });
});
