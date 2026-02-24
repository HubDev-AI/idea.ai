export type PublishableSignal = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  next_action: string;
  updated_at: string;
};

export const toFeedLine = (signal: PublishableSignal): string =>
  `${signal.idea} | ${signal.score} | ${signal.top_source} | ${signal.snippet} | ${signal.next_action}`;
