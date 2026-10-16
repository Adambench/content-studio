# Content Studio — plan

A personal desktop app: ideas → scripts → footage → edits → scheduled posts across
TikTok, Instagram and YouTube Shorts (X later), with Claude built in.

## Decisions (2026-10-14)

| Topic | Decision |
|---|---|
| Users | Just me (single user, password login) |
| Posting | Direct official APIs only — no aggregator services |
| Where | Desktop app (Electron, launcher + tray, start at login) on the laptop; installable Android PWA on the phone |
| Name | Content Studio (renamed from “Cadence” on 2026-10-14 — more descriptive) |
| Hosting | Runs on this Linux laptop (Zorin 18, i5-1135G7, 16 GB, Iris Xe); the desktop app starts its own background server |
| Remote access | Tailscale Funnel's free `*.ts.net` HTTPS address (own domain available if a platform needs domain verification) |
| Claude | Claude Agent SDK on the Claude **Pro** subscription login — **no API key**. Model selectable in settings (Sonnet default). |
| Claude autonomy | Edits ideas, drafts, versions freely; scheduling/publishing always needs my click |
| Voice | Per-workspace brand guide + past posts + learning from my edits to Claude's drafts |
| Workspaces | Separate brands/niches, fully isolated; I create them myself. Since 2026-10-15: one workspace = one page, with a kind (see *Use cases and organisation*) |
| Versions | Alternatives (branches), each with its own version history; compare + restore |
| Layout | Pipeline board + Claude side panel; dark, clean UI |
| Formats | Short vertical video (TikTok, Reels, Shorts) + image posts/carousels (IG, TikTok photo) |
| Video editing | HyperFrames (HTML → MP4) + FFmpeg: captions, cuts/reframe, motion graphics, b-roll, transitions, sound design, colour grading (LUTs), branded templates |
| Scheduling | Drag-and-drop calendar, per-account time-slot queues, cross-post with staggered times |
| v1 extras | Analytics, push notifications, idea capture from the phone |
| Assets | Import area per workspace (logos, fonts, LUTs, SFX — no music, see *Halal*); none exist yet |
| X | Low priority — after the other three |

## Platform constraints (checked 2026-10)

- **Instagram** — Business/Creator account; publishes Reels, carousels, Stories; no native scheduling (our
  scheduler publishes on time); media must be at a public HTTPS URL; ~50–100 API posts / 24 h.
- **TikTok** — unaudited apps can only post private; until the audit passes, use "upload to inbox" (draft →
  tap Post in the TikTok app). Audit needs a demo video of the finished flow.
- **YouTube** — unaudited projects' uploads are forced private; submit the API audit form. Keep the OAuth
  consent screen "In production" or refresh tokens expire after 7 days. No image posts via API.
- **X** — pay-per-use credits (~$0.015/post, ~$0.20 with a link).

## Architecture

```
Desktop app (Electron) ── window + tray ──┐
                                          ├── server (Fastify, run with Electron's Node) ── node:sqlite
Phone (PWA) ── Tailscale Funnel ──────────┘     ├─ job worker: probe · Whisper · capture · voice learning · (renders, publishing)
                                                ├─ Claude Agent SDK (subscription login) + in-process "studio" MCP tools
                                                └─ ~/.local/share/content-studio: db · media · thumbs · transcripts · whisper
```

## Phases

0. **Setup (parallel, audits take weeks)** — IG → Creator + Meta app (Instagram API with Instagram Login);
   TikTok developer app (Login Kit + Content Posting API); Google Cloud project + YouTube Data API v3 + audit
   form; Tailscale + Funnel.
1. **Pipeline + Claude** — done (desktop app since 2026-10-14)
   - [x] Workspaces (isolated, custom pipeline stages, brand guide, voice memory)
   - [x] Pipeline board (drag-and-drop)
   - [x] Piece editor: hook, script, notes, per-platform captions; alternatives + version history, compare, restore
   - [x] Media library + brand-asset import, uploads from the phone, thumbnails
   - [x] Local Whisper transcription (word timestamps, for captions later)
   - [x] Claude panel (Agent SDK, streaming, tools over the app's data, frames from footage, web research)
   - [x] Learning from my edits → workspace voice memory
   - [x] Idea capture: voice memo / text / Android share sheet → transcribed → Claude turns it into an idea card
   - [x] Push notifications
2. **Video studio** — in progress (started 2026-10-14)
   - [x] Versioned edit per piece (JSON in `shared/edit.ts`), started from the piece's footage in the brand's look
   - [x] Compiled to a HyperFrames composition: live in-app preview (`<hyperframes-player>`) = what renders
   - [x] Captions from word timestamps (4 styles, brand fonts, fix misheard words); text/image/b-roll overlays
   - [x] Tighten: cut pauses/fillers from word timings (silence detection without a transcript), punch-ins
   - [x] Reframe (focus point + zoom), 9:16 / 4:5 / 1:1; preview copies of footage (HDR tone-mapped, HEVC → H.264)
   - [x] SFX, voice clean-up, −14 LUFS loudness; LUT grading (FFmpeg). The music track became a vocal-only nasheed
     track only the user sets (phase 7, step 3; see *Halal*)
   - [x] Render queue in a child process (headless Chrome downloaded on first render), result into the library
   - [x] Brand look (template) per workspace; Claude tools: get/update/tighten/render edits, list assets
   - [x] Transitions between clips, animated motion-graphics templates and Claude-written scenes (phase 7 step 9)
   - [x] Automatic reframing (face tracking, following the speaker; phase 7 step 9)
   - [ ] Grade shown in the preview
   - [ ] Hardware encoding: needs an FFmpeg that matches the system libva (see below)
3. **Scheduling & publishing** — built (2026-10-14); tested end to end against a stand-in for the three APIs, not
   yet against the real platforms (that needs phase 0)
   - [x] Settings → Publishing: developer-app credentials, the redirect URIs to register, public address (detects
     the Tailscale name, checks the Funnel reaches the app), TikTok URL-prefix verification file
   - [x] Account connections per workspace: TikTok Login Kit, Instagram Login, Google (PKCE); tokens refreshed before
     they expire and checked every 6 h, profile pictures refreshed, “reconnect” alerts
   - [x] Calendar: week / month / list, drag posts to reschedule, drag ready pieces onto a day or a free queue time
   - [x] Queues: weekly time slots per account; “Next queue time” takes each account's next free one
   - [x] Schedule dialog: what (finished render, other video, or photos → carousel), where (cross-post), when (queue,
     a time with stagger, now), per-platform copy and options, problems checked before saving
   - [x] Publish engine: TikTok (inbox or direct; chunked video upload; photos pulled from public links), Instagram
     (Reels, photos, carousels, via public links; daily-limit check), YouTube (resumable upload). Retries resume
     from saved platform state, so nothing goes out twice; a restart picks up where it stopped
   - [x] Catch-up after sleep (posts late within a set window, otherwise “missed” + notification); logind sleep
     inhibitor while a post is due
   - [x] Alerts on every device for posted / in TikTok inbox / failed / missed / reconnect; Calendar badge, board-card
     status, cards move to Scheduled and Posted by themselves
   - [x] Claude reads the schedule (`get_schedule`) and suggests; it can't schedule, publish or change posts
   - [ ] Connect the real accounts and post for real (after phase 0)
   - [ ] Record the TikTok audit demo (script below)
4. **Analytics & feedback** — built (2026-10-15); tested against a stand-in for the three platforms' stats APIs and one
   real Claude review, not yet against the real platforms (that needs phase 0)
   - [x] Stats from the platforms' APIs (no scraping): TikTok Display API (views, likes, comments, shares; followers),
     Instagram insights (views, reach, likes, comments, shares, saves, Reels watch time; followers), YouTube Data API
     (views, likes, comments; subscribers) + YouTube Analytics (watch time, % watched, shares, subscribers gained)
   - [x] Read on a schedule by post age (every 3 h for 2 days, 12 h for a week, daily to 30 days, weekly to 90), each
     reading kept so posts compare at the same age; followers once a day per account; *Refresh* reads now
   - [x] TikTok inbox drafts: their video is found once you post it from the app (and public); or paste its link
   - [x] Analytics page: KPI tiles vs the previous period, each post against its account's typical post (views after
     24 h), followers over time, best time of day / weekday per account, sortable posts table; post sheet stats with
     views over time; board cards show views
   - [x] Missing permissions (accounts connected before analytics, the YouTube Analytics API not turned on) say so
     on the account, with *Reconnect*
   - [x] Weekly review (Settings → Weekly review; Mondays 9:00 by default, catches up within 3 days): wins and why,
     lessons, ideas (*Add to board*), queue-time suggestions (*Use these times*), voice memory additions (*Undo*);
     notification; *Review now*
   - [x] Claude reads results in chat (`get_analytics`, read-only)
   - [ ] Real numbers from real accounts (after phase 0)
