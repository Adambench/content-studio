# Content Studio — plan

Decisions, measurements and what's left. What's built is in the code and git history; don't re-describe it here.

## Decisions

| Topic | Decision |
|---|---|
| Users | Just me (single user) |
| Where | Electron desktop app on the laptop (Zorin 18, i5-1135G7, 16 GB, Iris Xe) runs its own server; the phone uses the Android app (or PWA) over Tailscale Funnel's `*.ts.net` address |
| Posting | Each platform's official API with my own developer apps; no aggregators. Formats: short vertical video + image posts/carousels |
| Claude | Agent SDK on the Claude Pro login, never an API key; or the self-hosted model on the home server (phase 9). Edits ideas/drafts/edits freely; scheduling, publishing, approving and submitting are always my click |
| Workspaces | One workspace = one page (identity, voice, look, pipeline, analytics, accounts) with a kind: Personal brand, Business, Clipping page. A kind presets modules, stages and Claude's instructions; it doesn't fence anything off |
| Versions | Drafts and edits: alternatives, each with version history; compare + restore |
| UI | Dark only, shadcn/ui; mobile first-class |
| X | Low priority |

### Use cases (2026-10-15)

Personal brand (Muslim entrepreneurship, lifestyle, Islam; talking head and faceless), clipping for Whop Content
Rewards campaigns, clipping for my own businesses. 1 personal page, a page per business, 1–5 niche clipping pages.
Campaigns are their own entity outside workspaces, assigned to pages; from Content Rewards (link → read, rules
checklist, halal screen, I confirm) or from a business's brief. Today is the home across all pages. Formats, SFX, the
playbook and skills are shared. Same clip on two pages = a variant each. No direct clients. Still unknown: how many
businesses and what they are.

### Halal (2026-10-15)

| Topic | Decision |
|---|---|
| Music | Never music or instruments anywhere: no tracks, beds, stingers, trending sounds, TikTok auto-add-music; no music asset type |
| Nasheeds | Vocal-only, only with my OK per edit; only the UI sets it, Claude can suggest |
| SFX | Allowed: whooshes, pops, clicks, impacts, dings, risers; nothing tonal-melodic |
| Source audio | Music in source footage removed (Demucs voice stem) or the clip dropped |
| Content | Music promotions hidden; nothing haram promoted (gambling, alcohol/drugs/smoking, dating, immodest imagery, interest-based finance). Briefs screened when added, moments by transcript and frames |

### Clipping (2026-10-15)

Goal: crayo.ai but better: 5–15 clips a day across the pages, made automatically to each campaign's rules, approved
by me one by one. Free and local, apart from Claude. Mechanical filtering first (loudness, pace, chat replay, brief
keywords), then one Claude request per source picks moments; rejections keep their reason for the next pick.
Submitting on Content Rewards stays my click; the app tracks status, counted views and earnings (views × rate until
the site says). Whop has no Content Rewards API for clippers: rules, source files and submissions are read through
the signed-in desktop window.

### Video studio (2026-10-14)

| Topic | Decision |
|---|---|
| Edit | One JSON edit per piece, versioned; compiled to one HyperFrames page used by both preview and render |
| Preview | Half-size H.264 proxies (30 fps, keyframe every 0.5 s, HDR tone-mapped) so it plays anywhere |
| Render | FFmpeg cuts at full quality (trim, tone-map, LUT), HyperFrames in headless Chrome (3 workers), x264 CRF 17, two-pass loudnorm to −14 LUFS |
| Grading | FFmpeg `lut3d`: HyperFrames' WebGL grading hangs headless Chrome here |
| Encode | The BtbN FFmpeg in `~/.local/bin` needs a newer libva than Zorin's → x264 only |

### Formats (2026-10-16)

| Topic | Decision |
|---|---|
| Speech | Kokoro 82M int8 ONNX in the clip tools venv (SHA-256 checked); not Piper (flat), no voice cloning (free models are non-commercial) |
| Voiceover | Only speech made here (`tts`) or an in-app voice memo (`capture`), never an upload (a way in for music) |
| Backgrounds | My own footage muted, else a generated gradient; no stock gameplay (copyright) |
| Characters | Four built-in SVG busts (Sam, Max, Lina in a hijab, Bolt); mouths from loudness; drawn, simple, modest |
| UGC | I film it; Claude writes script, shot list, requirements, captions from the brief |

### Publishing (2026-10-14)

| Topic | Decision |
|---|---|
| Apps | One developer app per platform, shared; accounts belong to a workspace |
| Sign-in | System browser → `<public address>/api/oauth/<platform>/callback`, proven by one-time `state` |
| Copy | Snapshotted from the draft when scheduled; later draft edits never change a post without a click |
| TikTok | Send to inbox by default (works unaudited); Post directly after the audit with TikTok's required UI |
| YouTube | Uploaded at the scheduled time (not `publishAt`); unaudited uploads come back private |
| Retries | 5 attempts (30 s → 32 min), each resuming from `posts.remote`; post up to 3 h late after sleep, else missed |

