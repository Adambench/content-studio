-- What each Claude run cost (2026-11-25): model round trips, the API-price estimate, its biggest and its last context
-- (what a resume would re-send), whether it started a new session, and the plan's 5-hour and weekly usage before and
-- after it (0..1, as last reported).

ALTER TABLE claude_calls ADD COLUMN turns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claude_calls ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE claude_calls ADD COLUMN peak_context INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claude_calls ADD COLUMN last_context INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claude_calls ADD COLUMN fresh INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claude_calls ADD COLUMN five_before REAL;
ALTER TABLE claude_calls ADD COLUMN five_after REAL;
ALTER TABLE claude_calls ADD COLUMN week_before REAL;
ALTER TABLE claude_calls ADD COLUMN week_after REAL;
CREATE INDEX IF NOT EXISTS claude_calls_video ON claude_calls (video_id, created_at);
