export interface ScoreDimension {
  name: string;
  weight: number;
  description: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  enabled: boolean;

  prompts: {
    identity: string;
    focusAreas: string[];
    antiPatterns: string[];
    exampleGood: string[];
    exampleBad: string[];
    scopeConstraint?: string;
  };

  scoring: {
    dimensions: ScoreDimension[];
  };

  signals: {
    connectorWeights?: Record<string, number>;
    additionalSubreddits?: string[];
    signalFilter?: string;
  };

  display: {
    badge: string;
    badgeColor: string;
    icon?: string;
    defaultSort?: string;
  };
}