Platform limits: Instagram needs a Business/Creator account and media at a public HTTPS URL, ~50–100 API posts/24 h.
TikTok unaudited = private only (inbox works). YouTube unaudited = private; consent screen must be *In production* or
refresh tokens die in 7 days; no image posts. X: pay-per-use.

### Analytics (2026-10-15)

“× typical” = views after 24 h over the median of the account's posts from the last 90 days. Best times only for
groups of 2+. The weekly review (one Sonnet call per workspace) may rewrite the voice memory (with Undo, only if
unchanged meanwhile); queue times and ideas only on my click. Numbers stay mechanical; Claude only interprets.

### Android (2026-10-15)

Capacitor around `web/`, installed and updated by Obtainium from GitHub Releases. Pairing by QR (one-time code →
device token, Keystore-encrypted), never cookies. FCM with options handed over by the server (one generic APK). One
release keystore forever (`~/.config/content-studio/android-release/`); app id `io.github.adambench.contentstudio`,
versionCode from the tag (`v1.2.3` → 10203).

## Measured

| What | Finding |
|---|---|
| Free reel research | YouTube Shorts via `yt-dlp` works (needs `--js-runtimes node`); TikTok blocks `yt-dlp` here; Instagram needs a login → the signed-in window |
| Content Rewards | Public campaign page: title, rate per 1K, min/max payout, budget left, platforms; rules, source files and views locked until joined. Pages: `/c/submissions`, `/c/earnings` |
| Demucs | `htdemucs` 2 stems: ~33 s per 45 s clip, 1.5 GB RAM; voice silent where only music played. On speech alone the non-voice stem sits at −40 to −42 LUFS → music check: background > −35 LUFS or within 12 dB of the voice, then the voice must be silent in the pauses (p90 < max(−50, speech − 25 dB)), < 1 s of pauses = “unverified” |
| Whisper | faster-whisper `small` int8, 4 threads: 0.2× real time (2 h VOD ≈ 25 min); `base` no better value |
| Clip tools | PyTorch 2.14 CPU + Demucs 4.1 + OpenCV 4.13 + gdown + models: 68 s install, 1.3 GB |
| YuNet / speakers | Face in 9–11 of 12 frames, ~3 s per clip; speaker scan 0.2× real time at 8 samples/s; use each frame's timestamp (VFR drift) |
| Kokoro | 32 s of speech in 19 s; Whisper `small` returns its words exactly |
| Renders | 35 s clip ≈ 3.5 min with the CPU free; transitions cost nothing extra; CSS filter/clip-path/grid animate fine |
| Research | Signed out, TikTok sometimes answers “Something went wrong” instead of the grid → sign in; Instagram's reels grid has no captions (yt-dlp for those) |

## Phases

0. **Setup** — on me, not started: Meta app (Instagram API with Instagram Login), TikTok app (Login Kit + Content
   Posting + Display API), Google Cloud (YouTube Data + Analytics API, audit form), Tailscale Funnel, Firebase.
1. **Pipeline + Claude** — done.
2. **Video studio** — done. Open: grade shown in the preview; hardware encoding (libva).
3. **Scheduling & publishing** — built, tested against a stand-in. Open: real accounts; the TikTok audit demo.
4. **Analytics & weekly review** — built, tested against a stand-in. Open: real numbers.
5. **Later** — X, comments inbox.
6. **Android app** — built, tested on an emulator; v0.1.0 released. Open: a real phone (Obtainium, QR scanning
   needs Play services, real FCM). The phone needs a new release for everything since phase 7 (`API_VERSION` 2).
7. **Clipping, campaigns, research, formats** — built.
8. **Streamlined video pipeline** — in progress, see *Phase 8 build plan*
   - [x] Step 1 — Every video is a package; nav per kind; Inbox + search instead of the Library (2026-10-16)
   - [ ] Step 2 — Feedback loop in the package (timestamped notes → Claude edits → re-render → before/after)
   - [x] Step 3 — Compute workers on the home PCs (2026-10-16; protocol tried with a real worker process on CPU, not on a GPU)
   - [x] Step 4 — Skills and the creative arsenal (2026-10-16; no new skills installed, see the step)
   - [x] Step 5 — Creative directions (personal/business) and varied clip edits (clipping) (2026-10-16; the pitch untried against a real Claude login)
   - [x] Step 6 — One-button finder for clipping pages (2026-10-16; only tried against stand-ins, see the step)
   - [x] Step 7 — Effects library, local only (2026-10-16; a first set, see the step)
