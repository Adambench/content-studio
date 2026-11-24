-- Brands are called pages (2026-11-24: an Instagram account, my word for it). Same rows, same folders.
-- A page is set up in its own studio: a row in videos with kind 'page' (its folder: ~/studio/<page>/setup).
-- make_prompt: what Claude is told once the files I'm sending are in ("Add & make", a new page with samples).

ALTER TABLE brands RENAME TO pages;
ALTER TABLE videos RENAME COLUMN brand_id TO page_id;
ALTER TABLE videos ADD COLUMN make_prompt TEXT;
