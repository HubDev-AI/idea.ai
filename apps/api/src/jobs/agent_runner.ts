import { dualAnalystRun } from '@idea/ai-runtime/src/dual_analyst';
import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { AgentRunResult } from '@idea/contracts/src/api';
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
import { type ClusterableSignal, clusterSignals } from './signal_clusterer';
import type { ThesisEvidenceDraft } from './thesis_synthesizer';

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
};

const MAX_DEEP_DIVES = 2;
const AGENT_TIMEOUT_MS = 60_000;

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

export const runResearchAgent = async (deps: AgentRunnerDeps): Promise<AgentRunResult> => {
  const log = deps.logger ?? noopLogger;
  const runId = deps.runId ?? `agent-${Date.now()}`;
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
    const embeddingRows = await loadEmbeddings(deps.memoryStore, signalIds);

    clusterableSignals = recentSignals
      .filter((s) => embeddingRows.has(s.signal_id))
      .map((s) => ({
        signal_id: s.signal_id,
        canonical_text: s.canonical_text,
        source: s.source,
        demand: s.demand,
        timing: s.timing,
        blended: s.blended,
        embedding: embeddingRows.get(s.signal_id)!
      }));
  }

  const clusters = clusterSignals(clusterableSignals);

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
  const broadCtx = {
    activeTheses,
    clusters: clusters.map((c) => ({
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
        timing: s.timing
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

  await log.info('agent_runner', 'broad scan started', { cluster_count: clusters.length });

  const broadPrompt = buildBroadScanPrompt(broadCtx);
  const broadResult = await dualAnalystRun<BroadScanOutput>(
    { prompt: broadPrompt, timeoutMs: AGENT_TIMEOUT_MS },
    {
      runClaude: deps.runClaude,
      runCodex: deps.runCodex,
      parseResponse: (text) => {
        const parsed = parseBroadScanResponse(text);
        if (!parsed) throw new Error('Failed to parse broad scan response');
        return parsed;
      },
      ...(deps.logger ? { logger: deps.logger } : {})
    }
  );

  const broadOutput = broadResult.claude ?? broadResult.codex;

  await log.info('agent_runner', 'broad scan complete', {
    has_output: !!broadOutput,
    provider: broadResult.claude ? 'claude' : broadResult.codex ? 'codex' : 'none',
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
        timing: s.timing
      }));

    // Similarity search for historical signals
    let historicalSignals: { signal_id: string; text: string; source: string; demand: number; timing: number }[] = [];
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

    const divePrompt = buildDeepDivePrompt(diveCtx);
    const diveResult = await dualAnalystRun<DeepDiveOutput>(
      { prompt: divePrompt, timeoutMs: AGENT_TIMEOUT_MS },
      {
        runClaude: deps.runClaude,
        runCodex: deps.runCodex,
        parseResponse: (text) => {
          const parsed = parseDeepDiveResponse(text);
          if (!parsed) throw new Error('Failed to parse deep dive response');
          return parsed;
        },
        ...(deps.logger ? { logger: deps.logger } : {})
      }
    );

    const diveOutput = diveResult.claude ?? diveResult.codex;

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

        const key = `agent:${proposal.title.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
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
          estimatedScope: proposal.estimated_scope ?? null
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

  // === Phase 3: Commit journal entries ===

  // Add run summary
  allJournalEntries.push({
    run_id: runId,
    entry_type: 'run_summary',
    topic: 'general',
    insight: `Analyzed ${clusters.length} clusters (${clusterableSignals.length} signals), updated ${thesesUpdated} theses, created ${newCandidates} new candidates, performed ${deepDivesPerformed} deep dives.`,
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

  return {
    thesesUpdated,
    newCandidates,
    alerts: allAlerts,
    investigateNext,
    journalEntriesWritten: allJournalEntries.length,
    clustersAnalyzed: clusters.length,
    deepDivesPerformed
  };
};

async function loadEmbeddings(
  memoryStore: PostgresMemoryStore,
  signalIds: string[]
): Promise<Map<string, number[]>> {
  return memoryStore.getEmbeddings(signalIds);
}