9. **Self-hosted models** — built 2026-10-17, tried against stand-ins only (see *Phase 9 build plan*)
   - [x] Step 1 — Routing: each AI task on Claude or the home server's model; one *local only* switch; auto switch
   - [x] Step 2 — The chat and the video chats on the local model (own tool loop over the studio tools)
   - [x] Step 3 — A worker hosts the text/vision model (Ollama), found by the laptop on its own
   - [x] Step 4 — Generated b-roll images, video clips (overnight) and covers, never showing people or animals
   - [x] Step 5 — My own voice, cloned, for voiceovers

## Waiting on me

- Phase 0 on the platforms' sites, then connect real accounts.
- Settings → Clip tools → Install in the real app (~3 min, 1.4 GB), then a real campaign source through to Review.
  Listen to the first clips from a source with background music (the music check was only tried on stand-ins).
- Listen to the built-in SFX (86 now; the 55 added on 2026-10-17 were only checked by measurement) and the voices; drop
  any I don't like (`server/scripts/make-sfx.py`, `shared/sfx.ts`).
- Release a new Android build (API version 3): until then the phone app says it's out of date.
- A format video and a UGC video for real.
- Research: each page's *What it watches* (or *Find channels for me*), *Run now* once; sign in to TikTok.
- Settings → Connected sites: sign in to Whop (contentrewards.com), TikTok, Instagram; check each says “Signed in”.
  Whop's session cookie is a guess (`SITES.whop.sessionCookie`): if it stays “Not signed in”, list the HttpOnly
  cookies on contentrewards.com and pin the right one. Then “Try a page” on a joined campaign (rules and files should
  be in the text).
- After a clip is posted and submitted: campaign → Submissions → *Check now*; if nothing matches, the submissions page
  doesn't show post links → adjust `syncSubmissions`.
- Compute: on each home PC run `scripts/setup-worker.sh --server … --code …` (code from Settings → Compute); check `journalctl --user -u content-studio-worker`, that Settings → Compute shows the GPU and four tools, and *Run a test* says it ran there. Then measure each tool's speed on both cards against the laptop (the plan's step 3 asks for it): Whisper, Demucs, matte, speaker scan. The CUDA builds for Pascal (cu126 wheels, cuDNN 9 for faster-whisper) are untried.
- Find clips: check `DISCOVER_URL` (`server/src/finder/discover.ts`) is the page that lists Content Rewards campaigns; run it once with a real creator and see that the viral search finds their clips (`ytsearch` for "<creator> clips").
- Self-hosted models (phase 9), on the home PCs: pull the repo, then on the 1070 PC `scripts/setup-worker.sh --server … --code … --with llm,video,voice` and on the 1050 Ti PC `… --with image` (generation needs `nvidia-cuda-toolkit`, git, cmake, build-essential; the model server needs `zstd`). Check Settings → Models says *Ready: qwen3-vl:30b-a3b-instruct · on <PC>*, Compute lists *Pictures*, *Video clips*, *My voice* and *Text model*. Then: a chat on *Local* that edits a video with tools; a background job with *Local only* on; *Generate* a picture from a video's Footage and look at it; a clip overnight; Settings → My voice: record 10–30 s, *Hear the clone*. Measure (the plan needs it): local chat turn time, a picture on each card, a clip on the 1070. Untried here (no GPU, no Hugging Face or ollama.com access): the Ollama download and `ollama pull`, every model download URL in `setup-worker.sh` (file names from memory; FLUX's `ae.safetensors` is from black-forest-labs/FLUX.1-schnell, which may ask for a Hugging Face login), the CUDA build of stable-diffusion.cpp on Pascal, Chatterbox on Pascal, and how well the local model calls the studio tools.
- Not run with a real chat yet: directions (`direction.pitch`), `view_render` and the package notes; `write_scene`/`view_overlay`, `write_format_video`, `write_ugc_video`, transitions;
  the weekly review with the playbook.

## TikTok audit demo (record once Content Posting works)

1. Settings → Publishing shows the TikTok app; Accounts → Connect TikTok → consent screen (scopes) → back with the
   account.
2. Switch the account to **Post directly**.
3. A piece with a finished video → **Schedule** → TikTok: creator nickname, visibility with no default, Comment/Duet/
   Stitch off until switched on, commercial-content disclosure (Your brand / Branded content, “Only me” disabled for
   branded), the Music Usage / Branded Content Policy line, caption, preview.
4. **Post now** → Posting → Posted.
5. Show the post in the TikTok app (private while unaudited).
6. Show every scope used: Analytics reading views (`video.list`) and followers (`user.info.stats`).

## Phase 8 build plan (2026-10-16)

