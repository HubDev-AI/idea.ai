import type { AgentRunResult } from '@idea/contracts/src/api';
import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';

export class AgentProfileRunsFailedError extends Error {
  readonly failures: Array<{ profileId: string; error: string }>;

  constructor(failures: Array<{ profileId: string; error: string }>) {
    super(`All configured research-agent profiles failed: ${failures.map((f) => `${f.profileId}: ${f.error}`).join('; ')}`);
    this.name = 'AgentProfileRunsFailedError';
    this.failures = failures;
  }
}

export const aggregateAgentProfileRuns = (
  profiles: AgentProfile[],
  results: PromiseSettledResult<AgentRunResult>[]
): {
  aggregated: AgentRunResult;
  failedProfiles: Array<{ profileId: string; error: string }>;
} => {
  const aggregated: AgentRunResult = {
    thesesUpdated: 0,
    newCandidates: 0,
    alerts: [],
    investigateNext: '',
    journalEntriesWritten: 0,
    clustersAnalyzed: 0,
    deepDivesPerformed: 0,
    debatesPerformed: 0,
    provider: null,
  };
  const failedProfiles: Array<{ profileId: string; error: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const profile = profiles[i];
    if (!profile) continue;

    if (result.status === 'fulfilled') {
      aggregated.thesesUpdated += result.value.thesesUpdated;
      aggregated.newCandidates += result.value.newCandidates;
      aggregated.alerts.push(...result.value.alerts);
      aggregated.journalEntriesWritten += result.value.journalEntriesWritten;
      aggregated.clustersAnalyzed += result.value.clustersAnalyzed;
      aggregated.deepDivesPerformed += result.value.deepDivesPerformed;
      aggregated.debatesPerformed = (aggregated.debatesPerformed ?? 0) + (result.value.debatesPerformed ?? 0);
      if (!aggregated.provider) aggregated.provider = result.value.provider;
      if (!aggregated.investigateNext) aggregated.investigateNext = result.value.investigateNext;
      continue;
    }

    failedProfiles.push({
      profileId: profile.id,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }

  if (failedProfiles.length === profiles.length && profiles.length > 0) {
    throw new AgentProfileRunsFailedError(failedProfiles);
  }

  return { aggregated, failedProfiles };
};
