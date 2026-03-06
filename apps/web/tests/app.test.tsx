// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  { name: 'hn', status: 'active', last_run: '2026-02-24T01:00:00.000Z', cadence: 'hourly' }
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
  primary_provider: 'claude',
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
    sourceCount: 3,
    estimatedScope: 'small' as const
  },
  {
    canonicalKey: 'dev-onboarding',
    title: 'Developer Onboarding Tool',
    confidence: 62,
    status: 'watching',
    evidenceCount: 3,
    problemStatement: 'Engineering teams waste weeks onboarding new developers',
    sourceCount: 2,
    estimatedScope: 'medium' as const
  }
];

const mockAgentStatus = {
  lastRun: {
    timestamp: '2026-02-24T03:00:00.000Z',
    thesesUpdated: 2,
    newCandidates: 1,
    clustersAnalyzed: 3,
    deepDivesPerformed: 1,
    journalEntriesWritten: 5,
    provider: 'claude'
  },
  investigateNext: 'API security testing tools'
};

const mockInfraStatus = {
  postgres: 'ok',
  ollama: 'error',
  embeddings: { total: 154, withEmbedding: 100, fallbackModel: 'local-hash-v1' }
};

const mockSignalCounts = { hacker_news: 1 };

const buildMockFetch = (overrides?: { failSignals?: boolean; failTheses?: boolean; failAgent?: boolean }) =>
  vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    // Must come before /v1/signals to avoid prefix match
    if (url.includes('/v1/signals/counts')) {
      return Promise.resolve(new Response(JSON.stringify(mockSignalCounts), { status: 200 }));
    }

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
      return Promise.resolve(new Response(JSON.stringify({
        items: mockTheses,
        page: 1,
        page_size: 10,
        total_items: mockTheses.length,
        total_pages: 1,
        has_next: false,
        has_prev: false
      }), { status: 200 }));
    }

    if (url.includes('/v1/agent/status')) {
      if (overrides?.failAgent) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(mockAgentStatus), { status: 200 }));
    }

    if (url.includes('/v1/infra/status')) {
      return Promise.resolve(new Response(JSON.stringify(mockInfraStatus), { status: 200 }));
    }

    if (url.includes('/v1/profiles')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 'consumer', name: 'Consumer / Social', display: { badge: 'Consumer', badgeColor: '#3b82f6' }, dimensions: [] },
        { id: 'b2b', name: 'B2B / Enterprise', display: { badge: 'B2B', badgeColor: '#10b981' }, dimensions: [] }
      ]), { status: 200 }));
    }

    if (url.includes('/v1/connectors/refresh-meta')) {
      return Promise.resolve(new Response(JSON.stringify({
        last_hourly_run: '2026-02-24T01:00:00.000Z',
        last_daily_run: '2026-02-24T00:00:00.000Z',
        hourly_interval_ms: 3600000,
        daily_interval_ms: 86400000
      }), { status: 200 }));
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
    expect(screen.getByText('1 / 1')).toBeDefined();
    expect(screen.getByRole('link', { name: /Source/i })).toBeDefined();
    expect(screen.getByText(/Logs/i)).toBeDefined();
    expect(screen.getByText(/AI Agents/i)).toBeDefined();
    expect(screen.getAllByText(/claude/i).length).toBeGreaterThan(0);

    // Thesis board (titles in main pane only, sidebar shows overview)
    expect(screen.getByText(/Top Ideas/i)).toBeDefined();
    expect(screen.getByText('SOC2 Automation Platform')).toBeDefined();
    expect(screen.getByText('Developer Onboarding Tool')).toBeDefined();
    expect(screen.getAllByText('78%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('62%').length).toBeGreaterThan(0);

    // Research agent sidebar section
    expect(screen.getByText(/Research Agent/i)).toBeDefined();
    expect(screen.getByText('Updated')).toBeDefined();
  });

  it('shows partial data and error hint when one API request fails', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch({ failSignals: true }));

    render(<App />);

    // Connector display name appears in source filter dropdown
    expect((await screen.findAllByText('Hacker News')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Top Ideas/i)).toBeDefined();
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
  });

  it('clicking thesis card shows filter chip', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch());

    render(<App />);

    // Wait for thesis to load in main pane
    const title = await screen.findByText('SOC2 Automation Platform');
    // Click the thesis card
    const card = title.closest('.thesis-card');
    expect(card).toBeDefined();
    fireEvent.click(card!);
    // Filter chip adds another occurrence of the title text
    const afterClick = screen.getAllByText('SOC2 Automation Platform');
    expect(afterClick.length).toBeGreaterThan(1);
  });

  it('renders sidebar with connector, AI, and agent info', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch());

    render(<App />);

    expect(await screen.findByText(/Connectors/i)).toBeTruthy();
    expect(screen.getByText(/AI Agents/i)).toBeDefined();
    expect(screen.getByText(/Research Agent/i)).toBeDefined();
  });

  it('triggers agent run and shows running state', async () => {
    vi.stubGlobal('EventSource', undefined);
    const mockFetch = buildMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);

    // Wait for initial data load
    await screen.findByText('SOC2 prep copilot');

    // Find and click the Run button
    const runButton = screen.getByRole('button', { name: /^Run$/i });
    expect(runButton).toBeDefined();
    fireEvent.click(runButton);

    // Verify "Running..." state appears
    expect(await screen.findByText(/Running/i)).toBeDefined();
  });

  it('opens log drawer and shows log entries', async () => {
    vi.stubGlobal('EventSource', undefined);
    vi.stubGlobal('fetch', buildMockFetch());

    render(<App />);

    // Wait for app to load
    await screen.findByText('SOC2 prep copilot');

    // Find the Logs button and click it
    const logsButton = screen.getByText(/Logs/i);
    expect(logsButton).toBeDefined();
    fireEvent.click(logsButton);

    // Verify log entries are visible
    expect(await screen.findByText(/ai judge call failed/i)).toBeTruthy();
  });
});
