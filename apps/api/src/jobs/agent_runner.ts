import { dualAnalystRun } from '@idea/ai-runtime/src/dual_analyst';
import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { AgentProfile } from '@idea/contracts/src/agent_profile.js';
import type { AgentRunResult } from '@idea/contracts/src/api';
import { consumerProfile } from '../profiles/consumer.js';
import type { ExecutionLogger } from '../runtime/execution_logger';
import type { JournalEntry, JournalStore } from '../runtime/journal_store';
import type { PostgresMemoryStore } from '../runtime/postgres_memory_store';
import type { ThesisStore } from '../runtime/thesis_store';
import {
  type AgentThesisSummary,
  type BroadScanOutput,
  buildBroadScanPrompt,
  buildDeepDivePrompt,
  type DeepDiveOutput,
  parseBroadScanResponse,
  parseDeepDiveResponse,
} from './research_agent';
import { corroborationScore } from '@idea/pipeline/src/scoring/correlation';
import { computeVelocity, velocityMultiplier } from '@idea/pipeline/src/scoring/velocity';
import { computeToolFragmentation, computeInvestorAttention, categoryCreationScore } from '@idea/pipeline/src/scoring/category_detector';
import { estimateSupply, classifyImbalance, imbalanceMultiplier } from '@idea/pipeline/src/scoring/supply_demand';
import { detectChangePoints } from '@idea/pipeline/src/scoring/cusum';
import { type ClusterableSignal, clusterSignals } from './signal_clusterer';
import type { ThesisEvidenceDraft } from './thesis_synthesizer';
import { runDebate, verdictToLikelihoodRatio, type DebateResult } from './thesis_debate';
import { bayesianUpdate } from '@idea/pipeline/src/scoring/bayesian';

export type { AgentRunResult };

export type AgentRunnerDeps = {
  thesisStore: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  journalStore?: JournalStore | null;
  embedText?: (text: string) => Promise<number[] | null>;
  runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
  runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
  logger?: ExecutionLogger;
  runId?: string;
  preferredProvider?: 'claude' | 'codex';
  timeoutMs?: number;
  maxClusters?: number;
  profile?: AgentProfile;
  pool?: import('pg').Pool;
  debateConfidenceThreshold?: number;
  debateMaxPerRun?: number;
  cusumThreshold?: number;
  cusumDrift?: number;
};

const MAX_DEEP_DIVES = 2;

const titleWords = (title: string): Set<string> =>
  new Set(title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2));

const titleOverlap = (a: string, b: string): number => {
  const wordsA = titleWords(a);
  const wordsB = titleWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let matches = 0;
  for (const w of wordsA) if (wordsB.has(w)) matches++;
  return matches / Math.min(wordsA.size, wordsB.size);
};

const clampDelta = (delta: number): number =>
  Math.max(-20, Math.min(20, delta));

const VALID_ENTRY_TYPES = new Set(['trend_shift', 'emerging_pattern', 'thesis_evolution', 'market_signal', 'run_summary']);

const sanitizeEntryType = (raw: string): JournalEntry['entry_type'] =>
  VALID_ENTRY_TYPES.has(raw) ? (raw as JournalEntry['entry_type']) : 'market_signal';

const noopLog = async () => {};
const noopLogger: Pick<ExecutionLogger, 'info' | 'warn' | 'debug' | 'error'> = {
  info: noopLog, warn: noopLog, debug: noopLog, error: noopLog
};

const pickPreferred = <T>(result: { claude: T | null; codex: T | null }, preferred: 'claude' | 'codex'): T | null =>
  preferred === 'codex' ? (result.codex ?? result.claude) : (result.claude ?? result.codex);

const resolveUsedProvider = (result: { claude: unknown | null; codex: unknown | null }, preferred: 'claude' | 'codex'): string | null =>
  preferred === 'codex'
    ? (result.codex ? 'codex' : result.claude ? 'claude' : null)
    : (result.claude ? 'claude' : result.codex ? 'codex' : null);

