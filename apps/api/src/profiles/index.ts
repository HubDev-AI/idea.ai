import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';
import { consumerProfile } from './consumer.js';

const ALL_PROFILES: AgentProfile[] = [consumerProfile];

export function loadProfiles(): AgentProfile[] {
  return ALL_PROFILES.filter(p => p.enabled);
}

export function getProfile(id: string): AgentProfile | undefined {
  return ALL_PROFILES.find(p => p.id === id);
}

export { consumerProfile };
