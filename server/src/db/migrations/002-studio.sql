-- The app rebuilt (N1, 2026-11-24): brands and videos. Each video is a folder in ~/studio with its own Claude Code
-- session and a thread; notes are pinned to a moment of a version. No pages existed yet, so 001's tables go
-- (devices, pair codes and settings stay). Rules are files now (~/studio/CLAUDE.md, lessons.md, <brand>/CLAUDE.md).

DROP TABLE IF EXISTS drafts;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS renders;
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS inputs;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS claude_calls;
DROP TABLE IF EXISTS rules;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS pages;

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,        -- its folder: ~/studio/<slug>
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  slug TEXT NOT NULL,               -- its folder: ~/studio/<brand slug>/<slug>, fixed when it's made
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'auto',
  session_id TEXT,                  -- Claude Code's session for this video, resumed on every message
  approved_n INTEGER,
  posted_at INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  make_at_inputs INTEGER,           -- "Add & make": start Claude once this many files are in
  seen_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (brand_id, slug)
);

CREATE TABLE inputs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  role TEXT,
  name TEXT NOT NULL,               -- its file in the video's files/ folder
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha TEXT,
  meta TEXT,
  position REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX inputs_video ON inputs(video_id, position);

-- Resumable uploads (the phone's protocol: POST, then PATCH chunks from the offset the server reports).
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
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

-- What Claude saved for me to watch: renders/v<n>.mp4 (+ v<n>.jpg) or renders/v<n>/<k>.png in the video's folder.
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- video | carousel
  note TEXT NOT NULL DEFAULT '',
  duration REAL,
  width INTEGER,
  height INTEGER,
  slides INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (video_id, n)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version_n INTEGER NOT NULL,
  at REAL,                          -- seconds into that version
  slide INTEGER,                    -- 1-based, for carousels
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open, then sent (with Claude), then fixed
  fixed_in INTEGER,
  reply TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX notes_video ON notes(video_id, created_at);

-- The conversation with Claude, in order (rowid): my messages, Claude's, its steps and tool calls, questions,
-- versions, lessons.
CREATE TABLE thread (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  job_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX thread_video ON thread(video_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
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
CREATE INDEX jobs_video ON jobs(video_id, created_at);

-- What each Claude run cost, so the targets can be checked.
CREATE TABLE claude_calls (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  video_id TEXT,
  job_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
