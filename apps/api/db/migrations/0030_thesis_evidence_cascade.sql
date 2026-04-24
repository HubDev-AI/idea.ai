-- Thesis evidence must track scored_signals lifecycle. Before this migration
-- signal_id was a free-text column with no FK, so retention cleanup could
-- delete a scored_signals row while leaving thesis_evidence rows pointing at
-- a signal that no longer exists. This caused idea cards to report N
-- evidence/sources while the Signals tab showed nothing.

-- 1. Drop evidence rows whose scored_signal is already gone.
DELETE FROM thesis_evidence te
WHERE NOT EXISTS (
  SELECT 1 FROM scored_signals sm WHERE sm.signal_id = te.signal_id
);

-- 2. Install the FK with ON DELETE CASCADE so future retention cleanup
--    automatically removes orphaned evidence.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'thesis_evidence_signal_id_fkey'
      AND table_name = 'thesis_evidence'
  ) THEN
    ALTER TABLE thesis_evidence
      ADD CONSTRAINT thesis_evidence_signal_id_fkey
      FOREIGN KEY (signal_id)
      REFERENCES scored_signals(signal_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS thesis_evidence_signal_idx
  ON thesis_evidence (signal_id);
