-- 0024_knowledge_graph.sql
-- Entity-relationship knowledge graph for multi-hop opportunity reasoning

CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pain_point', 'technology', 'market', 'competitor', 'trend')),
  name TEXT NOT NULL,
  description TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  mention_count INTEGER DEFAULT 1,
  embedding VECTOR(768),
  UNIQUE(entity_type, name)
);

CREATE TABLE IF NOT EXISTS entity_relations (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'causes', 'enables', 'competes_with', 'addresses', 'depends_on', 'part_of'
  )),
  confidence REAL DEFAULT 0.5,
  evidence_signal_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_entity_id, target_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_embed ON entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_entity_relations_source ON entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_target ON entity_relations(target_entity_id);