5. **Later** — X, comments inbox.
6. **Android app** — a real app installed and updated through Obtainium from GitHub Releases, replacing the PWA on the
   phone. Built (2026-10-15); tested on an Android 15 emulator against a local server, not yet on a real phone or from a
   real release (needs the GitHub repo and signing secrets) — see *Android app plan* below.
   - [x] `mobile/` Capacitor 8 project (committed `android/`), app icon/splash/notification icon as vectors from
     `desktop/icons/icon.svg`, `.github/workflows/android.yml` (tag → signed release APK; main → debug APK artifact)
   - [x] Pairing: QR code / link from desktop Settings → Phone access (one-time code, 10 min), device token kept with an
     Android Keystore key, paired phones listed and unpairable; bearer auth, `?access_token=` for header-less GETs,
     CORS for `https://localhost`, API version check both ways
   - [x] App build of the web UI (`vite --mode app`): API on the paired server, no service worker, offline banner,
     workspaces cached for offline capture, video preview loaded as srcdoc
   - [x] Push: FCM, set up entirely from the desktop (google-services.json + service-account key pasted in Settings →
     Notifications; the app starts Firebase with options fetched from the server — no Firebase file in the APK)
   - [x] Share sheet → workspace/piece picker; resumable uploads (`/api/uploads`) from a WorkManager queue that
     survives restarts; in-app Upload/Camera use Android's picker and camera and the same queue
   - [x] Voice memos recorded natively and queued offline; text ideas queued offline; launcher shortcuts; back button;
     edge-to-edge insets; optional fingerprint/screen-lock
   - [x] Repo on GitHub (private, `Adambench/content-studio`), release keystore in
     `~/.config/content-studio/android-release/` (back it up!) and the signing secrets; v0.1.0 released by CI
   - [ ] Real-phone test: install from Obtainium, pair, QR scanning (Google's code scanner needs Play services; the
     emulator image couldn't download it), FCM with a real Firebase project
7. **Clipping, campaigns & research** — built (2026-10-15 to 2026-10-16), steps 1–9; see *Use cases and organisation*,
   *Halal*, *Clipping plan* and *Formats decisions* below
   - [x] Skills survey (shortlist → I picked, 2026-10-15): 35 skills in `.claude/skills` — HyperFrames (core,
     animation, keyframes, creative, registry, cli, motion-graphics, embedded-captions, talking-head-recut; not its
     audio/media/music skills), GSAP (core, timeline, plugins, utils, performance), Melvynx video-agent (clips,
     studio-script, steal, broll), Vyral content-skills (all 7), Corey Haines (social, copywriting,
     marketing-psychology, content-strategy, offers), last30days (terminal), Contagious, Made to Stick,
     content-principles. Skipped: the MrBeast persona skill, social-media-skills (routes to paid tools), Apify/muapi
     (paid), a film sound-design skill (built on music)
   - The *Phase 7 build plan* below, step by step:
   - [x] 1 Playbook skill (`.claude/skills/playbook`, 2026-10-15): `SKILL.md` + hooks, retention, clipping, packaging,
     sound design, halal, platforms. Tested: a fresh Claude Code session asked to "pick moments" from a real 42-minute
     podcast transcript loaded it, read `clipping.md`, `hooks.md` and `halal.md`, and gave 7 scored moments with hook
     cards, music and swearing flags
   - [x] 2 Skills in the app (2026-10-15): `.claude/skills` as the `studio-skills` plugin (built in the data dir in
     development, shipped as `claude-plugin/` in the package), 16 knowledge skills allowed, Read limited to the
     plugin folder by a PreToolUse hook, claude.ai connectors turned off for every Claude call, the halal rule and
     skills in the chat prompt, `hooks.md` + `halal.md` (+ `retention.md` for the weekly review) pasted into the
     background prompts. Tested in dev and from the packaged build: "what makes a good hook" opens the playbook and
     reads `hooks.md`; reads outside the skills are refused; a captured idea follows the playbook
   - [x] 3 Workspace kinds, Today, music out of the code (2026-10-15): `kind`/`modules`/`niche` on workspaces
     (`KIND_PRESETS`; kind cards on New workspace, kind + module switches + niche in settings; nav filters by module,
     Capture lists workspaces with Ideas, the grade section and LUT assets need Grading), a section per kind in the
     chat prompt (kind and niche also in the weekly review and idea capture); Today at `/today` (home, first in the
     phone's bar, badge in the sidebar) from `GET /api/today`; music → `nasheed` (edit field, asset type with a
     vocal-only confirmation, Claude's saves keep the user's nasheed, compose/render play only nasheed assets),
     SFX only from sound-effect assets or the 31 built-ins (`server/assets/sfx`, `shared/sfx.ts`, built by
     `server/scripts/make-sfx.py` from Kenney CC0 sounds and our own synthesis), TikTok's auto-add-music gone (always
     `false`; older apps' value is dropped), `API_VERSION` 2. Tested: API checks, Claude's tool handlers, a real render
     (nasheed + built-in whoosh and boom in the mix), a real chat on a clipping page (adds a built-in whoosh, refuses
     music, leaves the nasheed), screenshots of Today, New workspace, settings, assets and the Sound tab at desktop
     and phone width. Still to do: the user listens to the built-in SFX (Brand assets → Sound effects → Built in) and
     approves or drops some
   - [x] 4 Signed-in windows (2026-10-15): the desktop app spawns the server with an IPC channel; `readPage` (a
     hidden, muted window in the `persist:sites` session: waits for the text to settle, optional selector/scrolls,
     inner scrolling panels too; title, text, links, login-wall flag), sign-in windows (muted, pop-ups kept in the
     session), sign out clearing that site's cookies and storage, signed-in state from each site's HttpOnly session
     cookie; one page at a time, ≥ 5 s apart, 200 a day; Settings → Connected sites (Whop = contentrewards.com, which
     has its own sign-in; TikTok; Instagram; "Try a page") and `parsePage` (page text → JSON on Haiku). A
     `CONTENT_STUDIO_DATA_DIR` now also gets its own Electron profile. Tested on the laptop (Xvfb, built app): a
     stand-in joined-campaign page (rules drawn late by script, sections that load as you scroll, an inner scrolling
     panel) comes back whole and Haiku turns it into its 7 rules and 2 source links; the real Content Rewards discover
     page (campaign links) and a public campaign page read signed out, Haiku giving rate, min/max payout per platform
     and budget, with rules empty (locked until joined); an Instagram page behind sign-in is flagged as a login wall;
     three reads sent at once ran one at a time 8.7 s apart and a read over the cap was refused; sign-in windows open
     on the real TikTok, Instagram and Content Rewards pages; signing out of TikTok cleared its cookies and local
     storage and left the other sites'; Settings at desktop and phone width, in the app, a browser and without the
     desktop app. Not tested: a real sign-in (see *Where things stand*)
   - [x] 5 Campaigns (2026-10-15): `campaigns`, `campaign_pages`, `campaign_sources` (migration 0006); add from a
     Content Rewards link (read through the signed-in window, a plain fetch outside the desktop app) or a business's
     brief; one Haiku call (`campaign.read`) gives the details, payouts per platform, budget, the rule checklist (with
     the checks the app can do itself) and the halal screen; confirm with pages (a rejected one can't be); sources by
     link (a video, a YouTube or Twitch channel or playlist lists its 30 latest, a Drive file or public folder, a direct
     file) or upload, downloaded with yt-dlp into `sources/<campaign>/`, then transcribed from YouTube's captions or
     with Whisper; `/campaigns` and `/campaigns/:id`, Today (to confirm, active, downloads), `get_campaigns` and
     `get_campaign` for Claude. Tested with the built app on real pages: Mark Manson's podcast campaign (flagged:
     swearing and music intros to check), LANY (rejected: music artist), LIV Las Vegas (rejected: nightclub, DJ sets),
     SoFi (flagged: may be interest-based lending), a business brief (8 rules, 6 checked automatically); confirming a
     rejected one or with no pages refused; a channel listed 30 videos; a 43 min and a 17 min episode downloaded at
     1080p H.264 with progress and their captions turned into word-timed transcripts; a 75 s upload transcribed by
     Whisper; the same video pasted as `youtu.be`, `&list=` or Shorts is found again; a Kick channel (live now) is
     refused; deleting a campaign mid-download stops yt-dlp (its standalone build runs a second process, so the whole
     process group goes); Claude's tools only see the page's own campaigns; screenshots at desktop and phone width.
     Not tested: Twitch and Kick VOD downloads (Twitch channels list), Drive (no public link to hand), a joined
     campaign's locked rules and files (needs the Whop sign-in)
   - [x] 6 Clipping v1 (2026-10-16): the clip tools (`setup-tools.sh` → `<data>/tools`: PyTorch CPU, Demucs, OpenCV
     YuNet, gdown and their models, 1.3 GB; Settings → Clip tools); `moments` (migration 0007); after its transcript an
     active campaign's source is scanned (`source.scan`, no Claude: windows of 20–75 s on line boundaries scored on
     loudness, pace, chat replay, the brief's words; a source up to 15 min goes whole) and picked (`source.pick`, one
     Sonnet call with the playbook, rules, pages' niches and past rejection reasons; 3–8 moments kept at 7/10+, snapped
     to word boundaries); each moment is made (`clip.make`): cut with 0.5 s margins, Demucs (the clip keeps only the
     voice; dropped when the voice isn't silent in the pauses behind background sound), Whisper on the voice, three
     frames to Haiku, YuNet focus, a card in Making with Claude's captions and notes, an edit in the page's look (tight
     tighten with punch-ins, captions, hook card with its accent word, a pop and one soft whoosh) and a render; the
     render finishing moves it to Review. `/review` (sidebar + Today): the render, the moment, the campaign's rules
     checked (length, mentions/hashtags/text in each platform's caption, platforms, watermark; the rest as tick boxes),
     where it goes; **Approve & queue** (next free queue time of each account on the campaign's platforms, accounts that
     can't take it skipped with the reason; TikTok direct asks who sees it), **Reject** with a reason (card and files go,
     the reason feeds the next pick), Open in studio; swipe/arrow keys move through the queue. Campaign page: Moments
     card (status, Make clip / Make again / Skip, open the clip) and Find moments on ready sources. Claude:
     `find_moments`, `make_clip`, moments in `get_campaign`; it can't take a card out of Review or into
     Scheduled/Posted. Background Claude jobs wait while the 5-hour usage is ≥ 80 %; clip-making waits while a render
     runs (both fill the CPU and memory); clips not made yet wait when their campaign is paused. Text overlays show `*word*` in the accent colour. Drive files Drive won't
     hand over fall back to gdown. Tested on the laptop with the real Mark Manson campaign: the 17-min episode gave 5
     moments (7–8/10) and the 43-min one 6 (8–9/10, a swear flagged), all made into 1080×1920 clips at −14 LUFS framed
     on the speaker (≈3.5 min to render 35 s with the CPU free); a clip whose hashtag rule failed couldn't be approved,
     then after fixing the caption was queued on a stand-in YouTube account (Instagram skipped: no public address, TikTok
     left out: the campaign doesn't pay for it) and its card moved to Scheduled; a reject removed the card, cut and
     render and kept the reason; a business campaign's upload gave a 25 s clip whose captions carried its required
     hashtag, mention and link on all three platforms (6 of its 8 rules checked automatically, all passing); a moment
     still waiting its turn can be skipped; Claude's tool handlers checked for scoping; the in-app install from a fresh data folder;
     screenshots of Review, Today, the campaign page and Settings at desktop and phone width. Not tested: a source with
     real background music (the music check was verified with non-musical stand-ins), a Twitch chat replay, Drive via
     gdown, the frames check rejecting something
   - [x] 7 Submissions and earnings (2026-10-16): `submissions` (migration 0008, plus `campaigns.budget_checked_at` /
     `budget_warned_at`); a Content Rewards campaign clip's post that's out with a link (after posting, after stats find
     a TikTok inbox draft's link, after linking one by hand, and at start) gets a `to_submit` submission on the
     platforms the campaign pays for, with a notification. Today lists them: Copy link, **Open campaign** (a new
     `open` op of the desktop bridge opens the campaign page in the signed-in window; the phone and a browser open it
     in the browser), **Done** (submitted) or "Don't submit". Content Rewards' own pages are `/c/submissions` and
     `/c/earnings` (found in its route table; a clip is submitted with the campaign page's "Submit clip" button).
     `submissions.sync` (daily while any wait on a campaign, and *Check now*): reads `/c/submissions` in the signed-in
     window, one Haiku call lists post link, status (pending/approved/rejected/paid/flagged), counted views and
     earnings, matched to my posts by `postKey` (TikTok video id, Instagram shortcode, YouTube id); a login wall says
     to sign in to Whop; the edit dialog sets status, views, earnings and a note by hand. `campaign.budget` (daily, a
     plain fetch, no Claude) reads budget left/used and "Accepting clips" off each active campaign's public page and
     notifies once when under 15% or not accepting. Campaign numbers (`campaignResults`): clips made / approved / rejected
     by me, posted, views (our stats), submissions by status, the campaign's approval rate, earned, paid, estimated
     (views × rate within min/max payout; under the min = $0), per clip, budget low — on the campaign page (Results and
     Submissions cards), Today's campaign tiles, Analytics (a campaign filter: only its clips, plus its numbers), the
     weekly review's digest and `get_analytics`, and Claude's `get_campaign` (read-only). Tested with the built app on
     the step-6 data: a scheduled clip posted to a stand-in YouTube got its submission and notification; views from
     the stand-in's stats gave a $5.25 estimate (4,200 × $1.25/1K); Open campaign opened the real campaign page in
     the signed-in window; Done; *Check now* against a stand-in submissions page (`CS_SUBMISSIONS_URL`) read it in the
     window and Haiku matched the YouTube Short (approved, 4,812 views, $6.02) and reported the one it couldn't match;
     the real `/c/submissions` signed out came back as a login wall; the budget read off the real page ($18,287 left
     of $20,000); screenshots of Today, the campaign page, the edit dialog and Analytics at desktop and phone width.
     Not tested: the real submissions page signed in (no Whop account to try), so its layout (and whether it gives post
     links) is unknown
   - [x] 8 Research and daily brief (2026-10-16): `workspaces.research` (keywords, YouTube channels, TikTok and Instagram
     handles), `research_items`, `research_briefs` (migration 0009). The watch list is edited on the page's Research
     page and in Workspace settings; *Find channels for me* searches YouTube Shorts for the keywords (or the niche)
     and suggests channels that keep coming up (established ones first). `research.sweep` (daily after 7:00 per page
     with the module on, or *Run now*; no Claude): a YouTube channel's Shorts tab via yt-dlp (30 newest with views,
     5 s each), keyword searches (`ytsearch… #shorts`, the busiest new channels scored too), TikTok and Instagram
     profiles through the desktop window (signed out works: the grid's links carry each post's views; post dates
     come from TikTok ids and Instagram shortcodes). Each account's usual = the median of its latest posts at least
     two days old (accounts posting ten reels a day have many hours-old ones; without dates, after the 3 newest);
     outliers at 3× or more, posted within 45 days; YouTube outliers get their first spoken words from the captions,
     TikTok/Instagram ones their caption via yt-dlp. `research.brief` (one Haiku call, waits while usage ≥ 80 %):
     patterns with the outliers behind them, topics, 3 ideas (*Add to board*), 5 hooks, and on a clipping page what
     moments to look for (fed to `source.pick`); skips anything musical or haram. Shown on Today and the Research
     page (`/w/:wid/research`, nav item and phone top bar when the module is on), readable in chat (`get_research`).
     *Analyse* a link (YouTube, TikTok, Instagram: yt-dlp downloads them all now) or a library video
     (`research.analyse`): measured length, hard cuts (FFmpeg scene detection), words per second (captions or Whisper),
     four frames and the transcript to Claude (the chat's model) → hook (said, on screen, seen), beats, edit, why it
     works, takeaways for the page, cautions (music, haram, claims); never the words. Tested on the step-6 data with
     real accounts: Find channels; a sweep of 3 YouTube channels, a keyword, Instagram @hormozi and TikTok @garyvee →
     230 posts, 20 outliers, a brief with 3 patterns, topics, ideas and moments to look for (its notes kept the halal
     rule: music, cure claims, religion stories); a YouTube Short analysed (36 cuts in 161 s, 3.7 words/s, a sharp
     breakdown), a TikTok analysed (no speech, so no pace); the library analysis waited for Claude's usage as it
     should; `get_research` scoped to the page; screenshots of the Research page, an analysis, Today and the watch list
     at desktop and phone width. Found: signed out, TikTok sometimes answers "Something went wrong" instead of the
     grid (@garyvee; @mrbeast read fine): the sweep says to sign in to TikTok; Instagram's reels grid has no captions
     (fetched with yt-dlp instead)
   - 9 Later (2026-10-16), in parts:
     - [x] Source videos of ended campaigns deleted after a set time (Settings → Clip tools: a day, a week (default), a
       month, or keep; `campaigns.ended_at`, migration 0010); their transcripts, scans, moments and clips stay. A
       paused or ended campaign's Source videos card can delete them now; a deleted one shows *Download again* (the
       transcript is kept, so it's ready as soon as it's down). Tested: free refused while active; ended two days ago
       with a one-day setting → both episodes' videos deleted at the next upkeep tick (transcripts and scans left);
       made active, *Download again* brought the 17-min episode back straight to Ready
     - [x] Reframing that follows the speaker (2026-10-16): `scripts/speakers.py` (clip tools' OpenCV, 8 samples a
       second, about 0.2× real time) splits the footage into shots (sudden picture changes) and tracks the faces in
       each, with how much each mouth moves (YuNet's mouth and nose landmarks); `studio/reframe.ts` turns that into
       focus spans: a close-up stays on its face, people who fit side by side stay together, a wide shot too wide for
       the frame goes to whoever's mouth moves most (a window a second, smoothed, held ≥ 1.5 s, zoomed so the face
       reads as a medium shot, ≤ 1.6×), shots of still faces only (a photo, a listener) frame on the biggest one, and
       the main track's clips split where the focus changes (punch-ins kept, running it twice gives the same edit).
       `clip.make` uses it for every clip (its scan is kept for the studio); the studio's Clips tab has **Follow the
       speaker** (`edit.reframe`, a new version; Claude's `follow_speaker`). Times come from each frame's timestamp,
       so variable-frame-rate phone footage lines up. Tested on the step-6 clips (a solo podcast with close-ups and a
       two-person wide shot: the frame stays on the one talking, the listener and a poster ignored), a heavily cut
       two-person interview (41 shots, close-ups and over-the-shoulder two-shots), and a synthetic two-speaker wide
       shot (switches at the turns, ignores a half-second interjection)
     - [x] Transitions (2026-10-16): a clip's `transition` (crossfade, dip to black, flash, zoom through, whip pan, push
       up, blur, glitch; 0.15–1.2 s; an optional matching built-in sound). Only the pictures overlap: each shot runs
       past the cut from its own source (the render cuts each segment with those handles; the preview uses the whole
       file) on a black backing while the clip sound still cuts at the cut, so timings and captions never move.
       Picker in the selected clip (*Use on every cut*), markers on the timeline, `update_edit` for Claude. Tested: a
       render with all eight on a real podcast clip (each checked frame by frame), the picker at desktop and phone width
     - [x] Motion-graphics templates (2026-10-16): overlay type `graphic` with nine templates (`studio/graphics.ts`):
       name tag, big number that counts up (keeps the text's format: `$1,250,000`, `87%`), list that ticks in, quote,
       arrow callout, section card (covers the captions), follow prompt, progress bar, word slam; the accent colour and
       brand font; each with its own built-in sounds (switchable). *Motion graphic* menu and per-template fields in
       Text & images; Claude through `update_edit`. The HyperFrames/GSAP knowledge skills (`hyperframes-animation`,
       `hyperframes-creative`, `motion-graphics`, `gsap-core`, `gsap-timeline`) joined the app's allow-list. Tested: a
       render with all nine, the editor and menu at both widths
     - [x] Scenes Claude designs (2026-10-16): overlay type `scene` (`shared/scene.ts`): elements (box, text, SVG path,
       library image) with allow-listed CSS and GSAP tweens as JSON, built into the page with everything escaped — no
       script, no `url()`, no `random()`, ids and eases checked, finite repeats. `write_scene` (what's dropped is
       listed back) and `view_overlay` (the overlay alone over a still of the footage, rendered by HyperFrames at
       10 fps: ~7 s). Tested: a hand-written scene with injection attempts (style breaking out of the attribute,
       `url()`, `onComplete`, `innerHTML`, a bad ease) — all dropped and reported, the rest rendered as designed
     - [x] Format videos from words (2026-10-16, see *Formats decisions*): story + gameplay, fake texts, talking
       characters. Tested with the built app's server on the step-6 data: one of each built (Kokoro voice, Whisper
       timings, the generated background) and rendered at −14 LUFS: the post card then 2-word captions; messages
       growing in and pushing up; Sam and Lina with mouths following their lines, leaning in when they talk; Claude's
       `write_format_video` handler made and built a dialogue; voice samples; the Script tab at both widths
     - [x] UGC (2026-10-16): `pieces.campaign_id` (migration 0011) links a filmed piece to its campaign; *Filmed
       videos* on the campaign page (page, optional angle) → `ugc.script` (one Sonnet call with the playbook) writes a
       card with the hook, what to say with shot cues, a shot list, every requirement as a checklist and captions with
       the campaign's mentions, tags and link; its review checks the campaign's rules, its posts get submissions, the
       results count it; Claude's `write_ugc_video`. Tested: a real run on the business campaign (a 35 s founder story,
       five shots, ten requirements, `#myshop @myshop myshop.example` in every caption), a posted UGC post getting its
       `to_submit` submission, the card at desktop width

8. **Streamlined video pipeline** — planned 2026-10-16; see *Phase 8 build plan*
   - [ ] Step 1 — Every video is a package; nav per kind; Inbox + search instead of the Library
   - [ ] Step 2 — Feedback loop in the package (timestamped notes → Claude edits → re-render → before/after)
   - [ ] Step 3 — Skills and the creative arsenal
   - [ ] Step 4 — Creative directions (personal/business) and varied clip edits (clipping)
   - [ ] Step 5 — One-button finder for clipping pages
   - [ ] Step 6 — Effects library, local only

## Formats decisions (2026-10-16)

| Topic | Decision |
|---|---|
| What a format is | A recipe on the edit (`shared/recipe.ts`): the words and voices, and (after a build) each line's time. The background, voice track and captions are ordinary edit parts, so everything else in the studio still works on it |
| Speech | Kokoro 82M (Apache-2.0, int8 ONNX, 92 MB + 28 MB of voices) in the clip tools' venv via `kokoro-onnx`, checked by SHA-256 at install. 12 English voices that grade well; samples in the Script tab. Not Piper (flatter), not voice cloning (the free models are non-commercial) |
| Voiceover track | Only speech made here (`source: tts`) or a voice memo recorded in the app (`capture`), never an uploaded file: that would be a way in for music. Its words are the captions; muted clips' words aren't |
| Timing | One WAV for the whole recipe, lines back to back with set pauses; each line's start/end from where it landed; Whisper for word times (proportional spread without Whisper) |
| Backgrounds | The creator's own footage (gameplay they recorded, b-roll), muted, from a different point per video; otherwise a slow FFmpeg gradient made once per page. No stock gameplay is bundled (copyright) |
| Story | Title on a generic post card (no platform's branding) while it's read; then bold 2-word captions in the middle |
| Fake texts | A generic messaging screen in the top half (no platform's branding); each message grows in as its voice starts (grid-row height, so layout pushes the others up without measuring); a pop received, a swish sent |
| Characters | Four built-in SVG busts (Sam, Max, Lina in a hijab, Bolt the robot); five mouth shapes switched from the voice's loudness 15 times a second (per line, never drifting), blinks, breathing, the speaker leans in. Drawn, simple and modest |
| UGC | Filmed by the creator: Claude writes the script, shot list, requirements and captions from the brief; editing, review, posting and submitting are the usual flow |

## Video studio decisions (2026-10-14)

| Topic | Decision |
|---|---|
| Edit model | One JSON edit per piece (clips with in/out points, captions settings, overlays, sound, grade, watermark), versioned like drafts; Claude edits it through tools |
| Composition | Server compiles the edit to one HyperFrames HTML page; the preview player and the renderer load the same page |
| Preview | Half-size H.264 copies of footage (constant 30 fps, keyframe every 0.5 s, HDR tone-mapped) so it plays in any browser and on the phone |
| Render | Clips cut at full quality by FFmpeg (trim, tone-map, LUT), HyperFrames draws frames in headless Chrome (3 workers), x264 CRF 17, then a two-pass loudnorm |
| Grading | FFmpeg `lut3d`, not HyperFrames' WebGL grading — that hangs headless Chrome on this laptop |
| Captions | From transcripts (fix words at the source); a cut always starts a new caption chunk |
| Renderer | `chrome-headless-shell` at Puppeteer's pinned build, downloaded into the data folder on first render |
| Encode | HyperFrames tries VAAPI/QSV and falls back to x264. The FFmpeg in `~/.local/bin` (BtbN static) needs a newer libva than Zorin's, so it's x264 for now — a 13 s edit renders in about a minute |

## Analytics decisions (2026-10-15)

| Topic | Decision |
|---|---|
| Source | Each platform's official API with the account's own sign-in (extra read scopes: TikTok `video.list`, `user.info.stats`; Instagram `instagram_business_manage_insights`; Google `yt-analytics.readonly`). Mechanical — no Claude in the sync |
| Comparing posts | “× typical”: views after 24 hours (interpolated from the readings) over the median of the account's other posts from the last 90 days. Raw totals favour older posts |
| Best times | Median “× typical” by part of the day and weekday, per account, only for groups of 2+ posts; small samples are labelled as such |
| Weekly review | One structured Claude request per workspace a week (default model, Sonnet), only when something with numbers went out in the last 2 weeks. Claude gets the numbers already worked out as text with short ids ([A1], [P3]) and answers with JSON |
| Review autonomy | Voice memory: changed directly (it's Claude's own notes, like voice learning), new rules marked “(from results)”, with Undo; skipped if the memory changed while Claude was thinking. Queue times: only suggested — applying them is the user's click, like everything near scheduling. Ideas: added to the board only on click |

## Publishing decisions (2026-10-14)

| Topic | Decision |
|---|---|
| Developer apps | One per platform, shared by every workspace (Settings → Publishing); accounts belong to a workspace |
| Sign-in | The platform's page in the system browser (Google blocks embedded browsers); it returns to `<public address>/api/oauth/<platform>/callback`, proven by a one-time `state` rather than a session (the browser isn't signed in to the app) |
| Public address | Tailscale Funnel. TikTok and Instagram only redirect over HTTPS; Instagram (and TikTok photos) download media from short-lived signed links at `/api/public/media/…`. Instagram's direct upload only exists for Facebook Login apps |
| What a post says | Copied from the piece's draft when scheduled and editable per post — later draft edits (including Claude's) never change what goes out without a click; the post offers “Use the new copy” when the draft moved on |
| TikTok | “Send to inbox” by default (works unaudited; TikTok drafts don't take a caption, so the post has a Copy caption button); “Post directly” after the audit, with TikTok's required UI: creator shown, visibility with no default, interactions off by default, commercial-content disclosure, declarations |
| YouTube | Uploaded at the scheduled time (not YouTube's own `publishAt`), so every platform behaves the same. Unaudited projects' uploads come back private — the post says so |
| Retries | 5 attempts (30 s, 2 min, 8 min, 32 min); rate limits wait for their reset; errors that won't fix themselves fail at once. Each attempt resumes from `posts.remote` (upload session, container, publish id) |
| Late posts | Default: post up to 3 h late after sleep/off, otherwise mark missed and ask. Lid-close still suspends unless logind ignores it |
| Testing | `CS_PLATFORM_API=http://127.0.0.1:9911` sends every platform request (and the sign-in page) to a local stand-in as `/<host>/<path>` |

## TikTok audit demo (to record once Content Posting works)

TikTok wants a screen recording of the whole flow with the app in its sandbox/unaudited state:

1. Settings → Publishing shows the TikTok app; Accounts → Connect TikTok → TikTok's sign-in and consent screen
   (scopes shown) → back in the app with the account (avatar, name).
2. Accounts: switch the account to **Post directly**.
3. Open a piece with a finished video → **Schedule** → pick the TikTok account: the creator's nickname, the visibility
   dropdown with no default (choose one), Comment/Duet/Stitch off until switched on (greyed out where the account
   disables them), Disclose commercial content → Your brand / Branded content with their labels, “Only me” disabled
   for branded content, the Music Usage Confirmation / Branded Content Policy line, the caption being edited, the
   video preview.
4. **Post now** → the post shows Posting → Posted, with “it can take a few minutes to show on your profile”.
5. Open the TikTok app on the phone and show the post (private while unaudited).
6. The review also checks every requested scope is used: show Analytics reading the post's views (`video.list`) and
   the account's followers (`user.info.stats`).

## Android app plan (2026-10-15)

Goal: an APK the phone installs and updates with **Obtainium** (it watches the repo's GitHub Releases), with what a
PWA can't do well: share any file from any app, uploads of big videos that survive the app going to the background,
reliable notifications, voice capture that works offline, home-screen shortcuts. The PWA keeps working as a fallback.

| Topic | Decision |
|---|---|
| Shell | **Capacitor** around the existing React app (`web/`), built into the APK — not a rewrite (React Native) and not a TWA (that's still Chrome showing the website). The UI is already mobile-first |
| Where the UI comes from | Bundled in the APK (opens offline, capture works offline). The app talks to the server at the address you pair with (Funnel `https://<machine>.ts.net`, or the tailnet address if the phone runs Tailscale) |
| Sign-in | **Pairing**, no password: desktop Settings → Phone access shows a QR (server address + one-time code, 10 min) → the app scans it → `POST /api/auth/pair` returns a long-lived device token, kept in Android's encrypted storage. Paired devices are listed and revocable on the desktop. Built: the QR holds `contentstudio://pair?server=…&code=…` (the app's scanner, the camera app or pasting all work); the code is 12 Crockford base32 characters, rate-limited like the password; the server stores only the token's SHA-256; a device sign-in lasts a year from its last use; the token is AES-GCM-encrypted with an Android Keystore key |
| Auth on the wire | `Authorization: Bearer` on API calls. `<img>`/`<video>`/EventSource can't send headers: those GETs (`/api/media/*`, thumbs, proxies, `/api/events`) also accept `?access_token=`. CORS on the server for the app's origin (`https://localhost`) |
| Push | **FCM** via `@capacitor/push-notifications` (needs a Firebase project — add to phase 0; server sends with the FCM HTTP v1 API and a service-account key pasted into Settings). `push_subscriptions` gets a `kind` (`webpush`/`fcm`) and the device's session (unpairing stops its notifications). Built: google-services.json is pasted into Settings too and the app starts Firebase at runtime with options from the server, so one generic APK works with any Firebase project and CI needs no Firebase secret. Alternative if you'd rather avoid Google: UnifiedPush through the ntfy app — then the server needs no change (it already speaks Web Push to any endpoint), but it needs a small custom native plugin |
| Uploads | Native background upload (WorkManager, foreground notification with progress), resumable: new chunked endpoint `POST /api/uploads` → `PATCH /api/uploads/:id` (offset) → finish into the library. Retries and resumes across network drops and app restarts |
| Share sheet | Intent filters for `SEND`/`SEND_MULTIPLE` (video, image, audio, text, links) → pick workspace (and piece) → background upload; text/links become idea captures |
| Capture | Voice memo recorded natively, saved locally first, uploaded when online (queue survives restarts) |
| Distribution | Repo on GitHub (private works: Obtainium takes a GitHub token). Tag `v*` → GitHub Actions builds web (app target) → `cap sync` → Gradle release → signs → attaches `content-studio-<version>.apk` to the release. Every push to main also builds a debug APK artifact |
| Signing | One release keystore, forever (a different key = Android refuses the update). Generate once with `keytool`, store base64 + passwords as Actions secrets, back it up off this laptop |
| App id | `io.github.adambench.contentstudio`; versionCode from the tag (`v1.2.3` → 10203) |
| Versions | `/api/health` reports an API version; the app warns when it's older or newer than the server it's paired with ("update the app" / "update Content Studio on the computer") |
| Toolchain | No Android SDK needed on this laptop: CI builds every APK. Develop the UI in the browser at phone size; try native bits with the CI debug APK |
| Native code | One plugin of our own (`StudioPlugin`, Java like Capacitor's template) instead of community plugins: Keystore pairing, share intents, WorkManager + OkHttp uploads, MediaRecorder, BiometricPrompt, Google's code scanner (Play services, no camera permission). Only official plugins otherwise (`@capacitor/app`, `@capacitor/push-notifications`). minSdk 26 (adaptive icons, channels), target 36 |

Steps (each ends with something installable):

1. **Repo + pipeline** — first commit, push to GitHub; `mobile/` workspace (`capacitor.config.ts`, `android/` committed);
   Actions workflow (build, sign, release); app icon/splash from `desktop/icons/icon.svg`. Add the repo in Obtainium.
   Result: the current UI installs from Obtainium (with a "server address" screen).
2. **Pairing + token auth** — server: device tokens (reuse `sessions` with a device name), `/api/auth/pair`, bearer and
   `?access_token=` auth, CORS, API version; desktop: QR + devices list in Settings → Phone access. Web: an app build
   target (`VITE_TARGET=app`: API base URL, token, no service worker), `web/src/lib/native.ts` (like `desktop.ts`),
   pairing screen (scan or paste), offline banner.
3. **Push** — FCM (or UnifiedPush) end to end; tapping a notification opens the right screen.
4. **Share sheet + background uploads** — the share intent, workspace picker, WorkManager uploader, resumable endpoint.
5. **Capture + polish** — offline voice capture queue, launcher shortcuts (Capture idea / Record voice memo), Android
   back button, status bar and safe areas, optional fingerprint lock. README section: installing with Obtainium.

Before step 1 (on you): a GitHub repo (private or public), and for push a Firebase project (or install ntfy).

## Use cases and organisation (2026-10-15)

Three use cases: my personal brand (Muslim entrepreneurship, lifestyle, Islam; talking head and faceless; later
documenting a business from the start), clipping for campaigns on Whop's Content Rewards, and clipping for my own
businesses. Each one gets the same core: research, ideas, editing, animation/VFX, sound design, scheduling,
analytics. Grading is mainly for the personal brand.

| Topic | Decision |
|---|---|
| Workspace | One workspace = one **page**: an identity with its voice, look, pipeline and analytics, and its accounts on TikTok, Instagram and YouTube, which all post the same content. 1 personal brand, a page per business, 1–5 niche clipping pages |
| Kind | Each workspace has a kind — **Personal brand**, **Business** or **Clipping page**. A kind is a preset of modules, pipeline stages and Claude instructions, not a fence: modules can be switched on or off per workspace |
| Modules | Ideas & scripts, Filming, Grading, Campaigns, Clipping (sources → moments), Research brief; Characters later |
| Campaign | Its own entity, outside workspaces, assigned to the page(s) it fits (usually one niche page). It comes either from Content Rewards (link, rules, payout per 1,000 views, budget, deadline, platforms, source material) or from one of my businesses (that workspace's brand guide, assets and footage), so business clips can also go out on niche pages. 1–3 to start, 2–3 more every 2–3 months |
| Finding campaigns | I pick them on Whop and give the link. The app reads the page, turns the rules into a checklist and screens it (see *Halal*); I confirm |
| Home | A **Today** view across all workspaces: clips waiting for approval, renders, posts due, submissions to prepare, campaign deadlines and budgets, the research brief |
| Shared library | Formats (production recipes), SFX, the virality playbook and Claude skills are shared by every workspace; characters later |
| Same clip on two pages | Rare, since each page has its own niche. When it happens, each page gets its own variant (hook, caption, crop) |
| Direct clients | Not planned: clipping for others = Content Rewards only |

## Halal (2026-10-15)

| Topic | Decision |
|---|---|
| Music | Never music or musical instruments, anywhere. Remove the edit's music track and ducking, TikTok's "auto add music" option and music as an asset type. Claude's instructions state the rule |
| Nasheeds | Vocal-only nasheeds only with my OK for each edit: a vocal track that only the UI can set. Claude can suggest one, but its tools can't add it |
| SFX | Allowed: whooshes, pops, clicks, impacts/booms, dings/chimes, tonal risers/sweeps |
| Source audio | Background music in source footage is removed from the chosen clip by voice isolation (a local model). If it can't be cleaned, the clip is rejected |
| Campaigns and content | Music promotions are hidden. Nothing haram gets advertised: gambling/betting, alcohol/drugs/smoking, dating and immodest imagery, interest-based finance, or anything else haram. Briefs are screened when added; chosen moments are screened by transcript and by sampled frames |

## Clipping plan (2026-10-15)

Goal: crayo.ai, but better — clips made automatically to each campaign's rules, for a handful of niche pages,
approved with one click. First format: stream/podcast clipping (long-form → vertical clips), 5–15 clips a day across
the pages. Free and local only, apart from Claude on the Pro login.

| Topic | Decision |
|---|---|
| Automation | Automatic up to the review queue: the app finds moments, edits and renders them, and I approve each clip with one click before it's queued. Scheduling, publishing and submitting stay my click |
| Sources | Google Drive folders (public link, or the Google sign-in with Drive read access), YouTube, Twitch/Kick VODs (`yt-dlp` through `findBinary`), raw files (library/uploads) |
| Transcripts | faster-whisper once per source (long VODs run in the background); captions use its word timings |
| Finding moments | Mechanical filtering first: loudness spikes, speech pace, chat replay activity where yt-dlp can get it, keywords from the brief. Then one Claude request per source reads only the candidate windows, with the brief and the playbook, and picks moments (in/out points, hook, title, why). That keeps Pro usage to a few requests a day |
| Edit | The existing edit model: cut, tighten, reframe (automatic face tracking, local), captions, hook text in the first seconds, SFX, the campaign's required elements, the page's look |
| Review | Clips land in the page's pipeline (Candidates → Edit → Review → Ready → Scheduled → Posted) and in Today. Rejecting asks for a reason, which is kept so moment-picking learns from it |
| Submissions | After posting, the app prepares the Content Rewards submission (post links, the rule checklist) and I submit it. It tracks pending/approved/rejected, counted views and earnings (views × rate where the campaign's own numbers can't be read) |
| Analytics | The existing per-account stats, plus per campaign: clips, views, approval rate, earnings |
| Research | A daily brief per niche page and campaign (Haiku): what's working now, with links. Skills are surveyed first (shortlist, I pick) and kept in `.claude/skills/`, so both Claude Code in the terminal and the app's Claude load them |
| Playbook | A shared, editable knowledge base on hooks, retention, packaging and clipping, drawn from Hormozi, MrBeast's production doc, Paddy Galloway, Kallaway and clipping-specific guides. Each workspace adds its own learnings "(from results)", like the voice memory |
| Later formats | Story + gameplay, fake texts, talking characters (2D, Minecraft, 3D; my voice or local TTS), UGC. AI-generated only if a free, local route exists |

Checked (2026-10-15):

| Question | Finding |
|---|---|
| Whop API | No Content Rewards API for clippers (Whop's "bounties" API is a different product). A campaign's public page (`contentrewards.com/c/campaigns/<id>`) shows title, rate per 1,000 views, min/max payout, budget left, platforms and type; rules, creator requirements, source files and views are locked until you join. So: an in-app window signed in to Whop reads them and the submission status; submitting stays my click on Whop |
| Skills in the app | Agent SDK 0.3.300 has `skills` and local `plugins` options, so a bundled skills folder loads while `settingSources` stays `[]` — tested: `.claude/skills` copied into a plugin folder (`.claude-plugin/plugin.json` + `skills/`) gives all 35 as `studio-skills:<name>`, and none of my personal skills. But the app's Claude only has the web tools and our studio tools (no Bash, no Read): knowledge skills work (it needs Read on the skills folder for their reference files), and skills that run commands become app jobs/tools |
| Free reel research | YouTube Shorts works with `yt-dlp` (search, a channel's Shorts with view counts, auto-captions for the spoken hook); tested. TikTok blocks `yt-dlp` from this machine, Instagram needs a login: use an in-app window signed in to my own accounts, or links I paste. `yt-dlp` now wants a JS runtime for YouTube: pass `--js-runtimes node` |
| Voice isolation | Demucs `htdemucs` (two stems): 48 s for 70 s of speech over music, 1.5 GB RAM; the cleaned voice is silent where only music played (21 s silent vs 0.3 s in the original). MDX-Net Voc_FT: same result, 94 s and 3.4 GB. → Demucs, on chosen clips only (~30 s per 45 s clip). Install: PyTorch CPU (~900 MB venv) + `demucs` without `diffq` (needs a C compiler) |
| Clip tools install (2026-10-16) | `setup-tools.sh`: PyTorch 2.14.0 CPU + Demucs 4.1.0 (its `diffq` is only an extra now, so a plain install after torch works) + OpenCV headless 4.13 + gdown, htdemucs from Hugging Face, YuNet 2023mar from opencv_zoo: 68 s, 1.3 GB |
| Whisper on long sources (2026-10-16) | faster-whisper `small` int8 on 4 threads: 59 s for 5 min of podcast (0.2× real time, so a 2-hour VOD ≈ 25 min); `base` 42 s, same words. → keep `small` for whole sources; no base-then-small split |
| Music check (2026-10-16) | Demucs on 45 s cuts of a real podcast: ~33 s each; the non-voice stem sits at −40 to −42 LUFS on speech alone (−58 on a quiet one), 14–19 dB under the voice. Podcasts barely pause (0–0.3 s of gaps per 45 s, Whisper word times). → a clip always keeps only the voice stem (speech-only loses nothing: −23.2 vs −23.1 LUFS); background = non-voice stem over −35 LUFS or within 12 dB of the voice; then the voice must be silent in the pauses (p90 under max(−50, speech − 25 dB)), or the clip is dropped; with under 1 s of pauses it's “unverified” and the review says to listen. Checked with non-musical stand-ins (pink noise as the bed, reversed speech as a leftover voice): none / removed / dropped as expected |
| YuNet (2026-10-16) | On 1080p podcast cuts: a face in 9–11 of 12 sampled frames, ~3 s per clip |
| Speaker scan (2026-10-16) | `speakers.py` at 8 samples/s: 3 min of 1080p in 30 s, 2 min of 720p in 23 s. Mouth activity on a solo podcast's wide shot: speaker 0.5–0.9 vs listener 0.1–0.4 every second; a poster 0.02. Frame counts drift on files with dropped frames (a 130 s download read as 121 s): use each frame's timestamp |
| Kokoro (2026-10-16) | int8 model on this laptop: 32 s of speech in 19 s (load 0.7 s); Whisper `small` gives every word back exactly on clean TTS |
| Transitions render (2026-10-16) | 15 s with all eight transitions: 2 min (no slower than without); HyperFrames handles CSS `filter`, `clip-path` and per-frame `grid-template-rows` in headless Chrome |

## Phase 7 build plan (2026-10-15)

To pick this up in a new session, read `CLAUDE.md`, then *Use cases and organisation*, *Halal*, *Clipping plan* and
this section. Work the steps in order. Each step ends with something usable and checked: typecheck, the flow tried at
desktop and phone width, screenshots for UI, the real data where it exists. When a step is done, tick it in phase 7
above and update *Where things stand*.

**Before step 1**
- The working tree has uncommitted work from before phase 7: `desktop/src/main.ts` + `server/src/index.ts` (the
  server exits when the desktop app's stdin pipe closes). Finish and commit that first. Then commit this plan,
  `CLAUDE.md`, `.claude/skills/` and `skills-lock.json`. (Since 2026-10-15: commit and push whenever a job is done,
  without asking — CLAUDE.md *Working rules*.)
- What's already measured is in the *Checked* table above. The steps say what still needs measuring.

### New data

One migration per step that needs it (`npm run db:generate -w server`, then check the SQL for dropped `ON DELETE`).

| Table / column | Step | What |
|---|---|---|
| `workspaces.kind` | 3 | `personal` \| `business` \| `clipping`; existing rows → `personal` |
| `workspaces.modules` | 3 | JSON list of the modules switched on (preset by kind) |
| `workspaces.niche` | 3 | The page's niche in a sentence: research keywords, and how moments are judged for fit |
| `workspaces.research` | 8 | JSON: keywords, YouTube channels, TikTok/Instagram handles to watch |
| `campaigns` | 5 | origin (`content_rewards` \| `business`), business workspace id, link, title, brand, type, status, rate per 1,000 views, min/max payout, flat fee, budget total/left, platforms, deadline, raw rules text, rule checklist (JSON), creator requirements, halal verdict + reasons, when it was last read |
| `campaign_pages` | 5 | campaign ↔ the workspaces it posts on |
| `campaign_sources` | 5 | campaign, kind (youtube/twitch/kick/drive/file), link, title, duration, file path (data dir `sources/<campaign>/`, not the library), transcript, status (queued → downloading → transcribing → scanning → ready / error) |
| `moments` | 6 | source, campaign, target workspace, start/end, spoken first line, hook card text, title, why, standalone score, draft captions, music check, halal check, status (candidate → picked → made, or rejected + reason), piece id |
| `submissions` | 7 | post, campaign, status (to submit → submitted → approved/rejected → paid), submitted at, counted views, earnings, last checked |
| `research_items`, `research_briefs` | 8 | outliers found (platform, link, channel, views, channel median, score, spoken hook) and the daily brief per workspace |

Media stays per workspace. A long VOD belongs to its campaign; only the cut clip (with margins) is adopted into the
page's library (`adoptFile`), so `validateSpec`'s ownership check doesn't change. New entities need live events on
both sides (`LiveEvent` in `shared/types.ts`, `web/src/lib/live.ts`). Bump `API_VERSION` if the Android app can't
handle a change.

### Step 1 — Playbook skill

- `.claude/skills/playbook/` (ours, not in `skills-lock.json`): `SKILL.md` (when to use it, halal rules first) and
  `references/`:
  - `hooks.md`: spoken line, on-screen text and first frame. Archetypes from Kallaway, Hormozi's hook/retain/reward,
    MrBeast's "match the promise", Galloway on packaging.
  - `retention.md`: open loops, re-hooks, pacing, pattern resets, payoff timing, loops.
  - `clipping.md`: what makes a clip stand alone (cold open, one idea, clean end, no outside reference, 20–60 s),
    the 10-point score from Melvynx `clips`, in/out points on sentence boundaries, a hook card when the spoken
    start is weak, following the campaign's rules.
  - `packaging.md`: titles, captions, cover/first frame, hashtags per platform.
  - `sound-design.md`: non-musical SFX only. Where whooshes, pops, impacts and risers go, levels under speech, never
    on every cut.
  - `halal.md`: no music or instruments; nasheeds only with the user's OK; haram topics. Religious content: never
    issue rulings, quote the Qur'an or hadith only with a reference, and flag it for the user to check.
  - `platforms.md`: what matters on TikTok, Reels and Shorts now (originality, length, safe zones).
- Sources: MrBeast's production guide (the public PDF), Hormozi (*$100M Leads*, his talks on hooks), Kallaway, Paddy
  Galloway, clipping guides (openclip's Whop guide, Opus' Content Rewards article), and the installed skills (Vyral
  `viral-short-form` references, Melvynx `clips` and `studio-script` hooks, content-principles, Contagious, Made to
  Stick). Write it in our own words, list the sources at the bottom of each file, and leave out any music advice.
- Done when: Claude Code here loads it, and a test ("pick moments from this transcript") uses it.

### Step 2 — Skills in the app

- `desktop/scripts/package.mjs`: copy `.claude/skills` to `resources/claude-plugin/skills` and write
  `resources/claude-plugin/.claude-plugin/plugin.json` (`name: studio-skills`). In dev, the server builds the same
  folder in the data dir at start (copied when changed), so dev and the packaged app behave the same. Add
  `config.pluginDir`.
- `server/src/claude/agent.ts`: `plugins: [{ type: 'local', path: config.pluginDir }]`. `skills:` is an allow-list:
  playbook, content-principles, the seven `viral-*` skills, contagious, made-to-stick, copywriting, social,
  content-strategy, marketing-psychology, offers.
  - Not in the app: skills that run commands (`last30days`, `hyperframes-cli`, `broll`, `steal`, `clips`,
    `studio-script`; their knowledge reaches the app through the playbook).
  - Also not yet: the HyperFrames/GSAP skills. The app's Claude only edits `EditSpec`, and those skills come in at
    step 9.
  - Add `Read` to `tools`, allowed only under `config.pluginDir` (checked in `canUseTool`, everything else refused).
    `settingSources` stays `[]`.
- `prompt.ts`: say that skills exist and the playbook comes first, and state the halal rule.
- Background prompts (`askStructured` in `claude/oneshot.ts`) don't load skills. They paste in the playbook files
  they need (`clipping.md`, `hooks.md`, `halal.md`), stable text first so it caches.
- Already tested: the plugin loads every skill as `studio-skills:<name>`, without personal settings (*Checked*).
  Done when: chat answers "what makes a good hook" from the playbook and reads one of its reference files.

### Step 3 — Kinds, Today, halal in the code

Kinds:
- Schema: `kind`, `modules`, `niche`. In `shared/types.ts`: `WorkspaceKind`, `MODULES` and `KIND_PRESETS` (modules +
  stages per kind). Clipping stages: `making` → `review` → `ready` → `scheduled` → `posted`. Keep the ids `scheduled`
  and `posted`, because `advanceStage` in `publish/posts.ts` moves cards there. Personal and business keep
  `DEFAULT_STAGES`.
- `NewWorkspacePage`: pick the kind first (three cards), then name, colour and niche. `WorkspaceSettingsPage`: kind,
  module switches, niche.
- Nav (`AppShell.tsx`): items follow the modules (Campaigns only when it's on, and so on).
- `prompt.ts`: one section per kind.
  - Clipping: campaign rules come first; never misrepresent the source or the speaker.
  - Personal brand: the user's voice; accuracy on religion.
  - Business: offers and brand.

Today:
- `/` opens Today (instead of `HomeRedirect`'s last board), as `/today` in `router.tsx`, outside `w/:wid`. It's the
  first item in the phone's bottom nav.
- `GET /api/today` gathers across workspaces:
  - clips waiting for review
  - posts due today, and failed or missed ones
  - submissions to make
  - work running, with progress (renders, downloads, scans)
  - campaigns (budget left, deadline)
  - the latest research briefs
  - Claude usage
- It refetches on `changed` events.

Halal:
- Music → nasheed:
  - `EditAudio`'s `music*` fields become `nasheed: { mediaId, start, volume, duck } | null`, and `normalizeEdit`
    drops the old music fields (no music asset was ever imported).
  - Asset type `music` becomes `nasheed`, with "vocal only, no instruments" confirmed on import (`ASSET_TYPES`,
    `AssetsPage`). A migration turns any `music` asset into `other`.
  - Claude can't set it: `update_edit`'s schema has no nasheed field, and `studio/edits.ts` keeps the previous
    nasheed on versions authored `claude`.
  - `compose.ts` and `render.ts` only play `nasheed` assets.
  - UI: `SoundPanel`, `Timeline`, `StudioPage`, `LookPanel`, `EditHistory`. 19 files mention music
    (`grep -rn -i music server/src web/src shared`).
- TikTok: remove `autoAddMusic` (`shared/publish.ts`, `publish/posts.ts`, `ScheduleDialog`) and always send
  `auto_add_music: false`.
- Built-in SFX: a shared non-musical set in `server/assets/sfx/` (CC0, e.g. Kenney's interface and impact packs).
  About 30 sounds (whoosh, pop, click, impact, boom, ding, riser), named by use; the user listens and approves the
  list. `SfxCue` takes a `mediaId` or `builtin:<name>`, and `list_assets` lists them.
- Done when: grep finds no way left to add music, the TikTok option is gone, kinds work end to end, and Today shows
  real data at phone and desktop width.

### Step 4 — Signed-in windows (desktop bridge)

- Whop, TikTok and Instagram pages are read in the user's own sessions, inside the desktop app, in a
  `persist:sites` Electron session separate from the app's.
- `desktop/src/main.ts`: spawn the server with an IPC channel (`stdio: ['pipe', 'pipe', 'pipe', 'ipc']`; stdin stays
  the exit signal).
  - `{ op: 'read', url, waitFor?, scrolls? }` loads the page in a hidden `BrowserWindow` in `persist:sites`, waits,
    scrolls, and returns `{ title, text, links: [{ href, text }] }`.
  - `{ op: 'signin', site }` opens a visible window on that site's sign-in page.
  - Throttle: one page at a time, at least 5 s apart, with a daily cap.
- `server/src/lib/desktop.ts`: `desktopAvailable()`, `readPage()`, `openSignIn()`. Outside the desktop app
  (`dev:web`), these features say they need the desktop app.
- Settings → Connected sites: Whop, TikTok, Instagram, each with Sign in, signed-in state and Sign out (clears that
  site's storage).
- Parsing: page text → JSON through `askStructured` on Haiku. That survives layout changes, at a few calls a day.
- Done when: a joined campaign's page comes back with its rules.

### Step 5 — Campaigns

- Schema as above. Routes in `server/src/routes/campaigns.ts`, logic in `server/src/campaigns/`.
- Adding a campaign:
  1. Paste the link. A public fetch gets title, rate, budget, min/max payout, platforms and type.
  2. Signed in to Whop: the joined page gives the rules, creator requirements and source files.
  3. Haiku turns that into the rule checklist (`{ text, kind: required|forbidden|format|caption, check?: { type:
     maxSeconds|minSeconds|mention|hashtag|text|platform|watermark, value } }`) and the halal screen (verdict
     ok/flag/reject with reasons; music promotions are rejected).
  4. The user confirms and picks the pages. A business's own campaign has no link.
- Sources: links from the campaign page, or added by hand (a YouTube/Twitch/Kick video or channel, a Drive folder, an
  upload).
  - `source.download`:
    - YouTube/Twitch/Kick: yt-dlp with `-S res:1080,vcodec:h264` and `--js-runtimes node:<process.execPath>` plus
      `ELECTRON_RUN_AS_NODE=1` (to test). Twitch and Kick VODs are untested.
    - Drive: public folders with `gdown` in the tools venv (step 6), otherwise the signed-in window.
  - Then `source.transcribe`.
- Pages:
  - `/campaigns`: rate, budget left, deadline, pages, clips made/approved, earnings.
  - `/campaigns/:id`: rule checklist, sources with status, moments, clips, submissions.
- Claude in chat gets `get_campaigns` and `get_campaign` (read-only).
- Done when: a real campaign is added from its link, screened, assigned, and its sources downloaded.

### Step 6 — Clipping v1 (streams and podcasts)

Tools environment: `server/scripts/setup-tools.sh` creates a `<data>/tools` venv (about 1 GB) with:
- PyTorch CPU (pinned, from the PyTorch CPU index)
- `demucs` (4.1 no longer needs `diffq`, so a plain install after torch; built: see *Checked*)
- `opencv-python-headless` and `gdown`
- the `htdemucs` and YuNet face models, downloaded at install

Settings → "Clip tools: Install", like Whisper. (Built 2026-10-16; YuNet tested, see *Checked*.)

Pipeline: one job of each type at a time. Claude jobs wait while the 5-hour usage is above about 80 %.
1. `source.transcribe`: YouTube sources use YouTube's own captions through yt-dlp (instant). Otherwise
   faster-whisper on the whole audio. Measure its speed on a 2-hour VOD first; if it's too slow, scan with `base` and
   re-transcribe only the cuts with `small`.
2. `source.scan` (no Claude):
   - windows of 20–75 s on sentence boundaries
   - scored on loudness peaks (ebur128), speech pace, chat replay spikes (Twitch `rechat` or YouTube `live_chat`
     subtitles, where yt-dlp gets them) and keywords from the brief
   - keeps the top ~30 windows
3. `source.pick`: one Sonnet `askStructured` call per source.
   - In: the candidate windows' transcript, the campaign brief and rules, the page's niche, the playbook
     (`clipping.md`, `hooks.md`, `halal.md`), the latest research brief, and past rejection reasons.
   - Out: 3–8 moments, each with in/out points, spoken first line, hook card (≤ 6 words), title, why, standalone
     score (kept at 7/10 or more), captions for each allowed platform (required mentions and hashtags included) and
     halal flags.
4. `clip.make`, once per moment:
   1. Cut with 0.5 s margins (FFmpeg).
   2. Music check with Demucs (two stems). Music is present when the no-voice stem is loud (above about −35 LUFS).
      Keep the voice-only audio if the music-only gaps come out silent; otherwise reject: "the music can't be
      removed".
   3. Halal frames check: 3 frames to Haiku.
   4. Adopt the cut into the page's library and transcribe it (word timings).
   5. Face focus: YuNet on sampled frames → `focusX`/`focusY`; splitting at scene cuts comes later.
   6. Create the piece in the page (stage `making`, tagged with the campaign), with Claude's captions as a version
      authored `claude`.
   7. Build the edit from the page's look: the clip, `tighten`, captions, a hook card overlay for the first ~2.5 s,
      SFX (a pop on the hook card, sparing whooshes).
   8. `video.render`, then stage `review`.
5. Review, on Today's review card and in a `/review` queue (vertical player, swipe on the phone): the render, plus the
   rule checklist with what can be checked automatically (length, platform, mention/hashtag/text in the caption)
   and the rest as tick boxes.
   - **Approve & queue** is the user's click: the next free queue time on the page's accounts whose platform the
     campaign allows.
   - **Reject** asks for a reason, which is kept for the next `source.pick`.
   - **Open in studio**.
- Claude in chat gets `find_moments(sourceId)` (queues `source.pick`) and `make_clip(momentId)` (queues `clip.make`:
  local work, allowed). No tool to approve or schedule.
- Done when: one real VOD becomes clips in the review queue, then approved and scheduled, with music stripped and
  rules checked.

### Step 7 — Submissions and earnings

- When a campaign piece's post is `posted` with a `url`, a submission is created as `to submit`. Today shows it: the
  links are copied, and **Open Whop** opens the campaign's submit page in the signed-in window. The user submits
  and taps Done (`submitted`).
- `submissions.sync` (daily, desktop bridge): read the user's submissions page (find it in this step), and Haiku
  reads status, counted views and earnings. Manual edit as a fallback.
- Campaign numbers: clips, views (from our stats), approval rate, earnings, earnings per clip, and a warning when the
  budget runs low. On `/campaigns/:id`, and on the Analytics page with a campaign filter. The weekly review's digest
  includes them.

### Step 8 — Research and daily brief

- Workspace settings → Research: keywords, YouTube channels, TikTok/Instagram handles, or "find channels for me"
  (yt-dlp search, counted by channel).
- `research.sweep` (daily, no Claude):
  - YouTube via yt-dlp: a channel's 30 newest Shorts, skip the 3 newest, take the median of the next 12;
    outlier = views ÷ median, kept at 3× or more, with the spoken hook from the auto-captions.
  - TikTok/Instagram: profiles through the desktop bridge (the profile grid's text gives views per video).
  - Results go into `research_items`.
- `research.brief` (daily, Haiku, for each workspace with research on): from the outliers and the playbook, the
  formulas and topics that over-perform, 3 ideas (Add to board) and hooks shaped for the page. Shown on Today, given
  to `source.pick`, and readable in chat (`get_research`).
- Paste a link (Today, or Library → Analyse):
  - YouTube through yt-dlp (captions, stats), TikTok/Instagram through the bridge.
  - Claude explains the hook, structure and edit (cuts per second from FFmpeg scene detection, caption density). It
    never copies the words.

### Step 9 — Later (built 2026-10-16)

- Formats: story + gameplay, fake texts, talking characters (2D first, with lip sync from the audio, run locally),
  UGC. AI-generated only if a free, local route exists. (Built as below; Minecraft and 3D characters, and AI video,
  weren't: no free local route that's good enough yet.)
- Transitions and motion-graphics templates with the HyperFrames skills (`hyperframes-animation`, `motion-graphics`;
  add them to the app's allow-list then).
- Reframing that follows the speaker: split at scene cuts, handle two-speaker podcasts.
- Delete a campaign's downloaded sources some days after it ends; keep transcripts and clips.

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
| Brand assets | Not on clipping pages: a page's look (captions, fonts, accent, sounds) is in its settings → Style. On personal and business pages *Brand* sits at the bottom of the nav |

Nav, in working order (Today stays the home across pages; Settings at the bottom):

| Kind | Order |
|---|---|
| Clipping | Find → Clips (packages by stage; Review is the column that matters) → Campaigns → Calendar → Analytics |
| Personal brand | Ideas (research brief, Inbox, capture) → Videos (packages by stage) → Calendar → Analytics → Brand |
| Business | Ideas → Videos → Campaigns → Calendar → Analytics → Brand |

Phone: Today, Videos/Clips, Capture, Calendar, Claude.

**Step 1 — Packages, nav, Inbox, search.** `/w/:wid/v/:pid` is the package (old `/p/:pid` links redirect): header with
the stage as a stepper and the next action as the main button; sections Direction/Script, Footage (its files, upload
here), Video (preview of the latest render or the edit, *Open editor*), Copy, Post, Results. Each package has its own
Claude thread (`chat_threads.piece_id`), docked beside it. Inbox (`media.piece_id` null, not an asset) with Claude's
suggestions; search across packages, files and transcripts. Nav per kind as above; Library and the global Review page
go (Review → the Clips board's Review column and Today); Brand assets hidden on clipping pages.

**Step 2 — Feedback in the package.** The player takes notes pinned to a time ("0:07 — cut this pause", or a drawn
box later); a note goes to the package's Claude thread with the time and a frame. Claude changes the edit (studio
tools), the package re-renders by itself when it's in Review, and shows before/after with the version. Approve /
reject / schedule live in the package.

**Step 3 — Skills and the arsenal.** Survey and install more skills (video styles, direction, ads/UGC scripting,
storytelling), keep licences in mind (personal use only where unlicensed). Allow-list every knowledge skill in the
chat. `shared/arsenal.ts` + `get_arsenal`; the prompts tell Claude to consider the arsenal for every video and say
which pieces it chose and why.

**Step 4 — Directions and variety.** Personal/business: `direction.pitch` (one Sonnet call with the playbook and the
arsenal) → 2–3 directions on the package; picking one writes the script/edit plan. Clipping: `clip.make` chooses an
edit direction per clip from the arsenal (hook card style, captions, graphics, transitions, effects) and varies it
across the page's recent clips.

**Step 5 — Finder.** Campaign discovery (the signed-in window reads Content Rewards' campaign list; rank and screen;
Today/Find shows them to join), creator sources (channels from the brief, yt-dlp listings, ranked), viral-moment
matching (YouTube Shorts / TikTok searches for the creator's clips, outliers by views, their transcript found in the
source), auto research (channels suggested and added), the *Find clips* button with one progress view. Daily.

**Step 6 — Effects library.** The effects above as templates/scenes/edit effects with previews in the editor and in
the arsenal; a local person matte (u2net human seg via onnxruntime or HyperFrames' `remove-background`) cached per
clip for frame break, green screen, vertigo, cover story and couch wall.

## Where things stand (2026-10-16)

- Phase 1 is built and packaged as the desktop app (installed in `~/.local/lib/content-studio`).
- Not yet tested on a real phone: PWA install, push, share target, voice recording (needs Tailscale Funnel set up).
  Whisper has transcribed real podcast speech (phase 7) and the app's own TTS.
- Phase 0 (developer accounts + TikTok/YouTube audits) is on the user and not started; publishing is blocked on it.
- Phase 2 (video studio) is usable end to end: edit, preview, tighten, captions, sound, look, render; since phase 7
  also transitions, motion graphics, Claude's scenes, following the speaker and format videos. Tested with real
  podcast footage from the step-6 campaign, in the browser and as the packaged app.
- Phase 3 (scheduling & publishing) is built: tested against a local stand-in for the TikTok, Instagram and YouTube
  APIs (sign-in, chunked/resumable uploads, retries without double posts, sleep catch-up, restarts) and in the
  browser at desktop and phone sizes. Real posting waits on phase 0 (developer apps, Funnel).
- Phase 4 (analytics & weekly review) is built: tested against a stand-in for the platforms' stats APIs (including
  TikTok inbox drafts, missing permissions, the YouTube Analytics API turned off) with two months of seeded posts,
  one manual and one scheduled weekly review run on the real Claude, and the UI at desktop and phone sizes.
- Phase 7 (clipping, campaigns, research, formats) is built: steps 1–5 (2026-10-15) and 6–9 (2026-10-16). Next: phase
  0 on the platforms' sites (now including the analytics scopes), then connect real accounts. Waiting on the user:
  - Settings → Clip tools → Install in the real app (about 3 minutes, 1.4 GB: Demucs, the face detector and the
    voices) before the first clip or format video; then on a clipping page's active campaign, get a source (or Find
    moments on one) and look through Review. Listen to the first clips from a source with background music: the music
    check was only tried on stand-ins;
  - listening to the built-in SFX, and to the voices (Script tab of a format video → the play button by each voice);
  - a format video for real: an empty edit → *Or make it from words* (or ask Claude), with gameplay you recorded as
    the background; and a UGC video from a campaign that wants you on camera (campaign page → *Filmed videos*);
  - on each page with the Research brief: its Research page → *What it watches* (or *Find channels for me*), then
    *Run now* once; after that it runs every morning. Signing in to TikTok under Connected sites makes TikTok profiles
    read reliably;
  - in the desktop app, Settings → Connected sites: sign in to Whop (it opens contentrewards.com's sign-in), TikTok
    (its QR code works from the phone) and Instagram, and check each then shows "Signed in". Whop's sign-in cookie is
    a guess (`SITES.whop.sessionCookie` in `shared/sites.ts`): if it stays "Not signed in", a session should list the
    HttpOnly cookies on contentrewards.com (remote debugging, as in CLAUDE.md) and pin the right one. Then "Try a
    page" with a campaign you've joined: its rules and source files should be in the text (signed out, they show
    "Join to unlock").
  - then Campaigns → Add campaign with a campaign you've joined: its rules and source files should come in, then
    confirm it on a page and get a source or two.
  - once a clip of a joined campaign is posted and submitted: Campaigns → the campaign → Submissions → *Check now*
    (desktop app, signed in to Whop) should match it on `/c/submissions` and bring its status, counted views and
    earnings. If it says the submissions didn't match a post, that page doesn't show the post links: a session should
    read it with "Try a page" (Settings → Connected sites, `https://contentrewards.com/c/submissions`) and adjust
    `syncSubmissions` (e.g. open each submission, or match by campaign and date).

  Not run with a real chat yet: Claude using `write_scene`/`view_overlay`, `write_format_video`, `write_ugc_video` and
  transitions in a conversation (their handlers were tested directly, to spare the 5-hour usage). The weekly review
  with the playbook in its prompt hasn't been run yet (no posts with numbers). The phone app needs a new release for
  Today, the nasheed change (`API_VERSION` 2: v0.1.0 asks to be updated), Review and the studio's new parts
  (transitions, graphics, scenes, format videos: an older bundled UI would drop them when saving an edit).
- Phase 6 (Android app) is built: tested on an Android 15 emulator against a local server — pairing (link and deep
  link), share sheet from the Files app, background uploads with resume after a dropped connection, camera, voice memos,
  offline queue and banner, lock, video preview, launcher shortcuts, unpairing — and the desktop's pairing/Firebase
  settings in the browser. FCM sending tested against a stand-in. v0.1.0 is on GitHub Releases (signed APK built by
  CI). Not yet: a real phone, a real Firebase project.
- The code is on GitHub (private): `https://github.com/Adambench/content-studio`, branch `main`.

