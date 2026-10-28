ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX IF NOT EXISTS activity_events_user_seq ON activity_events (user_id, seq DESC);
