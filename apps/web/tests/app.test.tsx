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
    source_url: 'https://news.ycombinator.com/item?id=123',
    next_action: 'validate_demand',
    updated_at: '2026-02-24T00:00:00.000Z'
  }
];

const mockConnectors = [
  { name: 'hn', status: 'active', last_run: '2026-02-24T01:00:00.000Z' }
];

const mockLogs = [
  {
    ts: '2026-02-24T02:00:00.000Z',
    level: 'warn',
    run_id: 'run-1',
    component: 'ai_judges',
    message: 'ai judge call failed for provider',
    context: {
      provider: 'claude'
    }
  }
];

const mockAiHealth = {
  run_id: 'read_model-run-1',
  refreshed_at: '2026-02-24T02:00:00.000Z',
  provider_setting: 'both',
  judge_mode: 'single',
  fallback_enabled: true,
  retry_budget: 1,
  post_scrape_enabled: true,
  post_scrape_max_signals: 6,
  judge_max_signals: 1,
  providers: [
    {
      provider: 'claude',
      enabled: true,
      status: 'healthy',
      attempted: 2,
      succeeded: 2,
      failed: 0,
      retries: 0,
      last_error: null
    },
    {
      provider: 'codex',
      enabled: true,
      status: 'degraded',
      attempted: 2,
      succeeded: 1,
      failed: 1,
      retries: 1,
      last_error: 'timeout'
    }
  ]
};

const mockTheses = [
  {
    canonicalKey: 'soc2-automation',
    title: 'SOC2 Automation Platform',
    confidence: 78,
    status: 'promoted',
    evidenceCount: 5,
    problemStatement: 'Startups struggle with SOC2 compliance prep',
    sourceCount: 3
  },
  {
    canonicalKey: 'dev-onboarding',
    title: 'Developer Onboarding Tool',
    confidence: 62,
    status: 'watching',
    evidenceCount: 3,
    problemStatement: 'Engineering teams waste weeks onboarding new developers',
    sourceCount: 2
  }
];

const mockAgentStatus = {
  lastRun: {
    timestamp: '2026-02-24T03:00:00.000Z',
    thesesUpdated: 2,
    newCandidates: 1
  },
  investigateNext: 'API security testing tools'
};

const buildMockFetch = (overrides?: { failSignals?: boolean; failTheses?: boolean; failAgent?: boolean }) =>
  vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/v1/signals')) {
      if (overrides?.failSignals) {
        return Promise.resolve(new Response('upstream failure', { status: 503 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: mockSignals,
            page: 1,
            page_size: 8,
            total_items: 1,
            total_pages: 1,
            has_next: false,
            has_prev: false
          }),
          { status: 200 }
        )
      );
    }

    if (url.includes('/v1/ai-health')) {
      return Promise.resolve(new Response(JSON.stringify(mockAiHealth), { status: 200 }));
    }

    if (url.includes('/v1/logs')) {
      return Promise.resolve(new Response(JSON.stringify(mockLogs), { status: 200 }));
    }

    if (url.includes('/v1/theses')) {
      if (overrides?.failTheses) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockTheses), { status: 200 }));
    }

    if (url.includes('/v1/agent/status')) {
      if (overrides?.failAgent) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockAgentStatus), { status: 200 }));
    }

    // Default: connectors
    return Promise.resolve(new Response(JSON.stringify(mockConnectors), { status: 200 }));
  });

describe('web app', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders feed rows with idea, score, source/snippet, and next action', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch());

    render(<App />);

    expect(await screen.findByText('SOC2 prep copilot')).toBeDefined();
    expect(screen.getByText('82')).toBeDefined();
    expect(screen.getAllByText(/hacker_news/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/compliance blockers/i)).toBeDefined();
    expect(screen.getByText('validate_demand')).toBeDefined();
    expect(screen.getByText(/Page 1 \/ 1/i)).toBeDefined();
    expect(screen.getByRole('link', { name: /Source/i })).toBeDefined();
    expect(screen.getByText(/Runtime Logs/i)).toBeDefined();
    expect(screen.getByText(/AI Agents/i)).toBeDefined();
    expect(screen.getAllByText(/claude/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/ai judge call failed for provider/i)).toBeDefined();

    // V2 layout: thesis board and agent sidebar
    expect(screen.getByText(/Top Theses/i)).toBeDefined();
    expect(screen.getByText('SOC2 Automation Platform')).toBeDefined();
    expect(screen.getByText('Developer Onboarding Tool')).toBeDefined();
    expect(screen.getByText('78%')).toBeDefined();
    expect(screen.getByText('62%')).toBeDefined();
    expect(screen.getByText(/Research Agent/i)).toBeDefined();
    expect(screen.getByText(/API security testing tools/i)).toBeDefined();
    expect(screen.getByText(/2 theses updated/i)).toBeDefined();
  });

  it('shows partial data and error hint when one API request fails', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch({ failSignals: true }));

    render(<App />);

    expect(await screen.findByText('hn')).toBeDefined();
    expect(screen.getByText(/Top Theses/i)).toBeDefined();
    expect(screen.getByText(/Some data could not be loaded/i)).toBeDefined();
  });

  it('degrades gracefully when thesis and agent APIs fail', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch({ failTheses: true, failAgent: true }));

    render(<App />);

    // Core data still loads
    expect(await screen.findByText('SOC2 prep copilot')).toBeDefined();
    // Thesis section shows empty state
    expect(screen.getByText(/No theses yet/i)).toBeDefined();
    // Agent sidebar shows fallback
    expect(screen.getByText(/No runs yet/i)).toBeDefined();
    // No warning banner since thesis/agent are non-critical
  });
});
