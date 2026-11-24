-- The new app's first schema (2026-11-23). Times are milliseconds since 1970. JSON columns hold text.

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position REAL NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL,
  position REAL NOT NULL,
  recipe TEXT NOT NULL DEFAULT 'auto',
  script TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  labels TEXT NOT NULL DEFAULT '{}',
  caption TEXT NOT NULL DEFAULT '',
  stage_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX cards_board ON cards(page_id, stage, position);

-- Script and notes as they were before a change by the other author (Claude's draft, my edit), newest first.
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  script TEXT NOT NULL,
  notes TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX drafts_card ON drafts(card_id, created_at);

CREATE TABLE inputs (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  role TEXT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  file TEXT NOT NULL,
  sha TEXT,
  meta TEXT,
  position REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX inputs_card ON inputs(card_id, position);

-- Resumable uploads (the phone's protocol: POST, then PATCH chunks from the offset the server reports).
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  role TEXT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL,
  input_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  recipe TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '{}',
  project TEXT,
  slides INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (card_id, n)
);

CREATE TABLE renders (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  file TEXT,
  poster TEXT,
  duration REAL,
  width INTEGER,
  height INTEGER,
  error TEXT,
  job_id TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX renders_card ON renders(card_id, created_at);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  render_id TEXT REFERENCES renders(id) ON DELETE SET NULL,
  version_id TEXT REFERENCES versions(id) ON DELETE SET NULL,
  at REAL,
  end_at REAL,
  slide INTEGER,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  rule_id TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX comments_card ON comments(card_id, created_at);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  format TEXT,
  source TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  check_id TEXT,
  status TEXT NOT NULL DEFAULT 'on',
  locked INTEGER NOT NULL DEFAULT 0,
  taught INTEGER NOT NULL DEFAULT 1,
  seed_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT '{}',
  step TEXT,
  progress REAL NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  run_after INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX jobs_status ON jobs(status, run_after);
CREATE INDEX jobs_card ON jobs(card_id, created_at);

-- What each Claude call cost, by task, so the targets can be checked.
CREATE TABLE claude_calls (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  card_id TEXT,
  job_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Phones and the terminal paired with a one-time code (Tailscale's identity is enough on the tailnet; the token is
-- what the Android app's upload queue sends).
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE pair_codes (
  code TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
