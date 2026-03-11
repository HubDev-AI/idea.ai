// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const apiMockState = vi.hoisted(() => ({
  baseUrl: ''
}));

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
    estimatedScope: 'small' as const,
    label: 'favourite' as const,
  },
  {
    canonicalKey: 'dev-onboarding',
    title: 'Developer Onboarding Tool',
    confidence: 62,
    status: 'watching',
    evidenceCount: 3,
    problemStatement: 'Engineering teams waste weeks onboarding new developers',
    sourceCount: 2,
    estimatedScope: 'medium' as const,
    hasDeepDive: true
  }
];

const mockAgentStatus = {
  isRunning: false,
  intervalMs: 3600000,
  activeRunId: null,
  lastRun: {
    timestamp: '2026-02-24T03:00:00.000Z',
    thesesUpdated: 2,
    newCandidates: 1,
    clustersAnalyzed: 3,
    deepDivesPerformed: 1,
    journalEntriesWritten: 5,
    provider: 'claude'
  },
  lastAttempt: {
    runId: 'agent-prev',
    timestamp: '2026-02-24T03:00:00.000Z',
    status: 'completed' as const,
    provider: 'claude',
    errorMessage: null
  },
  investigateNext: 'API security testing tools'
};

const mockInfraStatus = {
  postgres: 'ok',
  ollama: 'error',
  embeddings: { total: 154, withEmbedding: 100, fallbackModel: 'local-hash-v1' }
};

const mockSignalCounts = { hacker_news: 1 };

const mockRefreshMeta = {
  last_hourly_run: '2026-02-24T01:00:00.000Z',
  last_daily_run: '2026-02-24T00:00:00.000Z',
  hourly_interval_ms: 3600000,
  daily_interval_ms: 86400000,
  refreshing: {
    hourly: false,
    daily: false
  }
};

const mockSnapshot = {
  connectors: mockConnectors,
  aiHealth: mockAiHealth,
  agentStatus: mockAgentStatus,
  infraStatus: mockInfraStatus,
  refreshMeta: mockRefreshMeta,
  signalCounts: mockSignalCounts,
  thesisStats: { total: 2, promoted: 1, watching: 1, totalEvidence: 8, totalSources: 5 },
  logs: mockLogs,
};

// Mock socket.io-client
let socketListeners: Map<string, Set<(...args: any[]) => void>> | null = null;
const ioCalls: Array<{ url: unknown; options: unknown }> = [];

const emitSocketEvent = (event: string, payload?: unknown) => {
  for (const handler of socketListeners?.get(event) ?? []) {
    handler(payload);
  }
};

const createMockSocket = () => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  socketListeners = listeners;
  const socket = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: true,
  };

  // Trigger connect + snapshot on next tick
  setTimeout(() => {
    for (const h of listeners.get('connect') ?? []) h();
    for (const h of listeners.get('snapshot') ?? []) h(mockSnapshot);
  }, 0);

  return socket;
};

vi.mock('socket.io-client', () => ({
  io: (url?: unknown, options?: unknown) => {
    ioCalls.push({ url, options });
    return createMockSocket();
  },
}));

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    resolveApiBaseUrl: () => apiMockState.baseUrl,
  };
});