What I asked for: the video pipeline streamlined, with boring work automated and decisions easy. A viral finder that
runs on one click; one place per video where I watch it and steer Claude (feedback before posting) with more control
over how it looks and feels; no big library to dig through; tabs in an order that shows where to start, per kind; and
Claude using every useful skill so videos differ from other pages (considered every time, used where they fit).

| Topic | Decision |
|---|---|
| Unit of work | Every video is a **package** (a piece): its direction, footage, edit, renders, copy, posts, results and its own Claude chat, on one page. A personal-brand video I film and upload belongs to its idea |
| Library | Gone. Uploads made inside a package attach to it. Shares, the camera and uploads made elsewhere land in an **Inbox**: Claude (Haiku, one call per batch) suggests the idea each file belongs to from its transcript or frames; one click files it there or makes a new idea from it. One search (Ctrl K) finds any package or file |
| Control | Per kind. Clipping: clips are made automatically, then I review each in its package and give Claude feedback pinned to a moment until it's right; approve/reject there. Personal brand and business: a new video starts with 2–3 creative directions Claude pitches (hook, structure, look, effects, pacing); I pick or mix, then the edit is built to it |
| Finder | One button on a clipping page, **Find clips**, chains: new Content Rewards campaigns (ranked by pay, budget left, fit, halal-screened — joining stays my click on Whop) → for each active campaign the creator's long videos found and pulled in (newest, most viewed, those whose clips already went viral) → **already-viral moments** (other clippers' clips of the creator that went viral, matched to the source by transcript) go first, then the usual scan/pick → clips made → Review. Niche research runs with no watch list to set up (channels found from the niche and the campaigns) and feeds the pick and the edit. Also runs every morning |
| Arsenal | A catalog (`shared/arsenal.ts`) of everything a video can use — effects, transitions, graphics, scenes, caption looks, formats, sound moves — with when each fits. Direction pitches and clip edits choose from it (and from the skills) and avoid repeating what the page's last videos used, so videos differ |
| Skills | The chat loads every installed knowledge skill; more are surveyed and installed (`find-skills`). Background prompts paste the parts they need |
| Effects | Free and local only, rebuilt in code (HyperFrames + FFmpeg): orbit, couch wall, UI world, frame break, digital zoom, phone mockup, checklist, headline wall, zoom-through cut, chart grow, pull-back reveal, green screen, paper cut, doodle boil, vertigo, cover story, glass type; plus paper collage, hand-drawn and film looks. Cut-outs of a person by a local matting model. No paid image/video generation (self-hosted generation came in phase 9). onetake isn't used (non-commercial licence); Clawd is Anthropic's mascot, so the cartoon style uses my own characters |
| Compute | Two home PCs on Linux (GTX 1070 + i7-7800X + 32 GB; GTX 1050 Ti + i5-10400F + 16 GB) take the heavy jobs; the laptop app stays the brain (data, UI, Claude, signed-in sites) and its CPU is the fallback. Moving the server to an always-on PC can come later |
| Brand assets | Not on clipping pages: a page's look (captions, fonts, accent, sounds) is in its settings → Style. On personal and business pages *Brand* sits at the bottom of the nav |

Nav, in working order (Today stays the home across pages; Settings at the bottom):

| Kind | Order |
|---|---|
| Clipping | Find → Clips (packages by stage; Review is the column that matters) → Campaigns → Calendar → Analytics |
| Personal brand | Ideas (research brief, Inbox, capture) → Videos (packages by stage) → Calendar → Analytics → Brand |
| Business | Ideas → Videos → Campaigns → Calendar → Analytics → Brand |

Phone: Today, Videos/Clips, Capture, Calendar, Claude.

**Step 1 — Packages, nav, Inbox, search.** The piece page (`/w/:wid/p/:pid`) becomes the package: header with
the stage as a stepper and the next action as the main button; sections Direction/Script, Footage (its files, upload
here), Video (preview of the latest render or the edit, *Open editor*), Copy, Post, Results. Each package has its own
Claude thread (`chat_threads.piece_id`), docked beside it. Inbox (`media.piece_id` null, not an asset) with Claude's
suggestions; search across packages, files and transcripts. Nav per kind as above; Library and the global Review page
go (Review → the Clips board's Review column and Today); Brand assets hidden on clipping pages.

**Step 2 — Feedback in the package (built; untried against a real Claude login).** The player takes notes pinned to a time ("0:07 — cut this pause", or a drawn
box later); a note goes to the package's Claude thread with the time and a frame. Claude changes the edit (studio
tools), the package re-renders by itself when it's in Review, and shows before/after with the version. Approve /
reject / schedule live in the package.
Built: the notes box under the player pins the player's time and sends "Note at m:ss…" to the package chat (`sendToVideoChat`); Claude looks with `view_render`, edits, and `runChat` queues a render when a Review clip's edit head changed; Before/Now toggle from `ReviewClip.previousRender`. Drawn boxes not done. Where things are: the player is `web/src/components/package/VideoPanel.tsx` (`ClipPlayer` in `ClipReview.tsx`); the
video's chat is `ClaudePanel` (`videoChat`, `usePieceThread`, `send` posts `/threads/:id/messages` with
`contextPieceId`); edits change through `update_edit` / `tighten_edit` in `server/src/claude/studio-tools.ts`
(`saveEditVersion`, `listEditVersions`), renders through `queueRender` (`server/src/studio/render.ts`); tools return
frames as `{type:'image'}` content like `view_overlay`; the package summary is `GET /api/review/:id` (`buildClip`).

