-- focal v2 schema (docs/spec.md §4.5).

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  auth_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- One row per profile entry; `data` holds the full core ProfileEntry.
CREATE TABLE profile_entries (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('thing', 'vibe', 'rule')),
  qloo_id text NOT NULL,
  strength text NOT NULL CHECK (strength IN ('love', 'like', 'dislike', 'never')),
  status text CHECK (status IN ('pending', 'active')),
  source text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'rule') = (strength = 'never')),
  CHECK ((kind = 'rule') = (status IS NOT NULL)),
  UNIQUE (user_id, kind, qloo_id)
);

CREATE TABLE activity_events (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor text NOT NULL,
  action text NOT NULL CHECK (action IN ('add', 'remove', 'change', 'approve', 'undo')),
  entry_id text NOT NULL,
  before jsonb,
  after jsonb,
  undoes text REFERENCES activity_events (id) ON DELETE SET NULL,
  undone_by text REFERENCES activity_events (id) ON DELETE SET NULL,
  at timestamptz NOT NULL
);
CREATE INDEX activity_events_user_at ON activity_events (user_id, at DESC);

CREATE TABLE site_settings (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  hostname text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('skip', 'off', 'on')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hostname)
);

-- Shared across users: structure only, never page content.
CREATE TABLE layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL,
  path_pattern text NOT NULL,
  fingerprint text NOT NULL,
  name_position jsonb NOT NULL,
  type text NOT NULL,
  city_source jsonb,
  confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  learned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hostname, path_pattern, fingerprint)
);

-- Shared across users. city = '' when the type has no city context.
CREATE TABLE resolution_cache (
  normalized_name text NOT NULL,
  type text NOT NULL,
  city text NOT NULL DEFAULT '',
  entity_id text,
  status text NOT NULL,
  entity jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (normalized_name, type, city)
);

-- Backs /why/<id>; rows expire after 24 h.
CREATE TABLE page_results (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  hostname text NOT NULL,
  status text NOT NULL,
  items jsonb NOT NULL,
  plan jsonb,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX page_results_expires_at ON page_results (expires_at);
CREATE INDEX page_results_user_created ON page_results (user_id, created_at DESC);
