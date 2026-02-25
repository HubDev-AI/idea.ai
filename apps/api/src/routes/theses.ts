import type { FastifyInstance } from 'fastify';
import type { ThesisStatus } from '../jobs/thesis_synthesizer';

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

export const registerThesesRoute = (
  app: FastifyInstance,
  deps: {
    listTheses: () => Promise<ThesisRecord[]>;
    getThesis: (id: number) => Promise<ThesisDetail | null>;
  }
): void => {
  app.get('/v1/theses', async () => deps.listTheses());

  app.get('/v1/theses/:id', async (request, reply) => {
    const id = Number((request.params as { id?: string }).id ?? NaN);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'Invalid thesis id' };
    }

    const thesis = await deps.getThesis(id);
    if (!thesis) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    return thesis;
  });
};

