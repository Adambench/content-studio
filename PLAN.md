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
| Formats | Daily episodes (mostly raw), UGC, Gentle Return faceless, ecom carousels, motion explainers, colour-graded shots (its own format, when I ask for things to pop). **No clipping** (no code, no data carried over) |
| One press | Each format is a recipe from what I give to a checked render in Review, with no step in between unless it needs me (film, record) |
| Modular | Nothing is fitted to one scenario (2026-11-23: "I am not locked in"). The engine is capabilities (look, cut, grade, voice, captions, stock, SFX, scenes, render, check) that any recipe or Claude can combine; recipes are defaults, not limits; any page can make any format and mix them in one video; a card's Notes say what I want and Claude picks the recipe and options; anything no recipe covers runs as *custom* (Claude with every capability) |
| Claude | Agent SDK on my Pro login on ai-server, never an API key. Opus for every creative choice and review; a smaller model only for market read-outs. Background work waits while 5-hour usage ≥ 80 %; what I press and wait on never waits |
| Scripts | Claude drafts them in my voice, on every page; I edit, film or record. Hooks as options beside the script |
| Viral | Learned from the market: each page's niche watched daily, outliers (views far above the account's usual) broken down into patterns. Plus a base rulebook (fundamentals I don't have yet) and my lessons |
| Pictures | Nothing generated: my footage, free stock (Pexels, Pixabay), graphics drawn in code. Stock is halal-screened |
| Sound | SFX and ambience set per page (off / light / full), from recorded libraries; never music; a nasheed only vocal, only by my choice |
| Licences | Anything public is usable (2026-11-23). The Toolbox still notes each licence; it's not a blocker |
| Halal | Unchanged: no music or instruments in anything made (checked on every output); no women on camera (footage and stock screened); nothing haram shown or promoted; Gentle Return never shows my face, cites every ayah and hadith; nothing tied to another religion |
| UI | Replaced 2026-11-24 by *The app* below (inbox + a studio per video, Claude Code in a thread). Still dark only, quiet, few words, no stats screens |
| Data | New app. Lessons and scripts imported if cheap; losing the rest is fine |

## The app (2026-11-24)

The first UI (board, card page, buttons) was rejected: "make the decisions from complete scratch, optimise for
convenience and power". The clickable mock it was decided on: https://claude.ai/artifact/178QSYvLnMukDc3mTPDead.

- **Claude is Claude Code.** Each video is a folder on ai-server (`~/studio/<page>/<video>/`) with its own
  persistent Agent SDK session (Claude Code's own tools: shell, files, web, skills, subagents, MCP), working while
  the browser is closed. Full shell, no approval prompts (my yes, 2026-11-24), inside guard rails: never Open
  WebUI, Docker, Ollama, systemd or the network settings, no deletes outside `~/studio`, never posts.
- **Same session in a terminal:** each video's Terminal tab is `claude --resume` in its folder; plus a plain shell.
- **Engine = skills + tools.** Recipes are skills (in the repo, linked into `~/.claude/skills` on ai-server); the
  measurable work is commands Claude calls (transcribe, cut, clean voice, strip music, reframe, captions, render on
  the GPU, checks). Claude checks each render itself (a picture at each cut, loudness, safe areas, halal) before I
  see it. Studio tools (an in-process MCP server) tell the app what happens: progress, a question with options, a
  new version, notes fixed, a lesson.
- **Plain files are the brain:** `~/studio/CLAUDE.md` (written by the app: halal, layout, how to work; locked),
  `~/studio/lessons.md` and `<page>/CLAUDE.md` (who the page is, style, lessons; Claude and I edit them). Claude Code loads them
  by itself for every video, in the app and in the terminal.
- **Inbox** instead of a board: one box ("What are we making?": type, speak, drop takes, pick the page), Claude's
  ideas for today, then videos by status (Your turn, Making, Ready to post, Posted). Status is never set by hand.
- **Studio** per video: the video in the middle, the thread on the right (Thread, Script, Files, Terminal). Pause
  and type = a note pinned to that moment; notes collect, **Fix** sends them at once; every note also becomes a
  lesson. Versions at the top, V flips to the one before at the same moment. One input for notes, instructions,
  `/skills`, `@files`, voice. **Approve** opens the Post sheet (caption to copy, download / save / share to
  Instagram). Claude never approves or posts.
- **Pages** (my word, 2026-11-24; "brand" before): one Instagram account each. **New page** is a workflow, not a
  name box: I give what I have (what it is, who it's for, links, samples, a kit, past posts) and pick how far Claude
  builds (*What I give* / *Mix* / *Scratch*). Claude sets it up in the page's own studio (`<page>/setup/`, the same
  thread, notes on slides, Approve): identity (names checked in every reading, bio, avatar), voice, look (palette,
  free fonts, logo and avatar drawn in code, caption style, carousel and cover templates in `<page>/kit/`), pillars
  and formats, first ideas, the page's own rules, all written into `<page>/CLAUDE.md`; a board of slides to review.
  Approved = Done (out of the inbox); later changes are a message in the same setup.
- **Phone:** the same app in a thin Android shell (my pick, 2026-11-24): it loads the live web app from ai-server
  (UI updates need no APK) and keeps the native parts: share from the gallery (my pick for getting takes over),
  background uploads, saving to the gallery, notifications. Video full screen with Note / Thread / Version /
  Approve on the side; the thread slides up.
- **When Claude starts:** on my go (Enter in the box, a message, Fix, "Add & make" when sharing), or by itself
  once it knows no more footage is coming (every line of the script covered by a take, sign-off included).
- **Power:** Ctrl K jumps anywhere and runs any skill; Space, J/K/L, arrows (a frame), C note, F fix, A approve,
  V compare.
- Not used: Remote Control (Anthropic's generic chat UI for the same session; nothing the app and its terminal
  don't do). Ideas taken from video-use (MIT: packed takes, a picture at each cut, fix loop), MakeMyClip (MIT:
  retake removal, cut checks), aigent-talking-head (Apache-2.0: verify gates).

## Formats

Examples of what the recipes cover, not a list of what each page may do.

| Format | Page | I give | The engine does | Out |
|---|---|---|---|---|
| Daily episode | Personal brand | takes filmed on the phone, screenshots as proof, a few notes about the day | drafts the script from my notes; picks the last clean take of each line; cuts in pauses; light, grade, voice clean-up; captions 2 words under the chin; tracker at the ends; proof on the words that point at it | 9:16 MP4 + caption |
| UGC | any | a product or offer, then my takes or product shots | script + shot list, then the edit: hook, product shots, text in my words, CTA | 9:16 MP4 |
| Gentle Return | Gentle Return | my voice reading Claude's script | script with checked ayat and hadith; stock visuals with no people; ayah and hadith cards; ambience; captions | 9:16 MP4 |
| Carousel | any (first: Qalam & Siwaak) | products (photos), or nothing | topic and copy from market patterns, layout in the brand kit, product cut-outs | 4:5 PNGs |
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
- Daily: each account's recent posts with views, likes, comments, date, length, caption. Instagram through the
  Blox Moments account's session (I don't mind risking it; my own stay safe), TikTok and YouTube Shorts through
  yt-dlp.
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
- [x] ai-server reachable (power, Tailscale, SSH). One setup script: Node 24, FFmpeg (NVENC, libplacebo), Chrome
  headless shell, Python 3.12 + uv, PyTorch 2.14 cu126 (the last with Pascal), ONNX Runtime; a systemd service;
  Tailscale HTTPS. 2026-11-23: SSH by key, linger on, Tailscale operator set, served on
  https://ai-server.tail1e2ac8.ts.net:8443 (443 is Open WebUI's, with Funnel: untouched). Setup stalls on the
  network: ai-server's Wi-Fi (2.4 GHz channel 1, 54 %, power saving on) downloads at ~50 KB/s with 0.5–1 s pings,
  even from the laptop on the LAN. Needs the Ethernet cable, or power saving off / the 5 GHz band. Setup done
  2026-11-24 anyway (packages took 1 h; Chrome and FFmpeg sent from the laptop). FFmpeg is BtbN **8.1**: 9.0 and
  master need driver 610+, and 580 is the 1070's last driver. `npm run deploy` takes ~20 s (packages only when the
  lockfile changes)
