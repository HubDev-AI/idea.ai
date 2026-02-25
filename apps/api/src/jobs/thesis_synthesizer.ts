export type MemorySignalForSynthesis = {
  signal_id: string;
  topic: string;
  source: string;
  canonical_text: string;
  observed_at: string;
  pain: number;
  timing: number;
  buildability: number;
  blended: number;
};

export type ThesisStatus = 'candidate' | 'watching' | 'promoted' | 'stale' | 'rejected';

export type ThesisEvidenceDraft = {
  signal_id: string;
  relation: 'supporting' | 'adjacent' | 'contradicting';
  weight: number;
  snippet: string;
  observed_at: string;
};

export type ThesisDraft = {
  canonicalKey: string;
  title: string;
  topic: string;
  status: ThesisStatus;
  confidence: number;
  scoreTotal: number;
  problemStatement: string;
  targetBuyer: string;
  proposedSolution: string;
  evidenceCount: number;
  avgPain: number;
  avgTiming: number;
  avgBuildability: number;
  latestObservedAt: string;
  evidence: ThesisEvidenceDraft[];
};

const stopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'about',
  'who',
  'are',
  'what',
  'will',
  'your',
  'you',
  'have',
  'has',
  'had',
  'not',
  'but',
  'can',
  'our',
  'their',
  'they',
  'them',
  'its',
  'all',
  'any',
  'job',
  'role',
  'team',
  'account',
  'executive'
]);

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

const toDate = (value: string): Date => new Date(value);
const daysAgo = (days: number, now: Date): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopWords.has(token));

const detectCategory = (text: string): string => {
  const normalized = text.toLowerCase();

  if (normalized.includes('compliance') || normalized.includes('soc2') || normalized.includes('audit')) {
    return 'compliance';
  }

  if (normalized.includes('billing') || normalized.includes('invoice') || normalized.includes('payment')) {
    return 'billing';
  }

  if (normalized.includes('support') || normalized.includes('ticket') || normalized.includes('customer success')) {
    return 'support';
  }

  if (normalized.includes('deploy') || normalized.includes('runtime') || normalized.includes('build')) {
    return 'devops';
  }

  if (normalized.includes('security') || normalized.includes('auth') || normalized.includes('vulnerability')) {
    return 'security';
  }

  if (normalized.includes('ai') || normalized.includes('llm') || normalized.includes('agent')) {
    return 'ai';
  }

  if (normalized.includes('hiring') || normalized.includes('job') || normalized.includes('recruit')) {
    return 'hiring';
  }

  return 'general';
};

const parseSnippet = (canonicalText: string): string => {
  const segments = canonicalText
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const primary = segments.find((entry) => !entry.startsWith('topic:')) ?? canonicalText;
  return primary.slice(0, 220);
};