**Step 3 — Compute workers (built; untried on the home PCs).** Done: a worker pairs like the phone (`POST /api/auth/pair` with `worker: true` → a session of kind `worker`, which may only call `/api/worker/*`), long-polls the laptop (`server/src/compute/workers.ts`, in-memory task queue, 90 s lease, a lost task is queued once more then run here), downloads the inputs, runs the tool's command and uploads the outputs (`worker/src/main.ts`, bundled by `worker/build.mjs`); the command line of each tool is defined once in `shared/compute.ts` (`commandFor`), so the laptop's own run and a worker's are the same command and a worker never runs anything the laptop sends as a command (tools: transcribe, separate, matte, speakers, plus a self-test `probe.py`); `runTool` (`server/src/compute/run.ts`) is used by every Whisper, Demucs, matte and speaker-scan call site and falls back to the laptop when no worker has the tool, is online, or its run fails; the scripts use CUDA when it's there (faster-whisper int8, torch, onnxruntime-gpu); Settings → Compute lists workers (online, GPU, tools, current task, matte ms per frame), adds one (pairing code + the command) and runs a test; `scripts/setup-worker.sh` (tools with CUDA builds, the bundle, pairing, a systemd user service). Tried: a worker process on this CPU-only box paired, polled, took a matte test (2 s of video, 11 s) and the laptop took it when the worker was away. Not done: the speed measurements on the two cards against the laptop (needs the PCs), HyperFrames renders and FFmpeg/NVENC encodes on workers, sending only a range of a source, resumable transfers, the moving of heavy jobs when the laptop is the only machine with the file. Original plan: A small worker (Node, systemd service) on each home PC, reached over Tailscale and
paired like the phone (a device token). The laptop's job queue sends heavy jobs to a free worker that has the tool —
Whisper (faster-whisper on CUDA, int8: Pascal has no fast fp16), Demucs (a PyTorch build that still supports sm_61),
speaker scan, Kokoro, the person matte, FFmpeg cuts/encodes (NVENC), HyperFrames renders — uploading the inputs
(or a range of a source), streaming progress and fetching the outputs; resumable, and a lost worker's job goes back
to the queue (laptop CPU last). Settings → Compute: workers, their GPU, what they can run, an install script
(`scripts/setup-worker.sh`), a test job. Measure each tool's speed on both cards against the laptop first.

**Step 4 — Skills and the arsenal (built).** Done: `shared/arsenal.ts` (46 moves, 8 marked not ready = step 7 effects), `get_arsenal` (with how often the page's last 8 edits used each; `server/src/studio/arsenal.ts`, reused by step 5), a prompt line, and five more motion skills in `CHAT_SKILLS`. Not done: surveying/installing new skills (`find-skills`, needs the network and my say on licences). Original plan: Survey and install more skills (video styles, direction, ads/UGC scripting,
storytelling), keep licences in mind (personal use only where unlicensed). Allow-list every knowledge skill in the
chat. `shared/arsenal.ts` + `get_arsenal`; the prompts tell Claude to consider the arsenal for every video and say
which pieces it chose and why.

**Step 5 — Directions and variety (built).** Done: clipping — `studio/clip-looks.ts` gives each made clip one of 5 looks (hook card style, punch-ins, first-cut move), the one the page's last 6 clips used least, noted in the version message (`· look: id`), no model call; personal/business — `pieces.directions`, `shared/direction.ts`, job `direction.pitch` (`studio/directions.ts`, Sonnet, playbook + arsenal + the page's recent picks), `POST /api/pieces/:id/directions[/choose]`, `DirectionPanel` on the package page; picking sends the direction to the video's chat to write the script and build the edit. Not done: the pitch isn't offered automatically when a video is created. Original plan: Personal/business: `direction.pitch` (one Sonnet call with the playbook and the
arsenal) → 2–3 directions on the package; picking one writes the script/edit plan. Clipping: `clip.make` chooses an
edit direction per clip from the arsenal (hook card style, captions, graphics, transitions, effects) and varies it
across the page's recent clips.

