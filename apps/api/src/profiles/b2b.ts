import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';

export const b2bProfile: AgentProfile = {
  id: 'b2b',
  name: 'B2B / Enterprise',
  enabled: true,

  prompts: {
    identity: 'You specialize in finding B2B and ENTERPRISE SaaS product ideas with strong revenue potential, defensible moats, and clear buyer personas.',
    focusAreas: [
      'vertical SaaS for underserved industries',
      'API products and developer infrastructure',
      'workflow automation and process optimization',
      'compliance, security, and governance tools',
      'data platforms and analytics',
      'enterprise integrations and middleware',
      'internal tools and back-office automation',
    ],
    antiPatterns: [
      'Do NOT suggest consumer social apps, viral mobile games, or creator tools.',
      'Do NOT suggest ideas that depend entirely on viral distribution — B2B succeeds through sales, partnerships, and word-of-mouth among professionals.',
      'Avoid generic "AI for X" unless the specific workflow and buyer are crystal clear.',
    ],
    exampleGood: [
      'SOC2 Compliance Autopilot for Seed-Stage Startups',
      'Real-Time Inventory Sync API for Shopify-to-ERP',
      'AI Contract Review Tool for Mid-Market Legal Teams',
      'Automated Freight Broker Matching Platform',
    ],
    exampleBad: [
      'Enterprise AI Platform',
      'B2B Social Network',
      'Cloud Management Dashboard',
    ],
  },

  scoring: {
    dimensions: [
      {
        name: 'enterprise_pain',
        weight: 0.30,
        description: 'How severe and frequent is this problem in business/professional contexts? Are teams losing money, time, or failing compliance? (0-100)',
      },
      {
        name: 'market_size',
        weight: 0.25,
        description: 'Total addressable market and willingness to pay. How many businesses face this? What would they pay monthly/annually? (0-100)',
      },
      {
        name: 'moat_potential',
        weight: 0.25,
        description: 'How defensible is this once built? Consider: data network effects, integration lock-in, regulatory moats, switching costs, proprietary data advantages. (0-100)',
      },
      {
        name: 'feasibility',
        weight: 0.20,
        description: 'Can a small team (1-5 people) build a credible v1? Consider API availability, regulatory barriers, integration complexity, required domain expertise. (0-100)',
      },
    ],
  },

  signals: {
    additionalSubreddits: [
      'devops', 'sysadmin', 'ITManagers', 'msp',
      'salesforce', 'aws', 'googlecloud', 'azure',
      'ExperiencedDevs',
    ],
    signalFilter: 'Focus on signals indicating enterprise workflow gaps, tool complaints, integration pain, compliance burden, or manual processes that should be automated.',
  },

  display: {
    badge: 'B2B',
    badgeColor: '#10b981',
    defaultSort: 'score',
  },
};
