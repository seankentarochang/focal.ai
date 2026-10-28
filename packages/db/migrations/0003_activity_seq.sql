-- Deterministic seq for activity ordering. Backfill ordered by (at, id) so
-- the sequence always reproduces the same numbering for the same history.
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS seq bigint;
UPDATE activity_events t SET seq = s.rn
FROM (SELECT id, row_number() OVER (ORDER BY at, id) AS rn FROM activity_events) s
WHERE t.id = s.id AND t.seq IS NULL;
ALTER TABLE activity_events ALTER COLUMN seq SET NOT NULL;
ALTER TABLE activity_events ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('activity_events','seq'), GREATEST(COALESCE((SELECT max(seq) FROM activity_events), 0), 1));
CREATE INDEX IF NOT EXISTS activity_events_user_seq ON activity_events (user_id, seq DESC);
