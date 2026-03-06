import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';
import { consumerProfile } from './consumer.js';
import { b2bProfile } from './b2b.js';

const ALL_PROFILES: AgentProfile[] = [consumerProfile, b2bProfile];

export function loadProfiles(): AgentProfile[] {
  return ALL_PROFILES.filter(p => p.enabled);
}

export function getProfile(id: string): AgentProfile | undefined {
  return ALL_PROFILES.find(p => p.id === id);
}

export { consumerProfile, b2bProfile };
