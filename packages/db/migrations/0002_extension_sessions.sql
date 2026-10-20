-- Extension sessions (P-02): opaque, revocable tokens the website hands the
-- extension after sign-in. Only a SHA-256 hash of the token is stored.
CREATE TABLE extension_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX extension_sessions_user ON extension_sessions (user_id);