- [x] Claude on ai-server: my Pro login. The SDK wrapper is built (`engine/claude.ts`: Opus, structured answers,
  usage guard, every call counted); tried on the laptop's login: a Write = one call, ~9.6 k prompt tokens (cached
  after), 1 k out, 13 s. 2026-11-23: a 1-year `claude setup-token` token in ai-server's keys.env (the SDK's own
  binary uses it; no Claude Code install there). First call there answered (Haiku; 39 s over the slow Wi-Fi)
- [x] New tree on `next`: `server` (API, jobs, engine), `web`, `cli`, `mobile`, `shared`; old code gone (2026-11-23).
  `tools` (Python) comes with P1
- [x] Data: pages, cards, inputs, versions, renders, comments, rules (halal locked, playbook as fundamentals), jobs
  (lanes, resumable steps); media and projects on disk; API smoke tests (`npm test`)
- [x] App: board (drag between stages; one list on the phone), card (script and notes saved as I type, earlier
  drafts, Hooks to take, files, player with comments pinned to a moment or a stretch, versions), page settings,
  rules, settings with pairing; Write and Hooks work; `cs` for the terminal. Looked at in headless Chrome at 1920 ×
  1080 and 412 × 915. Tailscale identity is the sign-in; the phone pairs by QR for its upload queue