**Step 6 — Finder (built; untried with network).** Done: *Find clips* panel on a clipping page's Find (`FinderPanel`), `finder.run` job (`server/src/finder/finder.ts`) that chains campaigns → videos → viral → clips with a progress list, every morning after 7:00 unless switched off; `rankVideos` (views × recency × length, mined videos last; `shared/finder.ts`); channels are remembered (`sourceListings`) and listed again, views/dates/creator kept on `campaign_sources`; the best 2 per campaign start downloading (max 3 in progress); viral moments: `finder/viral.ts` searches YouTube for the creator's short clips (yt-dlp `ytsearch`), takes outliers (≥ 3× median, ≥ 20k views), matches their captions to the source transcript (`matchToSource`, trigram offsets) and stores `viral` hints, run between transcript and scan, whose stretches the scan always includes and the pick reads first; campaign discovery (`finder/discover.ts`): reads `DISCOVER_URL` in the signed-in window with one Haiku call (rate, budget, halal screen), leads with Add (= paste the link) / open on Whop. Not done: TikTok/Instagram searches for viral clips (YouTube only); auto-suggesting niche channels for research; `DISCOVER_URL` is a guess (in *Waiting on me*). Original plan: Campaign discovery (the signed-in window reads Content Rewards' campaign list; rank and screen;
Today/Find shows them to join), creator sources (channels from the brief, yt-dlp listings, ranked), viral-moment
matching (YouTube Shorts / TikTok searches for the creator's clips, outliers by views, their transcript found in the
source), auto research (channels suggested and added), the *Find clips* button with one progress view. Daily.

