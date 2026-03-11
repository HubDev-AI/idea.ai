import type { AgentStatusRecord } from '@idea/contracts/src/api';

export type AgentRunStatusRow = {
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

export const toLastRun = (row: AgentRunStatusRow | undefined): AgentStatusRecord['lastRun'] => {
  if (!row) return null;

  return {
    timestamp: row.finished_at ?? row.started_at,
    thesesUpdated: row.theses_updated,
    newCandidates: row.new_candidates,
    clustersAnalyzed: row.clusters_analyzed,
    deepDivesPerformed: row.deep_dives_performed,
    journalEntriesWritten: row.journal_entries_written,
    provider: row.provider ?? null,
  };
};

export const toLastAttempt = (row: AgentRunStatusRow | undefined): AgentStatusRecord['lastAttempt'] => {
  if (!row) return null;

  return {
    runId: row.run_id,
    timestamp: row.finished_at ?? row.started_at,
    status: row.status,
    provider: row.provider ?? null,
    errorMessage: row.error_message ?? null,
  };
};

export const buildStartupAgentStatus = ({
  intervalMs,
  completedRow,
  latestRow,
}: {
  intervalMs: number;
  completedRow?: AgentRunStatusRow;
  latestRow?: AgentRunStatusRow;
}): AgentStatusRecord => ({
  isRunning: false,
  intervalMs,
  activeRunId: null,
  lastRun: toLastRun(completedRow),
  lastAttempt: toLastAttempt(latestRow),
  investigateNext: latestRow?.investigate_next ?? completedRow?.investigate_next ?? null,
});

const toTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
};

export const getLatestAgentActivityAt = (status: Pick<AgentStatusRecord, 'lastAttempt' | 'lastRun'>): number | null => {
  const attemptAt = toTimestamp(status.lastAttempt?.timestamp);
  const lastRunAt = toTimestamp(status.lastRun?.timestamp);
  if (attemptAt == null) return lastRunAt;
  if (lastRunAt == null) return attemptAt;
  return Math.max(attemptAt, lastRunAt);
};

export const isAgentCatchUpDue = (
  status: Pick<AgentStatusRecord, 'lastAttempt' | 'lastRun' | 'intervalMs'>,
  now: string | number | Date = Date.now(),
): boolean => {
  const nowMs = typeof now === 'number'
    ? now
    : now instanceof Date
      ? now.getTime()
      : new Date(now).getTime();
  const latestActivityAt = getLatestAgentActivityAt(status);
  if (latestActivityAt == null) return true;
  return nowMs - latestActivityAt > status.intervalMs;
};