const dominantSource = (signals: MemorySignalForSynthesis[]): string => {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    counts.set(signal.source, (counts.get(signal.source) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
};

const targetBuyerForSource = (source: string): string => {
  if (source.includes('github')) {
    return 'Engineering and product teams';
  }

  if (source.includes('yc')) {
    return 'Startup founders and operations leads';
  }

  if (source.includes('greenhouse') || source.includes('lever')) {
    return 'Recruiting and people operations teams';
  }

  if (source.includes('hn')) {
    return 'Early-stage technical founders';
  }

  return 'Operations teams';
};

const titleFor = ({ topic, category, keyword }: { topic: string; category: string; keyword: string }): string => {
  const topicLabel = topic.replace(/_/g, ' ');
  const categoryLabel = category === topic ? 'workflow' : category;
  const keywordLabel = keyword.replace(/_/g, ' ');

  return `${keywordLabel} ${categoryLabel} copilot for ${topicLabel}`.replace(/\s+/g, ' ').trim();
};

const problemFor = (category: string): string => {
  switch (category) {
    case 'compliance':
      return 'Compliance tasks keep recurring and evidence collection remains manual.';
    case 'billing':
      return 'Billing operations and reconciliation create repeated errors and revenue risk.';
    case 'support':
      return 'Support queues are noisy and teams miss recurring root causes.';
    case 'devops':
      return 'Build, deploy, and runtime operations produce repeated incident-prone toil.';
    case 'security':
      return 'Security and access workflows are fragmented and hard to enforce consistently.';
    case 'ai':
      return 'AI feature rollout lacks repeatable guardrails and observability.';
    case 'hiring':
      return 'Hiring operations have repetitive process overhead and poor signal quality.';
    default:
      return 'Teams report repeated operational pain with limited automation.';
  }
};

const solutionFor = (category: string): string => {
  switch (category) {
    case 'compliance':
      return 'Automate evidence capture, control mapping, and audit-ready reporting.';
    case 'billing':
      return 'Provide autonomous reconciliation, anomaly alerts, and recovery workflows.';
    case 'support':
      return 'Cluster repeated support pain and trigger playbooks before backlog spikes.';
    case 'devops':
      return 'Runbook copilot that predicts breakage and automates repetitive recovery steps.';
    case 'security':
      return 'Policy-aware security operations assistant with continuous drift detection.';
    case 'ai':
      return 'AI ops layer for safe deployment, guardrails, and quality monitoring.';
    case 'hiring':
      return 'Hiring workflow intelligence to surface bottlenecks and automate routine ops.';
    default:
      return 'Workflow automation assistant that reduces repeated manual work.';
  }
};

const buildConfidence = ({
  avgPain,
  avgTiming,
  avgBuildability,
  momentum,
  evidenceCount
}: {
  avgPain: number;
  avgTiming: number;
  avgBuildability: number;
  momentum: number;
  evidenceCount: number;
}): number => {
  const evidenceSignal = clamp(evidenceCount * 12);
  return round2(
    clamp(avgPain * 0.35 + avgTiming * 0.2 + avgBuildability * 0.1 + momentum * 0.2 + evidenceSignal * 0.15)
  );
};

const momentumFor = (signals: MemorySignalForSynthesis[], now: Date): number => {
  const boundary7 = daysAgo(7, now);
  const boundary30 = daysAgo(30, now);

  let count7 = 0;
  let count30 = 0;

  for (const signal of signals) {
    const observed = toDate(signal.observed_at);
    if (observed >= boundary7) {
      count7 += 1;
    } else if (observed >= boundary30) {
      count30 += 1;
    }
  }

  if (count7 === 0 && count30 === 0) {
    return 20;
  }

  if (count30 === 0) {
    return 70;
  }

  const normalized30 = count30 / 3.3;
  const growth = (count7 - normalized30) / Math.max(1, normalized30);
  return round2(clamp(50 + growth * 20));
};

const selectTopKeyword = (signals: MemorySignalForSynthesis[]): string => {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    for (const token of tokenize(signal.canonical_text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  const [top] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return top?.[0] ?? 'workflow';
};

const statusFor = (confidence: number, evidenceCount: number): ThesisStatus => {
  if (confidence >= 70 && evidenceCount >= 4) {
    return 'promoted';
  }

  if (confidence >= 55 && evidenceCount >= 2) {
    return 'watching';
  }

  return 'candidate';
};

export const buildThesisCandidates = (
  signals: MemorySignalForSynthesis[],
  now = new Date()
): ThesisDraft[] => {
  if (signals.length === 0) {
    return [];
  }

  const byGroup = new Map<string, MemorySignalForSynthesis[]>();
  for (const signal of signals) {
    const category = detectCategory(signal.canonical_text);
    const key = `${signal.topic}:${category}`;
    const bucket = byGroup.get(key) ?? [];
    bucket.push(signal);
    byGroup.set(key, bucket);
  }

  const drafts: ThesisDraft[] = [];
  for (const [groupKey, bucket] of byGroup.entries()) {
    if (bucket.length < 2) {
      continue;
    }

    const [topic, category] = groupKey.split(':') as [string, string];
    const keyword = selectTopKeyword(bucket);
    const canonicalKey = `${topic}:${category}:${keyword}`;
    const avgPain = round2(bucket.reduce((sum, signal) => sum + signal.pain, 0) / bucket.length);
    const avgTiming = round2(bucket.reduce((sum, signal) => sum + signal.timing, 0) / bucket.length);
    const avgBuildability = round2(bucket.reduce((sum, signal) => sum + signal.buildability, 0) / bucket.length);
    const momentum = momentumFor(bucket, now);
    const confidence = buildConfidence({
      avgPain,
      avgTiming,
      avgBuildability,
      momentum,
      evidenceCount: bucket.length
    });

    if (category === 'hiring' && confidence < 75) {
      continue;
    }

    const status = statusFor(confidence, bucket.length);
    const ordered = [...bucket].sort((left, right) => {
      if (right.blended !== left.blended) {
        return right.blended - left.blended;
      }
      return toDate(right.observed_at).getTime() - toDate(left.observed_at).getTime();
    });
    const latestObservedAt = ordered[0]?.observed_at ?? new Date().toISOString();
    const source = dominantSource(bucket);
    const evidence = ordered.slice(0, 12).map((signal) => ({
      signal_id: signal.signal_id,
      relation: 'supporting' as const,
      weight: round2(clamp(signal.blended)),
      snippet: parseSnippet(signal.canonical_text),
      observed_at: signal.observed_at
    }));

    drafts.push({
      canonicalKey,
      title: titleFor({ topic, category, keyword }),
      topic,
      status,
      confidence,
      scoreTotal: confidence,
      problemStatement: problemFor(category),
      targetBuyer: targetBuyerForSource(source),
      proposedSolution: solutionFor(category),
      evidenceCount: bucket.length,
      avgPain,
      avgTiming,
      avgBuildability,
      latestObservedAt,
      evidence
    });
  }

  return drafts.sort((left, right) => right.confidence - left.confidence);
};