- [ ] Android app: the new screens are in the app build (share sheet → a card, background uploads, downloads);
  release v1.0.0 (same id and key) once ai-server answers
- [x] Measured on the 1070: a 60 s render as one HyperFrames page vs A-roll + transparent overlays; NVENC vs x264.
  On the laptop (HyperFrames 0.9.86, 4 workers, x264): 4 s of titles and captions in 6.8 s; over footage 15.9 s.
  On ai-server, 60 s of 1080 × 1920 footage + title + 2-word captions (2026-11-24): **one page 77.3 s with NVENC**
  (23.3 fps), 81.6 s with x264. A-roll + transparent overlay: the ProRes 4444 overlay alone 110.3 s (alpha forces
  screenshot capture, 16.3 fps) + FFmpeg compositing 18.1 s NVENC / 43.0 s x264. **Decision: one opaque
  HyperFrames page per video**, footage inside; FFmpeg does the passes before it (cuts, audio, grade). Capture is
  the bottleneck, not encoding
- Done when the phone sends a take to a card on ai-server and the laptop plays a test render made there

**N1 — The app, rebuilt (2026-11-24, from *The app* above)**
- [x] Server: pages (brands then) and videos (folders in `~/studio`), the thread, notes, versions; Claude Code per video
  (Agent SDK session resumed each run, guard rails, studio tools: progress, ask, save_version, render on the GPU,
  notes_fixed, lesson, set_title, set_caption); messages / Fix / answers / go / "Add & make" start it; Stop.
  Tried on ai-server 2026-11-24: "make a 3 s TEST clip" → Claude read the HyperFrames skill, built the project,
  rendered with NVENC, checked frames, renamed it, saved v1, in about 60 s
- [x] Web: Inbox (one box, page and kind, files; Your turn / Making / Ready to post / Posted), video page (player,
  timeline with note pins, thread with Claude's work folded, one box for notes and messages with / and @, Fix,
  versions and Compare, Approve → Post sheet), Brain (lessons on/off, halal, each page's CLAUDE.md, skills),
  Server, Ctrl K; phone layout (video full screen, Note / Thread / Version / Approve, thread as a sheet). Checked
  in headless Chrome on ai-server at 1440 × 900 and 412 × 915, no console errors
- [x] Terminal: per video (`claude --resume` of the app's session, or a shell) and a plain shell in `~/studio`, over
  the app's sign-in (xterm.js, node-pty)
- [x] ai-server: skills linked into `~/.claude/skills` on deploy (5 editing skills added from the laptop:
  cut-mistakes, cut-silences, edit-video, hyperframes-video-beats, video-perception); `~/studio/CLAUDE.md` written
  on start; HyperFrames gets a private cache (it refuses Mint's group-writable `~/.cache`) and its CLI at the
  renderer's version
- [x] Pages (2026-11-24): brand renamed page everywhere; New page (what it is, samples, *What I give* / *Mix* /
  *Scratch*) → the page's setup studio (`setup/`: Claude Code with the page brief, `set_page`, a board of slides,
  notes, Approve = Done; `kit/` deletable by it); Setup on every page's view; `cs page`, `cs setup`
- [ ] Android: thin shell on the live app built (`server.url`, offline page; share → a video, "Add & make",
  background uploads, save to the gallery). Release v1.0.0 waits for my go (it replaces the old app). Notifications
  (ready / Claude asks) still to do
- Later, not in N1: speaking instead of typing (Whisper on ai-server, with P1), Claude's ideas for today in the
  inbox (P2), notes on a stretch of time
- Done when I can make a video from the inbox, leave notes, Fix, Approve and post, on the laptop and the phone

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

**P3 — UGC** · **P4 — Gentle Return faceless** (checked sources, stock with no people,
ayah and hadith cards, ambience) · **P5 — Ecom carousels** (brand kit, layouts, product cut-outs and upscaling, copy; Qalam & Siwaak first: its kit,
logo and product photos come from its repo, `Hero-Sphinx/Qalam-and-Siwaak`)
· **P6 — Motion explainers** (Claude's HyperFrames scenes, registry blocks, the SFX library) · **P7 — Graded shots**
(looks, shot matching, film finish)

## Waiting on me

- The laptop's SSH key on ai-server (`ssh-copy-id bouyaka@100.64.195.82`), then Claude logged in there.
- The Blox Moments Instagram login, once on ai-server, for the market collector (P2).
- Free API keys: Pexels, Pixabay (Freesound optional).
