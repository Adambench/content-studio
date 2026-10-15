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
| Workspaces | Separate brands/niches, fully isolated; I create them myself |
| Versions | Alternatives (branches), each with its own version history; compare + restore |
| Layout | Pipeline board + Claude side panel; dark, clean UI |
| Formats | Short vertical video (TikTok, Reels, Shorts) + image posts/carousels (IG, TikTok photo) |
| Video editing | HyperFrames (HTML → MP4) + FFmpeg: captions, cuts/reframe, motion graphics, b-roll, transitions, sound design, colour grading (LUTs), branded templates |
| Scheduling | Drag-and-drop calendar, per-account time-slot queues, cross-post with staggered times |
| v1 extras | Analytics, push notifications, idea capture from the phone |
| Assets | Import area per workspace (logos, fonts, LUTs, music, SFX); none exist yet |
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
   - [x] Music with ducking under speech, SFX, voice clean-up, −14 LUFS loudness; LUT grading (FFmpeg)
   - [x] Render queue in a child process (headless Chrome downloaded on first render), result into the library
   - [x] Brand look (template) per workspace; Claude tools: get/update/tighten/render edits, list assets
   - [ ] Transitions between clips, animated motion-graphics templates (and Claude-written HyperFrames scenes)
   - [ ] Automatic reframing (face tracking); grade shown in the preview
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
   - [ ] First release (on you: create the GitHub repo, keystore + secrets — see README → Android app) and real-phone
     test: QR scanning (Google's code scanner needs Play services; the emulator image couldn't download it), FCM

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

## Where things stand (2026-10-15)

- Phase 1 is built and packaged as the desktop app (installed in `~/.local/lib/content-studio`).
- Not yet tested on a real phone: PWA install, push, share target, voice recording (needs Tailscale Funnel set up).
  Whisper has only been run on a test clip without speech.
- Phase 0 (developer accounts + TikTok/YouTube audits) is on the user and not started; publishing is blocked on it.
- Phase 2 (video studio) is usable end to end: edit, preview, tighten, captions, sound, look, render. Tested with
  generated footage and a hand-made transcript (no real speech yet), in the browser and as the packaged app.
- Phase 3 (scheduling & publishing) is built: tested against a local stand-in for the TikTok, Instagram and YouTube
  APIs (sign-in, chunked/resumable uploads, retries without double posts, sleep catch-up, restarts) and in the
  browser at desktop and phone sizes. Real posting waits on phase 0 (developer apps, Funnel).
- Phase 4 (analytics & weekly review) is built: tested against a stand-in for the platforms' stats APIs (including
  TikTok inbox drafts, missing permissions, the YouTube Analytics API turned off) with two months of seeded posts,
  one manual and one scheduled weekly review run on the real Claude, and the UI at desktop and phone sizes. Not yet
  installed as the desktop app (`npm run install-app`).
- Next: phase 0 on the platforms' sites (now including the analytics scopes), then connect real accounts; video
  studio extras (transitions, motion graphics).
- Phase 6 (Android app) is built: tested on an Android 15 emulator against a local server — pairing (link and deep
  link), share sheet from the Files app, background uploads with resume after a dropped connection, camera, voice memos,
  offline queue and banner, lock, video preview, launcher shortcuts, unpairing — and the desktop's pairing/Firebase
  settings in the browser. FCM sending tested against a stand-in. Not yet: a real phone, a real Firebase project, a
  GitHub release.
- Nothing is committed to git yet.

