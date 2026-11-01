# Content Studio

A desktop app for planning, writing, editing, scheduling and posting social content for TikTok, Instagram and
YouTube Shorts — with Claude built in. It runs on this laptop; your Android phone uses it through the Content Studio
Android app (or the web app) over a private address. Roadmap: [PLAN.md](PLAN.md).

## Using it

Open **Content Studio** from the app menu. No terminal needed.

- Closing the window keeps it running in the **tray** (so background work and scheduled posts continue). Quit
  from the tray icon.
- **Settings → App → Start when I log in** opens it quietly in the tray at login.
- **Settings → Transcription** installs speech-to-text (one click, already done on this laptop).
- **Settings → Phone access** shows the one-time Tailscale setup, pairs the Android app (QR code) and lists paired
  phones; it also sets the password for using it in a phone's browser instead.
- **Settings → Video rendering** fetches the video renderer (it also downloads by itself on the first render).
- **Settings → Clip tools** installs Demucs, a face detector and the voices (about 1.4 GB, one click): clips can't be
  made without them, since they remove background music, and format videos need the voices. An older install shows
  **Add the voices**.
- **Settings → Publishing** holds the one-time platform setup (below).
- **Settings → Weekly review** sets when Claude reviews each workspace's results (Mondays 9:00 by default), or turns it
  off.

## What's in it

- **Today** — what needs you across every page: clips to review, posts that failed, clips to submit, the research
  briefs, what's running.
- **Workspaces** — one per page (personal brand, business, clipping page): board of videos, chats, brand, voice,
  accounts, analytics.
- **Claude** — writes and edits ideas, scripts, captions and video edits, picks clip moments, reviews results; it
  never schedules or posts on its own.
- **Video studio** — captions, cuts, reframing that follows the speaker, transitions, motion graphics, sound effects
  (never music), LUT grades, format videos from words; renders on this computer.
- **Clipping** — campaigns from Content Rewards or your businesses: sources downloaded and transcribed, moments
  picked, clips made, music removed, rules checked; you approve each one.
- **Research** — a daily brief of what over-performs in each page's niche.
- **Publishing and analytics** — TikTok, Instagram and YouTube through their official APIs: queues, calendar, stats,
  a weekly review.

## Publishing setup (one time)

Posting uses each platform's official API through developer apps you register yourself (free). Settings →
Publishing walks through each one and shows the exact redirect address to register.

1. **Public address** — set up Tailscale Funnel (see *Phone access*), then Settings → Publishing → *Detect* → *Save*
   → *Check it works*.
2. **TikTok** — developers.tiktok.com: an app with Login Kit, the Content Posting API (Direct Post on) and the Display
   API, scopes `user.info.basic`, `video.upload`, `video.publish`, and for analytics `video.list` and
   `user.info.stats`. For photo posts, verify the URL prefix
   `<public address>/api/public/` with the file TikTok gives you (upload it in Settings). Record the audit demo
   (PLAN.md) to lift the private-only limit.
