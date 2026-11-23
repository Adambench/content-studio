# Content Studio — plan (the new app, 2026-11-23)

The old app (Phases 0–14, its PLAN.md and code) is in git history on `main` before this branch; nothing of it shapes
this one. "I" is me, the user. Decisions first, then how it's built, then the phases.

## Goal

I press **Make** and a ready-to-post, production-grade video (or carousel) lands in Review. Claude makes every
creative choice; mechanical tools do everything that can be measured; checks from my lessons and from what works in
the market hold the bar. I give raw material (takes, my voice, products) and taste (comments, Approve). Posting isn't
the app's job: it hands me the file and the caption.

## Decisions (2026-11-23)

| Topic | Decision |
|---|---|
| Machines | **ai-server** = the GTX 1070 PC (i7-7800X, 32 GB, 8 GB Pascal), on 24/7: engine, database, files, renders, the app. Laptop = Claude Code + the app in Chrome (no Electron). Phone = the Android app (same id and key), works with the laptop shut. Tailscale only |
| Formats | Daily episodes (mostly raw), UGC, Gentle Return faceless, ecom carousels, motion explainers, colour-graded shots. **No clipping** (no code, no data carried over) |
| One press | Each format is a recipe from what I give to a checked render in Review, with no step in between unless it needs me (film, record) |
| Claude | Agent SDK on my Pro login on ai-server, never an API key. Opus for every creative choice and review; a smaller model only for market read-outs. Background work waits while 5-hour usage ≥ 80 %; what I press and wait on never waits |
| Scripts | Claude drafts them in my voice, on every page; I edit, film or record. Hooks as options beside the script |
| Viral | Learned from the market: each page's niche watched daily, outliers (views far above the account's usual) broken down into patterns. Plus a base rulebook (fundamentals I don't have yet) and my lessons |
| Pictures | Nothing generated: my footage, free stock (Pexels, Pixabay), graphics drawn in code. Stock is halal-screened |
| Sound | SFX and ambience set per page (off / light / full), from recorded libraries; never music; a nasheed only vocal, only by my choice |
| Licences | Anything public is usable (2026-11-23). The Toolbox still notes each licence; it's not a blocker |
| Halal | Unchanged: no music or instruments in anything made (checked on every output); no women on camera (footage and stock screened); nothing haram shown or promoted; Gentle Return never shows my face, cites every ayah and hadith; nothing tied to another religion |
| UI | Dark, quiet, few words. Buttons only where they do big work: **Write**, **Hooks**, **Make**, **Fix**, **Approve**. No chat, no stats screens |
| Data | New app. Lessons and scripts imported if cheap; losing the rest is fine |

## Formats

| Format | Page | I give | The engine does | Out |
|---|---|---|---|---|
| Daily episode | Personal brand | takes filmed on the phone, screenshots as proof, a few notes about the day | drafts the script from my notes; picks the last clean take of each line; cuts in pauses; light, grade, voice clean-up; captions 2 words under the chin; tracker at the ends; proof on the words that point at it | 9:16 MP4 + caption |
| UGC | open | open (see *Waiting on me*) | script + shot list, then the edit: hook, product shots, text in my words, CTA | 9:16 MP4 |
| Gentle Return | Gentle Return | my voice reading Claude's script | script with checked ayat and hadith; stock visuals with no people; ayah and hadith cards; ambience; captions | 9:16 MP4 |
| Carousel | ecom brand | products (photos), or nothing | topic and copy from market patterns, layout in the brand kit, product cut-outs | 4:5 PNGs |
| Motion explainer | any | a topic (+ my voice, or text only) | script, scenes written as HyperFrames HTML, icons, Lottie, SFX on the motion, captions | 9:16 MP4 |
| Graded shots | any | footage | shot matching, a look, a film finish (grain, halation), stabilising, slow motion | graded clips or a reel |

## How it's built

```
phone (Android app) ──┐                      ┌── laptop: Claude Code (dev, `cs` commands), Chrome (the app)
                      └──── Tailscale HTTPS ─┘
                                 │
ai-server (1070 PC, 24/7) ───────┴──────────────────────────────────────────────
  app server (Node 24: API, the app, job queue, live events, push)
  SQLite (pages, cards, inputs, versions, renders, comments, rules, market) + files (media, projects, renders)
  engine: recipes (TypeScript) = steps, each step's output kept so a re-run skips what's done
    ├─ Claude (Agent SDK, Opus): write, plan, review, fix          one call per decision, small digests
    ├─ Python tools (uv envs): ASR, alignment, faces, OCR, voice clean-up, music check, segmentation
    ├─ FFmpeg (NVENC, libplacebo on Vulkan): cuts, reframe, grade, mix, encode
    └─ HyperFrames 0.9 (Chrome headless): overlays, scenes, captions, final render, `check`
  market collector (yt-dlp, instaloader on a separate account): daily, slow, randomised
```

**Steps of every video recipe**

1. **Look** (mechanical, cached per file): probe, constant-frame-rate proxy, transcript with word times aligned to
   the script, takes table (reps of each line; stumbles, fillers, false starts flagged), pauses, faces per frame as
   smooth tracks, light and colour, room noise, music check, the text in my screenshots (OCR), shot changes.
2. **Digest**: one short text per card for Claude (script lines × takes with flags, inputs in a line each, the page's
   rules, the market's patterns) and at most one small picture sheet per decision. Claude never reads raw
   transcripts, frames it doesn't need, or code.
3. **Plan** (Claude): a small structured plan per format, in words and ids, never in times or frames (line → take,
   punch-in words, what shows on which words, how it opens). The builder turns words into frames.
4. **Build**: the A-roll (FFmpeg: frame-exact cuts in pauses, reframe path, punch-ins, grade, voice chain), the
   overlays (HyperFrames: captions, house blocks, Claude's own scenes), the mix (voice, SFX, ambience).
5. **Render** on ai-server (NVENC).
6. **Check**, mechanical first, each one a lesson that can be measured: no music; −14 LUFS, peaks ≤ −1 dBTP;
   nothing on top of anything; text up long enough to read; captions off the face and inside the Reels safe zone; no
   flash frames; no cut inside a word; every planned word heard in the render (ASR on the output); first frame not
   empty; SFX under the voice; `hyperframes check`. Then one Claude look at a sheet of the cuts and graphics against
   the rules. A fail goes back to Claude (2 rounds at most), then Review.
7. **Learn**: my comment → **Fix** (Claude) → the lesson is recorded, with a check when it can be measured; when the
   pipeline caused it, the code changes too (Claude Code).

**Rules** (what every prompt and check reads), in this order when they disagree: halal (locked) → my lessons (34
carried over) → the page's style → the market's patterns (weekly) → the base rulebook (per format: hook in the first
second or two, one idea, the payoff, captions, safe zones, length, loop, CTA; from `playbook`, `content-principles`
and the viral skills).

**Market engine** (per page)
- Niche, keywords and 20–50 seed accounts (Claude proposes from search; I can strike any), refreshed monthly.
- Daily: each account's recent posts with views, likes, comments, date, length, caption. Instagram through a
  separate account's session (my own stays safe), TikTok and YouTube Shorts through yt-dlp.
- Outliers: views ≥ 3× the account's median of its last 30 posts (and enough views to matter); the top ones each week.
- Breakdown, mechanical: transcript, on-screen text of the first 3 s, cuts a second, shot lengths, face on screen,
  caption style, length, first frame, a sheet. Then a short read by Claude: hook type, promise, beats, why it works,
  what to reuse. Weekly per page: *What works now* (hooks, formats, lengths, looks), which Write and Make read.
- My own accounts are read the same way, so Claude learns which of my hooks worked (no stats screen).

**The app**
- Top bar: my pages; under each, Board and Settings.
- Board: Ideas → Script → Needs me (film or record) → Making → Review → Ready → Posted. A card: title, format, one
  status line.
- Card: the document (Script, Notes) with **Write** and **Hooks**; its inputs (takes, voice, screenshots, products),
  dropped in or shared from the phone; **Make** (each step as one line while it runs); the render with comments
  pinned to moments, every version, **Fix** (sends my comments), **Approve** → Ready: download, share to Instagram
  on the phone, caption copied.
- Page settings: brand kit (fonts, colours, logo), voice, caption style, look, SFX and ambience level, tracker,
  *start Make when the inputs are in* (off by default).
- Phone: all of it, plus sharing footage, screenshots and voice memos to a card, recording my voice in the app, and
  a notification when a render is ready.
- Claude Code on the laptop: `cs` (paired once, like the phone) for the same actions plus the details (`cs card`,
  `cs make`, `cs notes`, `cs fix`, `cs rules`, `cs market`), and `npm run deploy` for code.

## Parts

| Need | Pick | Licence | Note |
|---|---|---|---|
| Compose, render, layout checks | HyperFrames 0.9 (`@hyperframes/producer`, ~450 registry blocks, `hyperframes check --safe-zone reels`) | Apache-2.0 | its music library and `/media-use` music are blocked |
| Animation | GSAP, Lottie, Three.js, anime.js | free, MIT | |
| Video operations | FFmpeg (BtbN build with NVENC and libplacebo) | GPL | NVENC and Vulkan both run on Pascal |
| Speech to text | Parakeet TDT 0.6B v3 (onnx-asr), Whisper large-v3-turbo (faster-whisper) | CC-BY-4.0, MIT | both tried on my takes: fillers, stumbles, word timing |
| Alignment, speech | wav2vec2 forced alignment (WhisperX-style), Silero VAD | BSD, MIT | |
| Voice clean-up | DeepFilterNet3, Resemble Enhance, ClearerVoice | MIT/Apache, MIT, Apache | A/B on my takes; I pick by ear |
| Music check and removal | PANNs (music classes), Demucs | MIT | |
| Faces, cut-outs | YuNet; MediaPipe selfie segmentation, BiRefNet | Apache/MIT | text behind my head, product cut-outs |
| Screenshot text | RapidOCR | Apache-2.0 | proof on the right words, market text |
| Shots | FFmpeg `scdet`, PySceneDetect | — , BSD | |
| Upscale, slow motion, stabilise | Real-ESRGAN and RIFE (ncnn-vulkan), vidstab | BSD/MIT, GPL | |
| Grade | own auto-correction (colour-science, OpenCV) → `.cube`; looks: a filmic tone curve + film LUTs; libplacebo for HDR → SDR and LUTs on the GPU | BSD, LGPL | |
| Stock | Pexels, Pixabay | free licences | API keys |
| SFX, ambience | Kenney, OpenGameArt CC0, Sonniss GDC bundles, Freesound CC0 | CC0, royalty-free | screened: nothing tonal or melodic; tagged and searchable |
| Icons, emoji, fonts | Lucide, Phosphor, Tabler, Fluent Emoji, Noto animated emoji, Google Fonts | ISC, MIT, CC-BY, OFL | |
| Market | yt-dlp (with `--impersonate`), instaloader | Unlicense, MIT | |
| Know-how for Claude | `playbook` (ours), `content-principles`, viral skills, HyperFrames + GSAP skills; OpenMontage's pipelines and video-use's editing loop read for ideas | mixed | |
| App | Node 24, Fastify, SQLite, React + Vite + shadcn/ui, Capacitor 8 | MIT | |

## Targets

| What | Target |
|---|---|
| Daily episode (60 s, 5–10 takes) | Make → Review in ≤ 15 min on ai-server; ≤ ~80 k Claude tokens; by the third episode ≤ 1 round of comments |
| Before (2026-11-07) | an editing session read 25–55 M tokens; 130 versions and 92 renders for 11 posted videos |

## Phases

The order after P2 follows my list (UGC, Gentle Return, carousels, explainers, graded shots); built on `next` until
P1 works, then `next` becomes `main`.

**P0 — Foundation**
- [ ] ai-server reachable (power, Tailscale, SSH). One setup script: Node 24, FFmpeg (NVENC, libplacebo), Chrome
  headless shell, Python 3.12 + uv, PyTorch 2.14 cu126 (the last with Pascal), ONNX Runtime; a systemd service;
  Tailscale HTTPS
- [ ] Claude on ai-server: my Pro login, the SDK wrapper (Opus, structured answers, usage guard)
- [ ] New tree on `next`: `server` (API, jobs, engine), `tools` (Python), `web`, `mobile`, `shared`; old code gone
- [ ] Data: pages, cards, inputs, versions, renders, comments, rules, jobs; media and projects on disk
- [ ] App: board, card, uploads and sharing, player with pinned comments, Approve → Ready, download; Android app
  updated (same id and key, paired to ai-server); `cs` paired
- [ ] Measured on the 1070: a 60 s render as one HyperFrames page vs A-roll + transparent overlays; NVENC vs x264
- Done when the phone sends a take to a card on ai-server and the laptop plays a test render made there

**P1 — Daily episode, one press**
- [ ] Look: transcript (Parakeet vs Whisper on my real takes), alignment to the script, takes table (the last clean
  complete take; stumbles, fillers, false starts), faces, light, noise
- [ ] Voice chain (my pick from the A/B), loudness; light fix and the page's look; reframe and punch-ins on the
  words Claude picks
- [ ] Captions (2 words, under the chin), tracker block, proof screenshots on the words that point at them (OCR
  match), the source credited
- [ ] Plan → build → render → checks → Claude's look → fix → Review; **Fix** from my comments → lessons
- [ ] **Write**: the script from my day notes (typed, or a voice memo); **Hooks**
- [ ] The 34 lessons in as rules, with checks where measurable
- Done when 3 real episodes go from Make to Review in ≤ 15 min each and the third needs ≤ 1 round of comments

**P2 — Market engine** (collector, outliers, breakdowns, *What works now*, my own numbers) and **Write** on every page

**P3 — UGC** (after the open questions) · **P4 — Gentle Return faceless** (checked sources, stock with no people,
ayah and hadith cards, ambience) · **P5 — Ecom carousels** (brand kit, layouts, product cut-outs and upscaling, copy)
· **P6 — Motion explainers** (Claude's HyperFrames scenes, registry blocks, the SFX library) · **P7 — Graded shots**
(looks, shot matching, film finish)

## Waiting on me

- Turn ai-server on and check Tailscale and SSH: it shows offline on Tailscale since 2026-11-16 and doesn't answer SSH.
- Log Claude in on ai-server (one command over SSH, given when it's reachable).
- A separate Instagram account for the market collector, logged in once on ai-server.
- Free API keys: Pexels, Pixabay (Freesound optional).
- UGC: for whom (the ecom brand, brand deals?), and is it me on camera or hands and product only?
- The ecom brand: name, products, where the product photos come from, its look.
- Graded shots: which footage, and for what (a format of its own, or the look of everything)?
