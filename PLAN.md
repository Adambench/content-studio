# Content Studio — plan

Decisions, measurements and what's left. What's built is in the code and git history; don't re-describe it here.

## Decisions

| Topic | Decision |
|---|---|
| Users | Just me (single user) |
| Where | Electron desktop app on the laptop (Zorin 18, i5-1135G7, 16 GB, Iris Xe) runs its own server; the phone uses the Android app (or PWA) over Tailscale Funnel's `*.ts.net` address |
| Posting | Each platform's official API with my own developer apps; no aggregators. Formats: short vertical video + image posts/carousels |
| Claude | Agent SDK on the Claude Pro login, never an API key. Edits ideas/drafts/edits freely; scheduling, publishing, approving and submitting are always my click |
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
   - [ ] Step 3 — Compute workers on the home PCs
   - [x] Step 4 — Skills and the creative arsenal (2026-10-16; no new skills installed, see the step)
   - [ ] Step 5 — Creative directions (personal/business) and varied clip edits (clipping)
   - [ ] Step 6 — One-button finder for clipping pages
   - [ ] Step 7 — Effects library, local only

## Waiting on me

- Phase 0 on the platforms' sites, then connect real accounts.
- Settings → Clip tools → Install in the real app (~3 min, 1.4 GB), then a real campaign source through to Review.
  Listen to the first clips from a source with background music (the music check was only tried on stand-ins).
- Listen to the built-in SFX and the voices; drop any I don't like.
- A format video and a UGC video for real.
- Research: each page's *What it watches* (or *Find channels for me*), *Run now* once; sign in to TikTok.
- Settings → Connected sites: sign in to Whop (contentrewards.com), TikTok, Instagram; check each says “Signed in”.
  Whop's session cookie is a guess (`SITES.whop.sessionCookie`): if it stays “Not signed in”, list the HttpOnly
  cookies on contentrewards.com and pin the right one. Then “Try a page” on a joined campaign (rules and files should
  be in the text).
- After a clip is posted and submitted: campaign → Submissions → *Check now*; if nothing matches, the submissions page
  doesn't show post links → adjust `syncSubmissions`.
- Not run with a real chat yet: `write_scene`/`view_overlay`, `write_format_video`, `write_ugc_video`, transitions;
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
| Effects | Free and local only, rebuilt in code (HyperFrames + FFmpeg): orbit, couch wall, UI world, frame break, digital zoom, phone mockup, checklist, headline wall, zoom-through cut, chart grow, pull-back reveal, green screen, paper cut, doodle boil, vertigo, cover story, glass type; plus paper collage, hand-drawn and film looks. Cut-outs of a person by a local matting model. No paid image/video generation. onetake isn't used (non-commercial licence); Clawd is Anthropic's mascot, so the cartoon style uses my own characters |
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

**Step 3 — Compute workers.** A small worker (Node, systemd service) on each home PC, reached over Tailscale and
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

**Step 5 — Directions and variety.** Personal/business: `direction.pitch` (one Sonnet call with the playbook and the
arsenal) → 2–3 directions on the package; picking one writes the script/edit plan. Clipping: `clip.make` chooses an
edit direction per clip from the arsenal (hook card style, captions, graphics, transitions, effects) and varies it
across the page's recent clips.

**Step 6 — Finder.** Campaign discovery (the signed-in window reads Content Rewards' campaign list; rank and screen;
Today/Find shows them to join), creator sources (channels from the brief, yt-dlp listings, ranked), viral-moment
matching (YouTube Shorts / TikTok searches for the creator's clips, outliers by views, their transcript found in the
source), auto research (channels suggested and added), the *Find clips* button with one progress view. Daily.

**Step 7 — Effects library.** The effects above as templates/scenes/edit effects with previews in the editor and in
the arsenal; a local person matte (u2net human seg via onnxruntime or HyperFrames' `remove-background`) cached per
clip for frame break, green screen, vertigo, cover story and couch wall.