const buildMockFetch = (overrides?: { failSignals?: boolean; failTheses?: boolean }) =>
  vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const parsedUrl = new URL(url, 'https://app.idea.test');

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

    if (url.includes('/deep-dive')) {
      if (url.includes('soc2-automation')) {
        return Promise.resolve(new Response(JSON.stringify({
          canonicalKey: 'soc2-automation',
          summary: 'SOC2 automation test summary',
          howItWorks: 'How it works',
          growthStrategy: 'Growth strategy',
          buildSuggestions: 'Build suggestions',
          generatedBy: 'test',
          createdAt: '2026-02-24T00:00:00.000Z'
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    }

    if (url.includes('/v1/theses')) {
      if (overrides?.failTheses) {
        return Promise.resolve(new Response('not found', { status: 404 }));
      }
      const label = parsedUrl.searchParams.get('label');
      const items = label
        ? mockTheses.filter((thesis) => (thesis.label ?? null) === label)
        : mockTheses;
      return Promise.resolve(new Response(JSON.stringify({
        items,
        page: 1,
        page_size: 10,
        total_items: items.length,
        total_pages: 1,
        has_next: false,
        has_prev: false
      }), { status: 200 }));
    }

    if (url.includes('/v1/agent/run')) {
      return Promise.resolve(new Response(JSON.stringify({ accepted: true, runId: 'agent-123', alreadyRunning: false }), { status: 202 }));
    }

    if (url.includes('/v1/profiles')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 'consumer', name: 'Consumer / Social', display: { badge: 'Consumer', badgeColor: '#3b82f6' }, dimensions: [] },
        { id: 'b2b', name: 'B2B / Enterprise', display: { badge: 'B2B', badgeColor: '#10b981' }, dimensions: [] }
      ]), { status: 200 }));
    }

    return Promise.resolve(new Response('{}', { status: 200 }));
  });

