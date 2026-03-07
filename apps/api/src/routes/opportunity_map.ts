import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { OpportunityMapRecord, OpportunityNode } from '@idea/contracts/src/api';

export type OpportunityMapDeps = {
  pool: Pool;
};

export const registerOpportunityMapRoute = (
  app: FastifyInstance,
  deps: OpportunityMapDeps
): void => {
  app.get('/v1/opportunity-map', async (_request, reply) => {
    const { rows } = await deps.pool.query<{
      canonical_key: string;
      title: string;
      confidence: number;
      topic: string;
      velocity: number | null;
      evidence_count: number;
      problem_statement: string | null;
      status: string;
    }>(
      `SELECT tc.canonical_key, tc.title, tc.confidence, tc.topic,
              tc.velocity, tc.problem_statement, tc.status,
              COUNT(DISTINCT te.signal_id)::int AS evidence_count
       FROM thesis_candidates tc
       LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
       WHERE tc.status != 'rejected'
       GROUP BY tc.id
       ORDER BY tc.confidence DESC
       LIMIT 100`
    );

    const topicMap = new Map<string, OpportunityNode[]>();
    for (const row of rows) {
      const topic = row.topic || 'Uncategorized';
      if (!topicMap.has(topic)) topicMap.set(topic, []);
      topicMap.get(topic)!.push({
        id: row.canonical_key,
        label: row.title,
        type: 'thesis',
        confidence: Number(row.confidence),
        velocity: row.velocity ?? 0,
        supply: 0,
        demand: row.evidence_count,
        problemStatement: row.problem_statement ?? undefined,
        status: row.status,
      });
    }

    const roots: OpportunityNode[] = Array.from(topicMap.entries())
      .map(([topic, children]) => ({
        id: `market:${topic}`,
        label: topic,
        type: 'market' as const,
        confidence: Math.round(children.reduce((s, c) => s + c.confidence, 0) / children.length),
        velocity: Math.round(children.reduce((s, c) => s + c.velocity, 0) / children.length * 10) / 10,
        supply: 0,
        demand: children.reduce((s, c) => s + c.demand, 0),
        children: children.slice(0, 15),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    const map: OpportunityMapRecord = {
      roots,
      generatedAt: new Date().toISOString(),
    };

    return reply.send(map);
  });
};
