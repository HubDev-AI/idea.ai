import type { ThesisPage } from '@idea/contracts/src/api';
import type { Pool } from 'pg';
import type { ThesisDraft } from '../jobs/thesis_synthesizer';
import type { ThesisStore, ThesisStoreFilter } from './thesis_store';

type ThesisRow = {
  canonical_key: string;
  title: string;
  topic: string;
  status: string;
  confidence: string | number;
  problem_statement: string;
  target_buyer: string;
  proposed_solution: string;
  estimated_scope: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  evidence_count: number;
  source_count: number;
  avg_demand: number | string;
  avg_timing: number | string;
  avg_buildability: number | string;
  avg_virality: number | string;
  profile_id: string;
};

const toNumber = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const validScopes = new Set(['small', 'medium', 'large']);
const toScope = (v: unknown): ThesisDraft['estimatedScope'] => {
  const s = String(v ?? '');
  return validScopes.has(s) ? (s as 'small' | 'medium' | 'large') : null;
};

const rowToDraft = (row: ThesisRow): ThesisDraft & { sourceCount: number } => ({
  canonicalKey: row.canonical_key,
  title: row.title,
  topic: row.topic,
  status: row.status as ThesisDraft['status'],
  confidence: toNumber(row.confidence),
  scoreTotal: toNumber(row.confidence),
  problemStatement: row.problem_statement,
  targetBuyer: row.target_buyer,
  proposedSolution: row.proposed_solution,
  evidenceCount: toNumber(row.evidence_count),
  sourceCount: toNumber(row.source_count),
  avgDemand: toNumber(row.avg_demand),
  avgTiming: toNumber(row.avg_timing),
  avgBuildability: toNumber(row.avg_buildability),
  avgVirality: toNumber(row.avg_virality),
  latestObservedAt: new Date(row.last_seen_at).toISOString(),
  evidence: [],
  estimatedScope: toScope(row.estimated_scope),
  profileId: row.profile_id ?? 'consumer'
});

export type ThesisSortField = 'score' | 'latest' | 'evidence' | 'newest';

export type PaginatedThesisStore = ThesisStore & {
  listPaginated(params: { page?: number; pageSize?: number; status?: string; sort?: ThesisSortField; profile?: string }): Promise<ThesisPage>;
  close: () => Promise<void>;
};