describe('web app', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', buildMockFetch());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    socketListeners = null;
    ioCalls.length = 0;
    apiMockState.baseUrl = '';
  });

  it('renders feed rows with idea, score, source/snippet, and next action', async () => {
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
    expect((await screen.findAllByText(/claude/i)).length).toBeGreaterThan(0);

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

  it('shows error hint when signal fetch fails', async () => {
    vi.stubGlobal('fetch', buildMockFetch({ failSignals: true }));

    render(<App />);

    // Error message from signal fetch failure
    expect(await screen.findByText(/Could not load signals/i)).toBeDefined();
  });

  it('degrades gracefully when thesis APIs fail', async () => {
    vi.stubGlobal('fetch', buildMockFetch({ failTheses: true }));

    render(<App />);

    // Core signal data still loads
    expect(await screen.findByText('SOC2 prep copilot')).toBeDefined();
    // Thesis section shows empty state
    expect(screen.getByText(/No theses yet/i)).toBeDefined();
  });

  it('clicking thesis card shows filter chip', async () => {
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
    render(<App />);

    expect(await screen.findByText(/Connectors/i)).toBeTruthy();
    expect(screen.getByText(/AI Agents/i)).toBeDefined();
    expect(screen.getByText(/Research Agent/i)).toBeDefined();
  });

  it('keeps manual runs active until websocket finishes the matching run', async () => {
    render(<App />);

    // Wait for initial data load
    await screen.findByText('SOC2 prep copilot');

    // Find and click the Run button
    const runButton = screen.getByRole('button', { name: /^Run$/i });
    expect(runButton).toBeDefined();
    fireEvent.click(runButton);

    // The old snapshot says not running, but the local optimistic state must survive
    // until the websocket sends the matching run outcome.
    expect(await screen.findByRole('button', { name: /Running/i })).toBeDefined();

    await act(async () => {
      emitSocketEvent('agentStatus', {
        ...mockAgentStatus,
        isRunning: true,
        activeRunId: 'agent-123',
        lastAttempt: {
          runId: 'agent-123',
          timestamp: '2026-02-24T04:00:00.000Z',
          status: 'running',
          provider: null,
          errorMessage: null
        }
      });
    });

    expect(await screen.findByText(/Analyzing signals and updating theses/i)).toBeDefined();

    await act(async () => {
      emitSocketEvent('agentStatus', {
        ...mockAgentStatus,
        isRunning: false,
        activeRunId: null,
        lastAttempt: {
          runId: 'agent-123',
          timestamp: '2026-02-24T04:01:00.000Z',
          status: 'failed',
          provider: null,
          errorMessage: 'No AI provider returned a usable response'
        }
      });
    });

    expect(await screen.findByText('Run failed')).toBeDefined();
    expect(screen.getByText('Last success')).toBeDefined();
  });

  it('opens log drawer and shows log entries', async () => {
    render(<App />);

    // Wait for app to load
    await screen.findByText('SOC2 prep copilot');

    // Find the Logs button and click it
    const logsButton = screen.getByText(/Logs/i);
    expect(logsButton).toBeDefined();
    fireEvent.click(logsButton);

    // Verify log entries are visible (logs come from WebSocket snapshot)
    expect(await screen.findByText(/ai judge call failed/i)).toBeTruthy();
  });

  it('shows LIVE connection status', async () => {
    render(<App />);

    // Wait for connection — multiple LIVE indicators (sidebar + log drawer)
    const liveElements = await screen.findAllByText('LIVE');
    expect(liveElements.length).toBeGreaterThan(0);
  });

  it('connects Socket.IO to the configured API origin over websocket-only transport', async () => {
    apiMockState.baseUrl = 'https://api.idea.test';

    render(<App />);

    await screen.findByText('SOC2 prep copilot');

    expect(ioCalls[0]).toEqual({
      url: 'https://api.idea.test',
      options: expect.objectContaining({
        path: '/socket.io/',
        transports: ['websocket'],
      })
    });
  });

  it('clears the thesis overview when websocket stats drop to zero', async () => {
    render(<App />);

    await screen.findByText('SOC2 prep copilot');
    expect(await screen.findByText('Theses Overview')).toBeDefined();

    await act(async () => {
      emitSocketEvent('thesisStats', {
        total: 0,
        promoted: 0,
        watching: 0,
        totalEvidence: 0,
        totalSources: 0,
      });
    });

    expect(screen.queryByText('Theses Overview')).toBeNull();
  });

  it('shows an authoritative zero signal count instead of falling back to stale page totals', async () => {
    const { container } = render(<App />);

    await screen.findByText('SOC2 prep copilot');

    await act(async () => {
      emitSocketEvent('signalCounts', {});
      emitSocketEvent('signalCount', 0);
      emitSocketEvent('latestSignalAt', null);
    });

    const signalsStat = container.querySelector('.sidebar-stats .sidebar-stat:first-child .sidebar-stat-value');
    expect(signalsStat?.textContent).toBe('0');
  });

  it('resolves a manual run if the websocket finishes before the POST returns', async () => {
    let resolveRunRequest: ((value: Response) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/agent/run')) {
        return new Promise<Response>((resolve) => {
          resolveRunRequest = resolve;
        });
      }
      return buildMockFetch()(input);
    }));

    render(<App />);
    await screen.findByText('SOC2 prep copilot');

    fireEvent.click(screen.getByRole('button', { name: /^Run$/i }));
    expect(await screen.findByRole('button', { name: /Running/i })).toBeDefined();

    await act(async () => {
      emitSocketEvent('agentStatus', {
        ...mockAgentStatus,
        isRunning: false,
        activeRunId: null,
        lastAttempt: {
          runId: 'agent-123',
          timestamp: '2026-02-24T04:01:00.000Z',
          status: 'failed',
          provider: null,
          errorMessage: 'provider failed quickly'
        }
      });
    });

    await act(async () => {
      resolveRunRequest?.(new Response(JSON.stringify({ accepted: true, runId: 'agent-123', alreadyRunning: false }), { status: 202 }));
    });

    expect(await screen.findByText('Run failed')).toBeDefined();
  });

  it('removes a thesis locally when its label no longer matches the active filter', async () => {
    render(<App />);

    await screen.findByText('SOC2 Automation Platform');

    fireEvent.change(screen.getByDisplayValue('All Labels'), {
      target: { value: 'favourite' },
    });

    expect(await screen.findByText('SOC2 Automation Platform')).toBeDefined();
    expect(screen.queryByText('Developer Onboarding Tool')).toBeNull();

    fireEvent.click(screen.getByTitle('Favourite'));

    expect(await screen.findByText(/No theses yet/i)).toBeDefined();
    expect(screen.queryByText('SOC2 Automation Platform')).toBeNull();
  });
});