3. **Instagram** — Business or Creator accounts; developers.facebook.com: an app with the use case *Manage messaging &
   content on Instagram* and a business portfolio, set up with *Unified login* (new apps don't get Instagram Login): a
   configuration with `instagram_basic`, `instagram_content_publish` and `instagram_manage_insights` (analytics), token
   expiry *Never*, the redirect URI registered there and under Facebook Login for Business → Settings. Settings takes
   the app ID and secret (App settings → Basic) and the configuration ID. The app can stay unpublished, but then each
   Instagram account must be a tester (Unified login → *Generate access tokens* → *Add account*, then accept on
   instagram.com → Settings → Website permissions → Apps and websites → Tester invites). Meta's sign-in may not say
   which account was picked (it didn't for the app's own business portfolio): Content Studio then asks for the
   account's ID, the number under its name in *Generate access tokens* (or its @handle once one is connected).
4. **YouTube** — Google Cloud: a project with the YouTube Data API v3 (and the YouTube Analytics API, for watch time
   and shares), an OAuth consent screen set to *In production*
   (otherwise the sign-in expires every 7 days) and a *Web application* OAuth client. Submit the YouTube API audit
   form for public uploads. The default quota allows about 100 uploads a day.
5. Then in each workspace: Calendar → **Accounts** → connect. An account connected before analytics existed is
   missing the stats permissions; its card (and Analytics) says so — *Reconnect* fixes it.

## Claude without an API key

Claude runs through the Claude Agent SDK on this computer's **Claude Code login** (your Pro plan); if it ever
says you're signed out, run `claude` in a terminal once and use `/login`. Usage counts against the same Pro
limits as Claude Code — the sidebar shows the current 5-hour window. Sonnet is the default; switch per chat.

## Phone access

One time, in a terminal (needs sudo):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 8787
```

Then install the Android app (below) and pair it. Or, without the app: set a password in **Settings → Phone access**,
open the printed `https://<machine>.ts.net` address in Chrome on Android, sign in, then menu → **Add to Home screen**.
Either way the desktop app has to be running (tray is enough).

Scheduled posts need the laptop awake. Content Studio stops it going to sleep by itself shortly before a post is
due, but closing the lid still suspends it; to post with the lid closed, in `/etc/systemd/logind.conf` set
`HandleLidSwitch=ignore` (and `HandleLidSwitchExternalPower=ignore`), then `sudo systemctl restart systemd-logind`.

## Android app

The app is the same UI, installed on the phone, plus what a web app can't do well:

- **Share sheet**: share videos, photos, voice notes, text or links from any app → pick the workspace (and a piece) →
  footage goes to the library, voice notes and text become idea cards.
- **Background uploads** that survive closing the app, losing the network or restarting the phone: big files are sent
  in chunks and pick up where they stopped. The upload icon in the header shows progress (and anything that failed).
  *Upload* and *Camera* in the app use Android's own picker and camera, so they upload in the background too.
- **Voice memos and ideas offline**: they're kept on the phone and sent when the computer can be reached. A banner says
  when it can't.
- **Notifications** through Firebase (below), **launcher shortcuts** (long-press the icon: *Voice memo*, *Capture an
  idea*), the back button, and an optional **fingerprint lock** (App settings → This phone).

**Install** with [Obtainium](https://obtainium.imranr.dev/): *Add app* → `https://github.com/Adambench/content-studio`
→ it installs the APK from the latest release and offers each new one. The repository is private, so first give
Obtainium a GitHub personal access token (Obtainium → Settings → GitHub; a fine-grained token with read-only *Contents*
access to this repository is enough).

**Pair**: on the computer, Settings → Phone access → **Pair a phone** shows a QR code (one use, 10 minutes); in the app,
**Scan the QR code** (or paste the link shown under it). The phone keeps its sign-in in Android's Keystore; there's no
password. Paired phones are listed under the QR code, each with **Unpair**. On the phone, the workspace menu →
**App settings** → *This phone* shows what it's paired with, notifications, the lock and *Unpair*.

**Notifications** (one time, free): in the [Firebase console](https://console.firebase.google.com/) create a project,
add an Android app with the package name `io.github.adambench.contentstudio`, download its `google-services.json`,
then Project settings → Service accounts → **Generate new private key**. Add both files in Settings → Notifications →
Android app on the computer. The app picks the settings up from the computer (nothing to rebuild); turn notifications
on in its App settings. Tapping one opens what it's about.

The app checks that it and Content Studio on the computer speak the same version, and says which one to update.

### Releasing a new version

Bump `"version"` in `package.json`, commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`. GitHub
Actions (`.github/workflows/android.yml`) builds the signed APK and attaches it to a GitHub release; Obtainium sees it.
The tag has to match `package.json`. Every push to `main` also builds a debug APK (a workflow artifact, for trying
changes; it can't update the release app, which is signed with another key).

Release signing: the keystore is in `~/.config/content-studio/android-release/` (its README has the alias and
password) and in four repository secrets — `ANDROID_KEYSTORE_BASE64` (`base64 -w0` of the keystore),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. **Keep a copy of that folder off this
laptop**: Android only accepts updates signed with the same key, so losing it means uninstalling the app (and pairing
again) to move to a new one.

## Data

Everything lives in `~/.local/share/content-studio` (Settings → App → Open data folder): the database (including
the connected accounts' sign-in tokens — keep the folder private), media, transcripts, the speech-to-text environment
and `logs/server.log`. Back that folder up. `proxies/` (preview copies), `renderer/` (headless Chrome) and `cache/`
(including JPEG copies of photos made for Instagram and TikTok) can be deleted — they're rebuilt when needed; failed
renders leave a log in `logs/renders/`. The app itself is installed in `~/.local/lib/content-studio`.

## Development

```bash
npm install
npm run dev          # desktop window + server + Vite, with hot reload (quit the installed app first: same port)
npm run dev:web      # browser only, at http://localhost:5173
npm run typecheck
npm run install-app  # build, package and (re)install the desktop app; restarts it if it was running
npm run android      # build the UI for the Android app and copy it into mobile/android (cap sync)
```

The Android app's UI can be tried in a browser: `npm run dev -w server` and `npm run dev:app -w web`, open
http://localhost:5173 at phone size and pair with `http://localhost:5173` (the pairing link from the desktop UI, with
that address). Native parts (share sheet, uploads, recording, notifications) need the APK: CI builds one on every push
to `main`, or with JDK 21 and the Android SDK, `cd mobile/android && ./gradlew assembleDebug`. A debug build can pair
with a dev server on this computer over USB: `adb reverse tcp:8787 tcp:8787`, then the address `http://localhost:8787`
(release builds only talk HTTPS).

To try publishing without real accounts, point the server at a stand-in for the platforms' APIs:
`CS_PLATFORM_API=http://127.0.0.1:9911` sends every TikTok/Instagram/Google request (and the sign-in page) to
`http://127.0.0.1:9911/<host>/<path>`.

```
shared/      types used by both sides (draft shape, stages, platform limits, chat events)
server/      Fastify + SQLite (node:sqlite via Drizzle) API, job worker, Claude agent + tools, Whisper script,
             video studio (server/src/studio: compile edits to HyperFrames, proxies, renders) + bundled fonts,
             publishing (server/src/publish: accounts, OAuth, posts, scheduler, one adapter per platform)
web/         React + Vite + Tailwind + shadcn/ui — the UI, also served to the phone as a PWA (and built into the APK)
desktop/     Electron shell: starts the server, signs in, tray, notifications, packaging + install scripts
mobile/      Android app: Capacitor project (android/), its native plugin (StudioPlugin: share sheet, upload queue,
             recorder, lock, QR scanner, Firebase); built and released by .github/workflows/android.yml
PLAN.md      decisions and roadmap
```
