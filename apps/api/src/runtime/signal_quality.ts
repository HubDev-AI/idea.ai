import type { RawEventInput } from '@idea/connectors/src/common/http';
import type { FeedRecord } from '../routes/feed';

const MAX_SIGNALS_PER_REFRESH = 80;

const recruitingMarkers = [
  'who we are',
  'about us',
  'job description',
  'responsibilities',
  'qualifications',
  'what you will do',
  'what you ll do',
  'apply now',
  'apply for this role',
  'equal opportunity employer'
];

const painMarkers = [
  'pain point',
  'customers struggle',
  'manual process',
  'compliance burden',
  'billing error',
  'invoice mismatch',
  'costly',
  'time-consuming',
  'outage',
  'incident',
  'churn',
  'failed checkout',
  'support backlog'
];

const lowValueTitlePattern =
  /^(account executive|sales development representative|business development representative|software engineer|senior software engineer|staff software engineer|product manager|customer success manager|solutions engineer|technical support engineer|marketing manager)\b/i;

const toTs = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.toLowerCase() ?? '';

export const isLowValueOpportunityTitle = (text: string): boolean => lowValueTitlePattern.test(text.trim());

const hasPainSignal = (normalizedText: string): boolean =>
  painMarkers.some((marker) => normalizedText.includes(marker));

const isRecruitingLikeText = (normalizedText: string): boolean =>
  recruitingMarkers.some((marker) => normalizedText.includes(marker));

export const isLowValueRecruitingEvent = (event: RawEventInput): boolean => {
  const normalizedText = event.text.toLowerCase();
  const title = firstLine(event.text);
  const recruitingLike = isRecruitingLikeText(normalizedText) || isLowValueOpportunityTitle(title);

  if (!recruitingLike) {
    return false;
  }

  return !hasPainSignal(normalizedText);
};

export const selectEventsForScoring = (
  events: RawEventInput[],
  maxSignals = MAX_SIGNALS_PER_REFRESH
): RawEventInput[] => {
  if (events.length <= maxSignals) {
    return events;
  }

  const bucketMap = new Map<string, RawEventInput[]>();

  for (const event of events) {
    const bucket = bucketMap.get(event.source) ?? [];
    bucket.push(event);
    bucketMap.set(event.source, bucket);
  }

  for (const bucket of bucketMap.values()) {
    bucket.sort((left, right) => toTs(right.source_timestamp) - toTs(left.source_timestamp));
  }

  const sources = Array.from(bucketMap.keys()).sort((left, right) => left.localeCompare(right));
  const perSourceQuota = Math.max(1, Math.ceil(maxSignals / Math.max(1, sources.length)));

  const selected: RawEventInput[] = [];
  const usedBySource = new Map<string, number>();

  let madeProgress = true;
  while (selected.length < maxSignals && madeProgress) {
    madeProgress = false;

    for (const source of sources) {
      if (selected.length >= maxSignals) {
        break;
      }

      const bucket = bucketMap.get(source);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      const used = usedBySource.get(source) ?? 0;
      if (used >= perSourceQuota) {
        continue;
      }

      const next = bucket.shift();
      if (!next) {
        continue;
      }

      selected.push(next);
      usedBySource.set(source, used + 1);
      madeProgress = true;
    }
  }

  if (selected.length >= maxSignals) {
    return selected;
  }

  const leftovers = Array.from(bucketMap.values())
    .flat()
    .sort((left, right) => toTs(right.source_timestamp) - toTs(left.source_timestamp));

  for (const event of leftovers) {
    if (selected.length >= maxSignals) {
      break;
    }

    selected.push(event);
  }

  return selected;
};

export const isIdeaCandidateSignal = (
  signal: Pick<FeedRecord, 'idea' | 'score' | 'top_source' | 'next_action' | 'snippet'>
): boolean => {
  const normalized = `${signal.idea} ${signal.snippet}`.toLowerCase();
  if (isLowValueOpportunityTitle(signal.idea) || isRecruitingLikeText(normalized)) {
    return false;
  }

  if (signal.score >= 50) {
    return true;
  }

  return signal.score >= 46 && signal.next_action !== 'validate_channel';
};

export const findIdeaCandidates = (signals: FeedRecord[], limit = 3): FeedRecord[] =>
  signals.filter((signal) => isIdeaCandidateSignal(signal)).slice(0, limit);

export const applySourceQualityPenalty = ({
  source,
  idea,
  text,
  blended
}: {
  source: string;
  idea: string;
  text: string;
  blended: number;
}): number => {
  const normalizedText = text.toLowerCase();
  const heavyRecruitingSignal = isLowValueOpportunityTitle(idea) || isRecruitingLikeText(normalizedText);
  if (!heavyRecruitingSignal) {
    return blended;
  }

  const multiplier = 0.7;

  return Math.round(blended * multiplier * 100) / 100;
};
