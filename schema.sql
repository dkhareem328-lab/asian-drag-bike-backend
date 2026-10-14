CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(24) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(32) NOT NULL,
  money INTEGER NOT NULL DEFAULT 2000000,
  reputation INTEGER NOT NULL DEFAULT 0,
  selected_bike VARCHAR(32) NOT NULL DEFAULT 'matic150',
  stats JSONB NOT NULL DEFAULT '{"races":0,"wins":0}'::jsonb
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code VARCHAR(8) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','racing','finished','cancelled')),
  distance INTEGER NOT NULL DEFAULT 201,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL CHECK (slot IN (1,2)),
  ready BOOLEAN NOT NULL DEFAULT false,
  finish_time NUMERIC(10,3),
  foul BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, slot)
);

CREATE INDEX IF NOT EXISTS matches_status_idx ON matches(status);
CREATE INDEX IF NOT EXISTS match_players_user_idx ON match_players(user_id);
