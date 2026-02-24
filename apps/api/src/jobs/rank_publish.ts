import { rankSignals, type SignalWithBlend } from '@idea/pipeline/src/rank';
import { recommendNextAction } from '@idea/pipeline/src/recommend_action';

export type RankedPublishSignal = SignalWithBlend & {
  idea: string;
  top_source: string;
  snippet: string;
};

export const rankAndPreparePublish = (signals: RankedPublishSignal[]) =>
  rankSignals(signals).map((signal) => ({
    idea: signal.idea,
    score: signal.blended,
    top_source: signal.top_source,
    snippet: signal.snippet,
    next_action: recommendNextAction(signal),
    updated_at: new Date().toISOString()
  }));
