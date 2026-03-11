import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';
import { describe, expect, it } from 'vitest';
import { aggregateAgentProfileRuns, AgentProfileRunsFailedError } from '../src/jobs/agent_run_aggregation';

const consumerProfile = { id: 'consumer', name: 'Consumer' } as AgentProfile;
const b2bProfile = { id: 'b2b', name: 'B2B' } as AgentProfile;

describe('aggregateAgentProfileRuns', () => {
  it('throws when every configured profile run fails', () => {
    expect(() => aggregateAgentProfileRuns(
      [consumerProfile, b2bProfile],
      [
        { status: 'rejected', reason: new Error('codex down') },
        { status: 'rejected', reason: new Error('claude down') },
      ] as PromiseSettledResult<never>[]
    )).toThrow(AgentProfileRunsFailedError);
  });

  it('aggregates successful profile runs and preserves the first provider used', () => {
    const result = aggregateAgentProfileRuns(
      [consumerProfile, b2bProfile],
      [
        {
          status: 'fulfilled',
          value: {
            thesesUpdated: 2,
            newCandidates: 1,
            alerts: ['consumer:alpha'],
            investigateNext: 'consumer signal',
            journalEntriesWritten: 3,
            clustersAnalyzed: 10,
            deepDivesPerformed: 1,
            debatesPerformed: 0,
            provider: 'codex',
          }
        },
        {
          status: 'rejected',
          reason: new Error('secondary profile unavailable')
        }
      ] as PromiseSettledResult<{
        thesesUpdated: number;
        newCandidates: number;
        alerts: string[];
        investigateNext: string;
        journalEntriesWritten: number;
        clustersAnalyzed: number;
        deepDivesPerformed: number;
        debatesPerformed: number;
        provider: string | null;
      }>[]
    );

    expect(result.aggregated.thesesUpdated).toBe(2);
    expect(result.aggregated.newCandidates).toBe(1);
    expect(result.aggregated.provider).toBe('codex');
    expect(result.failedProfiles).toEqual([
      { profileId: 'b2b', error: 'secondary profile unavailable' }
    ]);
  });
});
