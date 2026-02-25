import type { FastifyInstance } from 'fastify';
import type { ThesisStore } from '../runtime/thesis_store';
import type { ThesisDraft, ThesisEvidenceDraft, ThesisStatus } from '../jobs/thesis_synthesizer';

export type ThesisRecord = {
  id: number;
  canonical_key: string;
  title: string;
  topic: string;
  status: ThesisStatus;
  confidence: number;
  problem_statement: string;
  target_buyer: string;
  proposed_solution: string;
  evidence_count: number;
  last_seen_at: string;
  updated_at: string;
};

export type ThesisDetail = ThesisRecord & {
  evidence: Array<{
    signal_id: string;
    relation: 'supporting' | 'adjacent' | 'contradicting';
    weight: number;
    snippet: string;
    observed_at: string;
  }>;
  snapshots: Array<{
    run_id: string;
    score_total: number;
    evidence_count: number;
    avg_pain: number;
    avg_timing: number;
    avg_buildability: number;
    captured_at: string;
  }>;
};

export type ThesisListItem = ThesisDraft & { id: number };

export type ThesisDetailResponse = ThesisListItem & {
  evidence: ThesisEvidenceDraft[];
};

export const registerThesesRoute = (
  app: FastifyInstance,
  store: ThesisStore
): void => {
  app.get('/v1/theses', async () => {
    const drafts = await store.list();
    return drafts.map((draft, index) => ({ ...draft, id: index + 1 }));
  });

  app.get('/v1/theses/:id', async (request, reply) => {
    const id = Number((request.params as { id?: string }).id ?? NaN);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'Invalid thesis id' };
    }

    const drafts = await store.list();
    const draft = drafts[id - 1];
    if (!draft) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    return { ...draft, id };
  });
};
