import { rankSignals, type SignalWithBlend } from '@idea/pipeline/src/rank';
import { recommendNextAction } from '@idea/pipeline/src/recommend_action';

export type RankedPublishSignal = SignalWithBlend & {
  idea: string;
  top_source: string;
  snippet: string;
  source_url: string | null;
};

export const rankAndPreparePublish = (signals: RankedPublishSignal[]) =>
  rankSignals(signals).map((signal) => ({
    idea: signal.idea,
    score: signal.blended,
    top_source: signal.top_source,
    snippet: signal.snippet,
    source_url: signal.source_url,
    next_action: recommendNextAction(signal),
    updated_at: new Date().toISOString(),
    pain: signal.pain,
    timing: signal.timing,
    buildability: signal.buildability
  }));
