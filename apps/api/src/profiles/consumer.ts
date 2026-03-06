import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';

export const consumerProfile: AgentProfile = {
  id: 'consumer',
  name: 'Consumer / Social',
  enabled: true,
  prompts: {
    identity: 'You specialize in finding CONSUMER and SOCIAL product ideas with viral growth potential.',
    focusAreas: [
      'consumer social apps',
      'community platforms',
      'creator tools',
      'prosumer products with network effects',
      'mobile-first experiences',
    ],
    antiPatterns: [
      'STRONGLY PREFER consumer/social product ideas over developer tools or enterprise B2B.',
      'Developer tooling ideas should only be surfaced if the signal is exceptionally strong (demand > 80).',
      'When you see trending consumer topics (Google Trends, TikTok, AlternativeTo), ask: "What app could a solo founder build in 1-2 months to serve this audience?"',
      'Cross-pollinate: tech signals can inspire consumer products. A GitHub issue about video processing → "TikTok-style editor for X niche".',
    ],
    exampleGood: [
      'Community Recipe Sharing App with AI Meal Planning',
      'TikTok-Style Short Video Editor for Realtors',
      'Dating App Where Friends Write Your Bio',
    ],
    exampleBad: [
      'Vertical SaaS Consolidation in Regulated Industries',
      'Proxy-signal instrumentation',
    ],
    scopeConstraint: 'Solo founder building for real people, not enterprises. 1-2 month MVP, viral distribution over paid acquisition.',
  },
  scoring: {
    dimensions: [
      { name: 'demand', weight: 0.25, description: 'How severe and widespread is the problem? (0-100)' },
      { name: 'timing', weight: 0.20, description: 'Is now the right time? Emerging trends, new APIs, cultural shifts? (0-100)' },
      { name: 'buildability', weight: 0.20, description: 'Can a solo dev build a credible MVP in 1-2 months? (0-100)' },
      { name: 'virality', weight: 0.35, description: 'How likely is this product to spread organically through network effects, sharing, or word of mouth? (0-100)' },
    ],
  },
  signals: {
    additionalSubreddits: [],
  },
  display: {
    badge: 'Consumer',
    badgeColor: '#3b82f6',
    defaultSort: 'score',
  },
};
