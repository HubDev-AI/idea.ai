import type { AgentStatusRecord } from '@idea/contracts/src/api';

export const getCatchUpAnchorTimestamp = (status: AgentStatusRecord): string | null =>
  status.lastAttempt?.timestamp ?? status.lastRun?.timestamp ?? null;

export const isAgentCatchUpDue = (
  status: AgentStatusRecord,
  intervalMs: number,
  nowMs = Date.now(),
): boolean => {
  const anchor = getCatchUpAnchorTimestamp(status);
  if (!anchor) return false;
  const anchorMs = new Date(anchor).getTime();
  if (Number.isNaN(anchorMs)) return false;
  return nowMs - anchorMs > intervalMs;
};

export const buildShutdownInterruptedError = (runId: string): Error =>
  new Error(`agent run ${runId} interrupted by shutdown timeout`);
