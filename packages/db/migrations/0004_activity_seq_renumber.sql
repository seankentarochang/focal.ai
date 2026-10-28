-- Renumber activity_events.seq deterministically by (at, id). The 0003
-- backfill ran on rows that had no stable order; recompute it the same way
-- the rewritten 0003 does on fresh schemas. Safe on empty and populated DBs.
ALTER TABLE activity_events ALTER COLUMN seq DROP IDENTITY IF EXISTS;
UPDATE activity_events t SET seq = s.rn
FROM (SELECT id, row_number() OVER (ORDER BY at, id) AS rn FROM activity_events) s
WHERE t.id = s.id;
ALTER TABLE activity_events ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('activity_events','seq'), GREATEST(COALESCE((SELECT max(seq) FROM activity_events), 0), 1), (SELECT max(seq) FROM activity_events) IS NOT NULL);