export const createPostgresThesisStore = ({ pool }: { pool: Pool }): PaginatedThesisStore => ({
  async list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]> {
    const where = filter?.status ? 'WHERE status = $1' : '';
    const params = filter?.status ? [filter.status] : [];
    const sql = `
      SELECT tc.*, COUNT(DISTINCT te.signal_id)::int AS evidence_count,
             COUNT(DISTINCT sm.source)::int AS source_count,
             ROUND(COALESCE(AVG(sm.demand), 0))::int AS avg_demand,
             ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
             ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability,
             ROUND(COALESCE(AVG(sm.virality), 0))::int AS avg_virality
      FROM thesis_candidates tc
      LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
      LEFT JOIN signal_memory sm ON sm.signal_id = te.signal_id
      ${where}
      GROUP BY tc.id
      ORDER BY tc.confidence DESC
    `;
    const result = await pool.query<ThesisRow>(sql, params);
    return result.rows.map(rowToDraft);
  },

  async getByKey(canonicalKey: string): Promise<ThesisDraft | null> {
    const result = await pool.query<ThesisRow>(
      `SELECT tc.*, COUNT(DISTINCT te.signal_id)::int AS evidence_count,
              COUNT(DISTINCT sm.source)::int AS source_count,
              ROUND(COALESCE(AVG(sm.demand), 0))::int AS avg_demand,
              ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
              ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability,
              ROUND(COALESCE(AVG(sm.virality), 0))::int AS avg_virality
       FROM thesis_candidates tc
       LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
       LEFT JOIN signal_memory sm ON sm.signal_id = te.signal_id
       WHERE tc.canonical_key = $1
       GROUP BY tc.id`,
      [canonicalKey]
    );
    return result.rows[0] ? rowToDraft(result.rows[0]) : null;
  },

  async upsert(draft: ThesisDraft): Promise<void> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO thesis_candidates
        (canonical_key, title, topic, status, confidence, problem_statement,
         target_buyer, proposed_solution, estimated_scope, profile_id, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (canonical_key) DO UPDATE SET
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         confidence = EXCLUDED.confidence,
         problem_statement = EXCLUDED.problem_statement,
         target_buyer = EXCLUDED.target_buyer,
         proposed_solution = EXCLUDED.proposed_solution,
         estimated_scope = COALESCE(EXCLUDED.estimated_scope, thesis_candidates.estimated_scope),
         profile_id = EXCLUDED.profile_id,
         last_seen_at = NOW(),
         updated_at = NOW()
       RETURNING id`,
      [
        draft.canonicalKey, draft.title, draft.topic, draft.status,
        draft.confidence, draft.problemStatement,
        draft.targetBuyer, draft.proposedSolution,
        draft.estimatedScope ?? null,
        draft.profileId ?? 'consumer'
      ]
    );

    if (draft.evidence.length > 0 && result.rows[0]) {
      const thesisId = result.rows[0].id;
      for (const ev of draft.evidence) {
        await pool.query(
          `INSERT INTO thesis_evidence (thesis_id, signal_id, relation, weight, snippet, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (thesis_id, signal_id) DO UPDATE SET
             relation = EXCLUDED.relation,
             weight = EXCLUDED.weight,
             snippet = EXCLUDED.snippet,
             observed_at = EXCLUDED.observed_at`,
          [thesisId, ev.signal_id, ev.relation, ev.weight, ev.snippet, ev.observed_at]
        );
      }
    }
  },

  async listPaginated({ page = 1, pageSize = 10, status, sort = 'score', profile }: { page?: number; pageSize?: number; status?: string; sort?: ThesisSortField; profile?: string } = {}): Promise<ThesisPage> {
    const whereClauses: string[] = [];
    const countParams: (string | number)[] = [];
    if (status) {
      countParams.push(status);
      whereClauses.push(`status = $${countParams.length}`);
    }
    if (profile) {
      countParams.push(profile);
      whereClauses.push(`profile_id = $${countParams.length}`);
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countResult, statsResult] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM thesis_candidates ${where}`,
        countParams
      ),
      pool.query<{ total: string; promoted: string; watching: string; total_evidence: string; total_sources: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE status = 'promoted')::text AS promoted,
                COUNT(*) FILTER (WHERE status = 'watching')::text AS watching,
                COALESCE(SUM(ev_count), 0)::text AS total_evidence,
                COALESCE(SUM(src_count), 0)::text AS total_sources
         FROM (
           SELECT tc.status,
                  COUNT(DISTINCT te.signal_id) AS ev_count,
                  COUNT(DISTINCT sm.source) AS src_count
           FROM thesis_candidates tc
           LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
           LEFT JOIN signal_memory sm ON sm.signal_id = te.signal_id
           GROUP BY tc.id, tc.status
         ) sub`
      )
    ]);

    const totalItems = Number(countResult.rows[0]?.count ?? 0);
    const statsRow = statsResult.rows[0];
    const stats = {
      total: Number(statsRow?.total ?? 0),
      promoted: Number(statsRow?.promoted ?? 0),
      watching: Number(statsRow?.watching ?? 0),
      totalEvidence: Number(statsRow?.total_evidence ?? 0),
      totalSources: Number(statsRow?.total_sources ?? 0)
    };
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const offset = (safePage - 1) * pageSize;

    const params: (string | number)[] = [...countParams];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const sql = `
      SELECT tc.*, COUNT(DISTINCT te.signal_id)::int AS evidence_count,
             COUNT(DISTINCT sm.source)::int AS source_count,
             ROUND(COALESCE(AVG(sm.demand), 0))::int AS avg_demand,
             ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
             ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability,
             ROUND(COALESCE(AVG(sm.virality), 0))::int AS avg_virality,
             EXISTS(SELECT 1 FROM thesis_deep_dives dd WHERE dd.canonical_key = tc.canonical_key) AS has_deep_dive
      FROM thesis_candidates tc
      LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
      LEFT JOIN signal_memory sm ON sm.signal_id = te.signal_id
      ${where}
      GROUP BY tc.id
      ORDER BY ${sort === 'latest' ? 'tc.last_seen_at DESC' : sort === 'evidence' ? 'evidence_count DESC' : sort === 'newest' ? 'tc.first_seen_at DESC' : 'tc.confidence DESC'}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const result = await pool.query<ThesisRow & { has_deep_dive: boolean }>(sql, [...params, pageSize, offset]);
    const items = result.rows.map(rowToDraft);
    const deepDiveFlags = new Map(result.rows.map((r) => [r.canonical_key, r.has_deep_dive]));

    return {
      items: items.map((d) => ({
        canonicalKey: d.canonicalKey,
        title: d.title,
        confidence: d.confidence,
        status: d.status,
        evidenceCount: d.evidenceCount,
        problemStatement: d.problemStatement,
        sourceCount: (d as ReturnType<typeof rowToDraft>).sourceCount ?? 0,
        estimatedScope: d.estimatedScope ?? null,
        lastSeenAt: d.latestObservedAt ?? new Date().toISOString(),
        hasDeepDive: deepDiveFlags.get(d.canonicalKey) === true,
        profileId: (d as any).profileId ?? 'consumer'
      })),
      page: safePage,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: safePage < totalPages,
      has_prev: safePage > 1,
      stats
    };
  },

  async close(): Promise<void> {}
});
