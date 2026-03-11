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