**Step 7 — Effects library (first set built).** Done: three new motion-graphic templates (Checklist, Bar chart that grows to the numbers, Headline wall; rendered and looked at); a local person matte (`server/scripts/matte.py`, U²-Net human segmentation via onnxruntime, cached per video as a grey mask video, model downloaded by `setup-tools.sh` — people who installed the clip tools earlier run Install again) and two effects built on it, made with FFmpeg into a new video file the edit's clips swap to: *New background* (blur, dim, colour, picture — the green-screen look) and *Glowing outline* (`shared/effects.ts`, `studio/effects.ts`, job `media.effect`, Claude's `apply_effect`; tried on a real portrait, ~0.25 s per frame on this CPU, so a minute of video takes ~4 min until the home workers). The arsenal lists them. Not done (still planned in the arsenal): orbit, frame break, vertigo, cover story / text behind the person (needs the text drawn as its own layer: FFmpeg's drawtext can't read the bundled woff2 fonts), couch wall, UI world, digital zoom, phone mockup, pull-back reveal, paper cut, doodle boil, glass type, collage/hand-drawn/film looks; no editor UI for the matte effects yet (Claude's tool only). Original plan: The effects above as templates/scenes/edit effects with previews in the editor and in
the arsenal; a local person matte (u2net human seg via onnxruntime or HyperFrames' `remove-background`) cached per
clip for frame break, green screen, vertigo, cover story and couch wall.

**Creative range (2026-10-17, built).** Everything the editor and Claude can reach was widened, all as named choices in
the edit (`shared/looks.ts`, `shared/fonts.ts`) that the arsenal lists and `update_edit` documents: 28 transitions
(`server/src/studio/transitions.ts`: dips to black/white, zoom in/out, whips, pushes, drop, spin, 3D flip and cube,
squeeze, stretch, fall away, iris, wipe, diagonal, blinds, shutter, light leak, burn, impact shake, bounce), 20 caption
presets (`studio/captions.ts`: one word, highlight box, marker, reveal, bounce, impact, neon, outline, retro 3D, glitch,
comic, handwritten, editorial, typewriter, minimal, arcade…) and a caption font picker over 13 bundled fonts (10 new,
OFL + Permanent Marker under Apache 2.0), 16 ways for text and images to come in, 8 b-roll layouts (bottom half, side by
side, circle, inside a phone, tilted photo card…), 12 camera moves per clip (push/pull, pans, drift, snap zoom, impact
shake, handheld, dutch tilt, pulse), 16 colour looks for the video or one clip (CSS filters on each picture; a
backdrop-filter layer measured 80 % slower to render, the element filter 33 %), film textures (grain, vignette,
scanlines, light leak, cinema bars, frame; grain and leak cost ~30 % render time each), 29 motion-graphic templates (17
new: versus, timeline, countdown, steps, pros/cons, percent ring, star rating, price drop, comment, notification, search
bar, highlighter, blur reveal, question, definition, news ticker, circle it), 86 built-in sounds (55 new, synthesised,
non-melodic, pitch-checked; `make-sfx.py --new`), 3 more clip looks for made clips (drift, snap zooms, impact), and
scenes that can use far more CSS (gradients, gradient text, masks, blend modes, 3D) and GSAP's plugins (TextPlugin,
count-ups, motion paths, MorphSVG, DrawSVG, Physics2D, CustomWiggle eases, steps/slow eases, stagger from centre/edges).
The chat also loads `embedded-captions`, `talking-head-recut` and `hyperframes-registry` as idea catalogues. All of it
rendered through HyperFrames and looked at (contact sheets of every transition, preset, look, layout and animation).
API version 3 (an older phone app would drop the new fields when saving an edit).

## Phase 9 build plan (2026-10-17)

What I asked for: the option to run on self-hosted models only, for everything Claude does today (chat, editing,
background jobs) plus image and video generation and my own voice, because Claude's weekly usage runs out and videos
still need to go out (5–10 a day; how long each takes doesn't matter).

| Topic | Decision |
|---|---|
| Hardware | The two home PCs: GTX 1070 (8 GB) + 32 GB RAM and GTX 1050 Ti (4 GB) + 16 GB. Pascal cards do half precision ~64× slower, so everything runs on ggml runtimes (llama.cpp/Ollama, stable-diffusion.cpp) with quantized weights and fp32 maths, not PyTorch fp16 |
| Switching | Per task: Claude, local, or auto. Auto = Claude until its weekly (or 5-hour) usage passes a limit I set, or Claude refuses for usage, then local. One *local only* switch overrides everything. Background jobs on local never wait for Claude's window |
| Text + vision model | One Qwen3-VL model in Ollama on the 1070 PC (30B-A3B MoE, partly in RAM; text, images and tool calls), so nothing swaps between calls. Chosen in Settings from what the server has |
| Chat on local | Its own tool loop (Ollama's chat API with tools) over the same studio tools, the skills as a `read_skill` tool, `web_fetch`; no web search. Same rules: never schedules, publishes, approves, rejects or submits |
| Images | FLUX.1-schnell (Apache 2.0, GGUF) in stable-diffusion.cpp, 4 steps; b-roll stills (with a camera move), backgrounds and covers |
| Video | Wan 2.1 T2V 1.3B (Apache 2.0) in stable-diffusion.cpp, 480×832, ~5 s; ~20–60 min a clip on the 1070, so video clips queue and run **overnight** (a window in Settings); the text model is unloaded first |
| Halal | Generated pictures never show people or animals (any living being): the prompt asks for an empty scene (diffusion models read "no people" as people), a negative prompt backs it, and the vision model checks every image (three frames of a video) and a retry with a new seed replaces a failed one. No music, as always |
| Voice | My voice cloned with Chatterbox (MIT), English, from a 10–30 s clean recording set in Settings; it's one more voice next to Kokoro's for voiceovers and format videos. Runs on a worker (CPU fallback on the laptop only if installed there) |
| Licences | Commercial-safe only (Qwen, FLUX.1-schnell, Wan 2.1, Chatterbox, Kokoro) |

**Built (2026-10-17).** Step 1: `shared/ai.ts` (10 tasks, modes, routing settings), `server/src/ai/route.ts`
(`routeFor(task)`: local only → per-task mode → auto: Claude until its weekly usage ≥ the limit (default 90 %), or its
5-hour usage ≥ the limit (background jobs: ≥ 80 % as before), or it refused for usage (`claudeLimitedUntil`, an hour),
and only when the local model answers), `server/src/ai/local.ts` (Ollama's own API: `/api/tags`+`/api/show` for the
models and what they can do, `/api/chat` streamed with `format` = the JSON schema for structured answers, `think:
false`, one fixed context window so the model never reloads, a rough token check before sending). Every
`askStructured` call names its task and goes local or to Claude (a Claude usage refusal on auto is answered locally);
`waitForUsage(task)` never waits when the task is local. Settings → Models (`ModelsSettings.tsx`, `GET/PATCH
/api/ai`). Step 2: `server/src/ai/local-agent.ts`, its own loop over the same studio tools (zod shapes → JSON schema,
arguments checked with zod before the handler runs), `read_skill` (the chat's skills, own files only) and `web_fetch`
(public addresses only); history from the stored messages within ~35 % of the window; old tool results are cut when a
turn fills it; pictures from tools go in as a user turn. The chat picker has *Local*; a Claude chat on auto moves
there with a one-line note saying why. Measured on the stand-in: the instructions + 45 tools are ~64 k characters
(~18 k tokens), so 32 k is the smallest useful window. Step 3: `setup-worker.sh --with llm` installs Ollama in the
worker's folder (no root), runs it as a user service bound to the Tailscale address, pulls the model; the worker
reports `CS_LLM_URL` and the laptop uses the first online worker's server unless an address is set. Step 4: compute
tools `image` and `video` (`WORKER_ONLY`: a job waits for a worker instead of running on the laptop),
`server/scripts/generate.py` → stable-diffusion.cpp (`master-929-3f8527a`, built by the setup script with CUDA for
compute 6.1; prompts through files, sd-cli has no `--prompt=`), job `media.generate` (`studio/generate.ts`): clips wait
for the night window (Settings → Models, default 23:00–07:00), up to 3 tries with new seeds until the vision check
(task `pictures`) finds no person, animal or haram thing, into the piece's files, and with `place` into the edit as
b-roll (a full-screen still drifts in slowly); `generate_media` for Claude, *Generate* on a video's Footage; the arsenal
lists both. Step 5: compute tool `speak` = `tts.py --clone REF` in the worker's own Chatterbox environment (Kokoro
voices in the same job still work, so a dialogue can mix them); *My voice* in every voice picker; Settings → My voice
keeps the recording (`/api/voice`, mono 24 kHz, first 30 s, silence trimmed). Tried: a stand-in Ollama (schema-shaped
JSON, scripted tool calls) for capture → idea card, chat turns with `get_board`/`read_skill`, history, the auto switch
at 95 % weekly usage, an unreachable server; a real worker process with a stand-in sd-cli for a picture into the edit,
3 failed checks → a clear error, a clip waiting 77 min for the window then made (480×832, 5.06 s) and placed; the
cloned voice through the worker with stub models, and a mixed clone + Kokoro job; the Settings cards, the Generate
dialog (desktop and phone width). Not done: covers aren't sent to the platforms as covers (Instagram's `cover_url`);
the pictures go in as b-roll or a background; no web search on the local chat.

## Phase 10 build plan (2026-10-19): hosted generation, so quality isn't capped by the home PCs

Why: the local models (FLUX.1-schnell, Wan 2.1 1.3B at 480p) are the weakest generators there are, and a soft clip
upscaled to 1080×1920 hurts reach. Videos that ship should use better models; the home PCs stay for drafts, the text
model and anything that must stay free. Checked: Crayo has no public API (nothing in its docs or from third parties),
so it can't be called; its exports come in as ordinary footage.

| Topic | Decision |
|---|---|
| Provider | kie.ai (one key, one credit wallet, ~$0.005 a credit; Wan 2.5, Kling 3, FLUX 2). Behind a small provider interface (`server/src/ai/hosted/`: `submit`, `poll`, `download`, `price`) so fal.ai or Replicate can be added without touching callers. The key is stored server-side only (never in `publicAccount`-style responses or logs) |
| Text | No hosted text API. Claude stays on the subscription login (the *no Anthropic API key* rule stands) and falls back to the local model as built in phase 9 |
| Where each thing runs | Pictures and clips: *hosted*, *home PC* or *auto* (hosted when a key is set and the cap allows, else the worker), set per kind in Settings → Models. Hosted clips ignore the night window and take minutes, not hours. The edit, render, Whisper, FFmpeg, captions, effects and stock voices stay on the machine running the server |
| Quality | Clips: Wan 2.5 / Kling 3, 720p or better, ~5 s, about $0.30–0.40 each; stills: FLUX 2 1K–2K, ~$0.025. Hosted clips are upscaled to 1080×1920 with FFmpeg when needed |
| Halal | Unchanged and enforced on our side: prompts describe empty scenes (`EMPTY_SCENE`), the negative prompt is sent where the model takes one, and every result is checked (task `pictures`, three frames of a clip) and made again or dropped. Each retry is paid, so retries count against the cap |
| Spend cap | $10 a day (Settings → Models, editable), kept in a ledger table (`ai_spend`: provider, model, kind, credits, dollars, piece, time). A request that would pass the cap waits until tomorrow (job `wait`), or falls back to the home PC when the setting is *auto*. Shown as today's spend on the Models card and on each job |
| Failures | The task id is saved in `jobs` so a restart resumes polling and never pays twice; a refused prompt (provider moderation) counts as a failed try; the result file is downloaded at once because provider links expire |
| Crayo | Not integrable. Exports go into Footage like any footage; nothing else to build |
| Voice | Stock Kokoro voices stay free on the laptop. A hosted cloned voice is not planned (open question: only if the Chatterbox result on the home PC isn't good enough) |

Steps: (1) `shared/ai.ts` + settings: generation backend per kind, hosted settings, cap; (2) kie.ai client + provider
interface + ledger, tried against a stand-in at `CS_HOSTED_API` (like `CS_PLATFORM_API`); (3) `studio/generate.ts`
takes the backend: hosted path skips `WORKER_ONLY` and the window, same check and retries, same placement;
(4) Settings → Models card: key (write-only), backend per kind, cap, spend today; Generate dialog shows the
estimated price; (5) docs (CLAUDE.md rule on the hosted key and the cap), typecheck, commit, push.

Waiting on me: a kie.ai key (80 free credits to test), the real prices from its dashboard (the figures above come from
search results and its marketing pages), and which Wan/Kling model names its API exposes today.
