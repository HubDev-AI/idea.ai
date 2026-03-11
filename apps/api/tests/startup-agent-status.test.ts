import type { AgentStatusRecord } from '@idea/contracts/src/api';
import { describe, expect, it } from 'vitest';

type AgentRunRow = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'completed' | 'failed';
  theses_updated: number;
  new_candidates: number;
  clusters_analyzed: number;
  deep_dives_performed: number;
  journal_entries_written: number;
  provider: string | null;
  investigate_next: string | null;
  error_message: string | null;
};

describe('startup agent status reconstruction', () => {
  it('keeps the last success separate from the latest failed attempt', async () => {
    const modulePromise = import('../src/runtime/agent_status_state');

    await expect(modulePromise).resolves.toHaveProperty('buildStartupAgentStatus');

    const { buildStartupAgentStatus } = await modulePromise;

    const completedRow: AgentRunRow = {
      run_id: 'agent-success',
      started_at: '2026-03-11T07:00:00.000Z',
      finished_at: '2026-03-11T07:05:00.000Z',
      status: 'completed',
      theses_updated: 4,
      new_candidates: 2,
      clusters_analyzed: 12,
      deep_dives_performed: 1,
      journal_entries_written: 7,
      provider: 'codex',
      investigate_next: 'consumer retention tooling',
      error_message: null,
    };

    const latestFailedRow: AgentRunRow = {
      run_id: 'agent-failed',
      started_at: '2026-03-11T09:00:00.000Z',
      finished_at: '2026-03-11T09:01:00.000Z',
      status: 'failed',
      theses_updated: 0,
      new_candidates: 0,
      clusters_analyzed: 0,
      deep_dives_performed: 0,
      journal_entries_written: 0,
      provider: null,
      investigate_next: 'b2b workflow ops',
      error_message: 'provider outage',
    };

    const status: AgentStatusRecord = buildStartupAgentStatus({
      intervalMs: 3_600_000,
      completedRow,
      latestRow: latestFailedRow,
    });

    expect(status).toEqual({
      isRunning: false,
      intervalMs: 3_600_000,
      activeRunId: null,
      lastRun: {
        timestamp: '2026-03-11T07:05:00.000Z',
        thesesUpdated: 4,
        newCandidates: 2,
        clustersAnalyzed: 12,
        deepDivesPerformed: 1,
        journalEntriesWritten: 7,
        provider: 'codex',
      },
      lastAttempt: {
        runId: 'agent-failed',
        timestamp: '2026-03-11T09:01:00.000Z',
        status: 'failed',
        provider: null,
        errorMessage: 'provider outage',
      },
      investigateNext: 'b2b workflow ops',
    });
  });
});