export const runResearchAgent = async (deps: AgentRunnerDeps): Promise<AgentRunResult> => {
  const log = deps.logger ?? noopLogger;
  const runId = deps.runId ?? `agent-${Date.now()}`;
  const preferred = deps.preferredProvider ?? 'claude';
  const timeoutMs = deps.timeoutMs ?? 180_000;
  const maxClusters = deps.maxClusters ?? 50;
  const profile = deps.profile ?? consumerProfile;
  let thesesUpdated = 0;
  let newCandidates = 0;
  const allAlerts: string[] = [];
  const allJournalEntries: JournalEntry[] = [];
  let investigateNext = '';

  // === Load context ===
  const allTheses = await deps.thesisStore.list();
  const activeTheses: AgentThesisSummary[] = allTheses
    .filter((t) => t.status !== 'stale' && t.status !== 'rejected')
    .slice(0, 15)
    .map((t) => ({
      canonicalKey: t.canonicalKey,
      title: t.title,
      confidence: t.confidence,
      status: t.status,
      evidenceCount: t.evidenceCount
    }));

  // Load recent signals with embeddings for clustering
  const recentSignals = deps.memoryStore
    ? await deps.memoryStore.listAllSignals(500)
    : [];

  // Load embeddings for clustering
  let clusterableSignals: ClusterableSignal[] = [];
  if (deps.memoryStore && recentSignals.length > 0) {
    const signalIds = recentSignals.map((s) => s.signal_id);
    const embeddingRows = await deps.memoryStore.getEmbeddings(signalIds);

    clusterableSignals = recentSignals
      .filter((s) => embeddingRows.has(s.signal_id))
      .map((s) => ({
        signal_id: s.signal_id,
        canonical_text: s.canonical_text,
        source: s.source,
        demand: s.demand,
        timing: s.timing,
        virality: s.virality,
        blended: s.blended,
        embedding: embeddingRows.get(s.signal_id)!
      }));
  }

  const clusters = clusterSignals(clusterableSignals);

  // Compute velocity and corroboration per cluster for thesis enrichment
  const clusterMetrics = new Map<number, { velocity: number; corroboration: number }>();
  const now7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const now30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const cluster of clusters) {
    const clusterSignalIds = new Set(cluster.representatives.map((r) => r.signal_id));
    const matchedSignals = recentSignals.filter((s) => clusterSignalIds.has(s.signal_id));
    let week = 0;
    let month = 0;
    for (const s of matchedSignals) {
      const ts = new Date(s.observed_at).getTime();
      if (ts >= now7d) week++;
      if (ts >= now30d) month++;
    }
    const avgWeekly = month > 0 ? month / 4 : 0;
    const vel = computeVelocity(week, avgWeekly);
    const corr = corroborationScore(cluster.sources);
    clusterMetrics.set(cluster.id, { velocity: vel, corroboration: corr });
  }

  // Category creation score per cluster
  const clusterCategoryScores = new Map<number, number>();
  for (const cluster of clusters) {
    const toolsBySource = new Map<string, number>();
    for (const src of cluster.sources) {
      toolsBySource.set(src, (toolsBySource.get(src) ?? 0) + 1);
    }
    const tools = Array.from(toolsBySource.entries()).map(([id, engagement]) => ({ id, engagement }));
    const fragmentation = computeToolFragmentation(tools);

    const investorSources = ['yc_companies', 'producthunt', 'crunchbase'];
    const investorCounts = new Map<string, number>();
    for (const s of cluster.sources) {
      if (investorSources.includes(s)) {
        investorCounts.set(s, (investorCounts.get(s) ?? 0) + 1);
      }
    }
    const attention = computeInvestorAttention(
      Array.from(investorCounts.entries()).map(([source, count]) => ({ source, count }))
    );

    const catScore = categoryCreationScore({
      vocabularyScore: cluster.totalCount > 5 ? 40 : 0,
      fragmentationScore: fragmentation.score,
      investorScore: attention.score,
    });
    clusterCategoryScores.set(cluster.id, catScore);
  }

  // Supply/demand imbalance per cluster
  const clusterImbalance = new Map<number, string>();
  const supplySources = new Set(['producthunt', 'alternativeto', 'github_issues', 'npm_trends']);
  for (const cluster of clusters) {
    const clusterSignalIds = new Set(cluster.representatives.map(r => r.signal_id));
    const matchedSignals = recentSignals.filter(s => clusterSignalIds.has(s.signal_id));
    const supplySignals = matchedSignals.filter(s => supplySources.has(s.source));
    const supply = estimateSupply({
      existingProducts: supplySignals.filter(s => s.source === 'producthunt' || s.source === 'alternativeto').length,
      githubRepos: supplySignals.filter(s => s.source === 'github_issues').length,
      fundedCompanies: supplySignals.filter(s => s.source === 'yc_companies').length,
    });
    const classification = classifyImbalance({ demandSignals: matchedSignals.length, totalSupply: supply.totalSupply });
    clusterImbalance.set(cluster.id, classification);
  }

  // CUSUM change point detection on daily signal counts per topic
  const cusumConfig = { threshold: deps.cusumThreshold ?? 5, drift: deps.cusumDrift ?? 1 };
  const topicAccelerating = new Set<string>();
  const topicDailyCounts = new Map<string, Map<string, number>>();
  for (const signal of recentSignals) {
    const day = signal.observed_at.slice(0, 10);
    const topic = signal.topic;
    if (!topicDailyCounts.has(topic)) topicDailyCounts.set(topic, new Map());
    const dayCounts = topicDailyCounts.get(topic)!;
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  for (const [topic, dayCounts] of topicDailyCounts) {
    const sortedDays = Array.from(dayCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const values = sortedDays.map(([, count]) => count);
    if (values.length >= 3) {
      const changePoints = detectChangePoints(values, cusumConfig);
      if (changePoints.some(cp => cp >= values.length - 2)) {
        topicAccelerating.add(topic);
      }
    }
  }

  await log.info('agent_runner', 'clustering complete', {
    signal_count: recentSignals.length,
    clusterable: clusterableSignals.length,
    cluster_count: clusters.length,
    thesis_count: allTheses.length,
    top_clusters: clusters.slice(0, 5).map((c) => c.label)
  });

  // Load trend windows
  const trendSummary = deps.memoryStore
    ? (await deps.memoryStore.retriever.getTrendWindows({
        topic: 'general',
        source: 'all',
        canonicalText: ''
      })).map((tw) => ({
        topic: tw.topic,
        window: tw.window,
        count: tw.count_signals,
        avg_demand: tw.avg_demand,
        growth: tw.count_signals > 0 ? 'active' : 'none'
      }))
    : [];

  // Load recent journal entries
  const recentJournal = deps.journalStore
    ? await deps.journalStore.recent(5)
    : [];

  // === Phase 1: Broad Scan ===
  // Cap clusters by signal count (largest first) to keep prompt within timeout budget
  const topClusters = clusters
    .slice()
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, maxClusters);

  await log.info('agent_runner', 'cluster cap applied', {
    total_clusters: clusters.length,
    sent_to_ai: topClusters.length,
    dropped: clusters.length - topClusters.length
  });

  const broadCtx = {
    activeTheses,
    clusters: topClusters.map((c) => ({
      id: c.id,
      label: c.label,
      totalCount: c.totalCount,
      avgDemand: c.avgDemand,
      avgTiming: c.avgTiming,
      sources: c.sources,
      signals: c.representatives.map((s) => ({
        signal_id: s.signal_id,
        text: s.canonical_text,
        source: s.source,
        demand: s.demand,
        timing: s.timing,
        virality: s.virality
      }))
    })),
    recentJournal: recentJournal.map((j) => ({
      entry_type: j.entry_type,
      topic: j.topic,
      insight: j.insight,
      narrative: j.narrative,
      created_at: j.created_at ?? ''
    })),
    trendSummary
  };

  const broadPrompt = buildBroadScanPrompt(broadCtx, profile);

  await log.info('agent_runner', 'broad scan started', {
    cluster_count: clusters.length,
    thesis_count: activeTheses.length,
    signal_count: recentSignals.length
  });
  await log.debug('agent_runner', 'broad scan prompt sent', {
    provider: preferred,
    prompt_length: broadPrompt.length,
    prompt_preview: broadPrompt.slice(0, 300)
  });
  const broadResult = await dualAnalystRun<BroadScanOutput>(
    { prompt: broadPrompt, timeoutMs: timeoutMs },
    {
      runClaude: deps.runClaude,
      runCodex: deps.runCodex,
      parseResponse: (text) => {
        const parsed = parseBroadScanResponse(text);
        if (!parsed) throw new Error('Failed to parse broad scan response');
        return parsed;
      },
      preferred,
      ...(deps.logger ? { logger: deps.logger } : {})
    }
  );

  const broadOutput = pickPreferred(broadResult, preferred);

  await log.info('agent_runner', 'broad scan complete', {
    has_output: !!broadOutput,
    provider: resolveUsedProvider(broadResult, preferred) ?? 'none',
    updates: broadOutput?.thesis_updates?.length ?? 0,
    observations: broadOutput?.observations?.length ?? 0,
    dig_deeper: broadOutput?.dig_deeper?.length ?? 0
  });

  // Apply broad scan thesis updates
  if (broadOutput) {
    for (const update of broadOutput.thesis_updates) {
      const existing = await deps.thesisStore.getByKey(update.canonicalKey);
      if (existing) {
        const delta = clampDelta(update.confidence_delta);
        const newConfidence = Math.max(0, Math.min(100, existing.confidence + delta));
        const newStatus = newConfidence >= 80 ? 'promoted' : newConfidence >= 55 ? 'watching' : existing.status;
        await deps.thesisStore.upsert({ ...existing, confidence: newConfidence, status: newStatus });
        thesesUpdated++;
        await log.info('agent_runner', 'thesis updated', {
          key: update.canonicalKey,
          old_confidence: existing.confidence,
          new_confidence: newConfidence,
          delta,
          status: newStatus
        });
        if (newConfidence >= 80 && existing.confidence < 80) {
          allAlerts.push(update.canonicalKey);
        }
      }
    }

    // Collect broad scan observations as journal entries
    for (const obs of broadOutput.observations) {
      allJournalEntries.push({
        run_id: runId,
        entry_type: sanitizeEntryType(obs.entry_type),
        topic: obs.topic,
        insight: obs.insight,
        narrative: obs.narrative,
        confidence: 50,
        thesis_keys: [],
        signal_ids: [],
        embedding: null
      });
    }
  }

  // === Phase 1.5: Adversarial Debate on top theses ===
  const debateThreshold = deps.debateConfidenceThreshold ?? 40;
  const debateMax = deps.debateMaxPerRun ?? 5;
  const debateCandidates = (await deps.thesisStore.list())
    .filter(t => t.confidence >= debateThreshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, debateMax);

  const debateResults: Array<{ thesisKey: string; result: DebateResult }> = [];

  for (let di = 0; di < debateCandidates.length; di++) {
    const thesis = debateCandidates[di];
    try {
      const evidence = thesis.evidence.map(e => e.snippet).filter(Boolean);
      const useClaude = di % 2 === 0;
      const result = await runDebate({
        thesisTitle: thesis.title,
        thesisKey: thesis.canonicalKey,
        problemStatement: thesis.problemStatement,
        evidence,
        runBull: useClaude ? deps.runClaude : deps.runCodex,
        runBear: useClaude ? deps.runCodex : deps.runClaude,
        runModerator: deps.runClaude,
      });

      if (result) {
        debateResults.push({ thesisKey: thesis.canonicalKey, result });

        // Apply Bayesian update based on verdict
        const lr = verdictToLikelihoodRatio(result.verdict.verdict);
        const evidenceType = lr >= 1.5 ? 'multi_source_convergence' as const
          : lr >= 1.0 ? 'single_high_quality' as const
          : 'weak_noisy' as const;
        const newConf = bayesianUpdate(thesis.confidence, { type: evidenceType, confirming: lr >= 1.0, sourceCount: 1 });
        const delta = newConf - thesis.confidence;
        if (deps.thesisStore.bayesianUpdate && Math.abs(delta) > 0.1) {
          await deps.thesisStore.bayesianUpdate(thesis.canonicalKey, delta);
        }

        // Store debate transcript
        if (deps.pool) {
          await deps.pool.query(
            `INSERT INTO thesis_debates (thesis_key, run_id, bull_provider, bear_provider, bull_case, bear_case, moderator_verdict)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [thesis.canonicalKey, runId, result.bullProvider, result.bearProvider,
             result.bullCase, result.bearCase, JSON.stringify(result.verdict)]
          );
        }

        await log.info('agent_runner', 'debate completed', {
          thesis: thesis.canonicalKey,
          verdict: result.verdict.verdict,
          delta: Math.round(delta * 10) / 10,
        });
      }
    } catch (err) {
      await log.warn('agent_runner', 'debate failed', { thesis: thesis.canonicalKey, error: String(err) });
    }
  }

  // === Phase 2: Deep Dives ===
  const digTopics = broadOutput?.dig_deeper?.slice(0, MAX_DEEP_DIVES) ?? [];
  let deepDivesPerformed = 0;

  for (const dig of digTopics) {
    investigateNext = dig.topic;

    await log.info('agent_runner', 'deep dive started', {
      topic: dig.topic,
      reason: dig.reason,
      related_clusters: dig.related_cluster_ids?.length ?? 0
    });

    // Gather current cluster signals for this topic
    const relatedClusters = clusters.filter((c) =>
      dig.related_cluster_ids?.includes(c.id)
    );
    const currentSignals = relatedClusters
      .flatMap((c) => c.representatives)
      .map((s) => ({
        signal_id: s.signal_id,
        text: s.canonical_text,
        source: s.source,
        demand: s.demand,
        timing: s.timing,
        virality: s.virality
      }));

    // Similarity search for historical signals
    let historicalSignals: { signal_id: string; text: string; source: string; demand: number; timing: number; virality?: number }[] = [];
    if (deps.memoryStore && deps.embedText) {
      const topicEmbedding = await deps.embedText(dig.topic);
      if (topicEmbedding) {
        const similar = await deps.memoryStore.retriever.findSimilar({
          topic: dig.topic,
          source: 'all',
          canonicalText: dig.topic,
          topK: 20
        });
        historicalSignals = similar.map((s) => ({
          signal_id: s.signal_id,
          text: s.canonical_text,
          source: s.source,
          demand: s.demand,
          timing: s.timing
        }));
      }
    }

    // Search journal for past insights on this topic
    let journalHistory = recentJournal; // fallback to recent
    if (deps.journalStore && deps.embedText) {
      const topicEmbedding = await deps.embedText(dig.topic);
      if (topicEmbedding) {
        journalHistory = await deps.journalStore.findSimilar(topicEmbedding, 10);
      }
    }

    // Related theses
    const relatedTheses = activeTheses.filter((t) =>
      t.title.toLowerCase().includes(dig.topic.toLowerCase()) ||
      dig.topic.toLowerCase().includes(t.title.toLowerCase().split(' ')[0] ?? '')
    );

    const diveCtx = {
      topic: dig.topic,
      reason: dig.reason,
      currentSignals,
      historicalSignals,
      journalHistory: journalHistory.map((j) => ({
        entry_type: j.entry_type,
        topic: j.topic,
        insight: j.insight,
        narrative: j.narrative,
        created_at: j.created_at ?? ''
      })),
      relatedTheses
    };

    const divePrompt = buildDeepDivePrompt(diveCtx, profile);
    await log.debug('agent_runner', 'deep dive prompt sent', {
      topic: dig.topic,
      provider: preferred,
      prompt_length: divePrompt.length,
      prompt_preview: divePrompt.slice(0, 300)
    });
    const diveResult = await dualAnalystRun<DeepDiveOutput>(
      { prompt: divePrompt, timeoutMs: timeoutMs },
      {
        runClaude: deps.runClaude,
        runCodex: deps.runCodex,
        parseResponse: (text) => {
          const parsed = parseDeepDiveResponse(text);
          if (!parsed) throw new Error('Failed to parse deep dive response');
          return parsed;
        },
        preferred,
        ...(deps.logger ? { logger: deps.logger } : {})
      }
    );

    const diveOutput = pickPreferred(diveResult, preferred);

    await log.info('agent_runner', 'deep dive complete', {
      topic: dig.topic,
      has_output: !!diveOutput,
      new_theses: diveOutput?.new_theses?.length ?? 0,
      updates: diveOutput?.thesis_updates?.length ?? 0
    });

    if (diveOutput) {
      // Apply deep dive thesis updates
      for (const update of diveOutput.thesis_updates) {
        const existing = await deps.thesisStore.getByKey(update.canonicalKey);
        if (existing) {
          const delta = clampDelta(update.confidence_delta);
          const newConfidence = Math.max(0, Math.min(100, existing.confidence + delta));
          const newStatus = newConfidence >= 80 ? 'promoted' : newConfidence >= 55 ? 'watching' : existing.status;
          await deps.thesisStore.upsert({ ...existing, confidence: newConfidence, status: newStatus });
          thesesUpdated++;
          if (newConfidence >= 80 && existing.confidence < 80) {
            allAlerts.push(update.canonicalKey);
          }
        }
      }

      // Create new thesis candidates from deep dive (with dedup)
      for (const proposal of diveOutput.new_theses) {
        // Dedup: skip if an existing thesis has >60% word overlap
        const duplicate = allTheses.find((t) => titleOverlap(t.title, proposal.title) > 0.6);
        if (duplicate) {
          // Boost existing thesis confidence instead
          const newConf = Math.min(100, duplicate.confidence + 5);
          await deps.thesisStore.upsert({ ...duplicate, confidence: newConf });
          thesesUpdated++;
          await log.info('agent_runner', 'dedup skipped', {
            duplicate_title: proposal.title,
            existing_key: duplicate.canonicalKey
          });
          continue;
        }

        const evidence: ThesisEvidenceDraft[] = proposal.supporting_signal_ids.map((id) => ({
          signal_id: id,
          relation: 'supporting' as const,
          weight: 1,
          snippet: '',
          observed_at: new Date().toISOString()
        }));

        const key = `${profile.id}:${proposal.title.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
        await deps.thesisStore.upsert({
          canonicalKey: key,
          title: proposal.title,
          topic: 'agent_generated',
          status: 'candidate',
          confidence: 45,
          scoreTotal: 45,
          problemStatement: proposal.problem_statement,
          targetBuyer: proposal.target_buyer,
          proposedSolution: proposal.proposed_solution,
          evidenceCount: proposal.supporting_signal_ids.length,
          avgDemand: 50,
          avgTiming: 50,
          avgBuildability: 50,
          avgVirality: 0,
          latestObservedAt: new Date().toISOString(),
          evidence,
          estimatedScope: proposal.estimated_scope ?? null,
          profileId: profile.id
        });
        newCandidates++;
        await log.info('agent_runner', 'thesis created', {
          title: proposal.title,
          key,
          confidence: 45,
          scope: proposal.estimated_scope ?? null
        });
      }

      // Collect deep dive journal entries
      for (const entry of diveOutput.journal_entries) {
        allJournalEntries.push({
          run_id: runId,
          entry_type: sanitizeEntryType(entry.entry_type),
          topic: entry.topic,
          insight: entry.insight,
          narrative: entry.narrative,
          confidence: entry.confidence,
          thesis_keys: entry.thesis_keys,
          signal_ids: entry.signal_ids,
          embedding: null
        });
      }
    }

    deepDivesPerformed++;
  }

  // === Enrich all theses with velocity and corroboration from cluster data ===
  if (clusters.length > 0) {
    const allThesesNow = await deps.thesisStore.list();
    let enriched = 0;
    for (const thesis of allThesesNow) {
      // Find the best matching cluster by checking if cluster representatives overlap with thesis evidence signals
      // Fallback: use the most recent cluster metrics globally
      let bestMetrics: { velocity: number; corroboration: number } | undefined;

      // Match thesis to cluster via signal overlap with representatives
      for (const cluster of clusters) {
        const repIds = new Set(cluster.representatives.map((r) => r.signal_id));
        const hasOverlap = thesis.evidence.some((e) => repIds.has(e.signal_id));
        if (hasOverlap) {
          bestMetrics = clusterMetrics.get(cluster.id);
          break;
        }
      }

      // Fallback: compute from cluster sources that mention similar topics
      if (!bestMetrics) {
        const matchingCluster = clusters.find((c) =>
          c.label.toLowerCase().includes(thesis.topic.toLowerCase()) ||
          thesis.title.toLowerCase().includes(c.label.toLowerCase().split(' ')[0])
        );
        if (matchingCluster) {
          bestMetrics = clusterMetrics.get(matchingCluster.id);
        }
      }

      if (bestMetrics) {
        // Boost velocity if CUSUM detected acceleration (don't mutate shared map entry)
        const velocity = topicAccelerating.has(thesis.topic)
          ? Math.min(10, bestMetrics.velocity * 1.5)
          : bestMetrics.velocity;
        await deps.thesisStore.upsert({
          ...thesis,
          velocity: Math.round(velocity * 100) / 100,
          corroborationScore: Math.round(bestMetrics.corroboration * 100) / 100,
        });
        enriched++;
      }
    }
    if (enriched > 0) {
      await log.info('agent_runner', 'theses enriched with velocity/corroboration', { enriched, total: allThesesNow.length });
    }
  }

  // === Phase 3: Commit journal entries ===

  // Add run summary
  allJournalEntries.push({
    run_id: runId,
    entry_type: 'run_summary',
    topic: 'general',
    insight: `Analyzed ${clusters.length} clusters (${clusterableSignals.length} signals), updated ${thesesUpdated} theses, created ${newCandidates} new candidates, performed ${deepDivesPerformed} deep dives, ${debateResults.length} debates.`,
    narrative: investigateNext ? `Next investigation: ${investigateNext}` : null,
    confidence: 50,
    thesis_keys: [],
    signal_ids: [],
    embedding: null
  });

  // Embed and write journal entries
  if (deps.journalStore) {
    if (deps.embedText) {
      for (const entry of allJournalEntries) {
        const text = `${entry.topic}: ${entry.insight}`;
        entry.embedding = await deps.embedText(text).catch(() => null);
      }
    }
    await deps.journalStore.write(allJournalEntries);
  }

  const provider = resolveUsedProvider(broadResult, preferred);

  return {
    thesesUpdated,
    newCandidates,
    alerts: allAlerts,
    investigateNext,
    journalEntriesWritten: allJournalEntries.length,
    clustersAnalyzed: clusters.length,
    deepDivesPerformed,
    debatesPerformed: debateResults.length,
    provider
  };
};

