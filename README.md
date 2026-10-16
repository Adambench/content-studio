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
- **Settings → Clip tools** installs Demucs and a face detector for clipping (about 1.3 GB, one click): clips can't
  be made without them, since they remove background music.
- **Settings → Publishing** holds the one-time platform setup (below).
- **Settings → Weekly review** sets when Claude reviews each workspace's results (Mondays 9:00 by default), or turns it
  off.

## What's in it

- **Today** (the home page) — what needs you across every workspace: clips waiting for review, posts that failed or
  missed their time, posted clips to submit on Content Rewards, today's posts, the research briefs, what's running (renders, transcriptions, Claude jobs), each page at a glance and
  Claude usage. First in the phone's bottom bar.
- **Workspaces** — one per page, fully isolated: board, footage, assets, chats, brand guide, voice. Each has a kind —
  **Personal brand**, **Business** or **Clipping page** — that presets its modules (Ideas & scripts, Filming,
  Grading, Campaigns, Clipping, Research brief), its stages and Claude's instructions, and a one-line **niche**.
  Modules can be switched on or off in workspace settings.
- **Campaigns** — paste a Content Rewards campaign link (or write a brief for one of your businesses): the app reads
  the page (in your signed-in Whop window when you've joined), makes a rule checklist, screens it against the halal
  rules and waits for your OK and the pages it goes on. Source videos (YouTube, Twitch, Kick, Drive, uploads) download
  to the computer and get a transcript. Signed-in windows for Whop, TikTok and Instagram are under Settings →
  Connected sites.
- **Clipping** — an active campaign's source video is scanned for its liveliest stretches (loudness, speech pace,
  the chat replay, the brief's words), then Claude picks 3–8 moments that stand alone, by the playbook and the
  campaign's rules, with a hook card, a title and captions. Each moment is cut, keeps only the voice (Demucs removes
  background music, or the clip is dropped), has three frames checked against the halal rules, is framed on the
  speaker's face and edited in the page's look (tightened, captions, hook card, a sparing pop and whoosh), then
  rendered into **Review**.
- **Review** — every clip waiting for your yes or no, with its render, where it came from and the campaign's rules
  checked against it (length, captions' mentions and hashtags, platforms; the rest as tick boxes). **Approve &
  queue** sends it to the next free queue time of the page's accounts; **Reject** asks why, and the next picks read
  your reasons.
- **Submissions and earnings** — once a campaign clip is posted, Today lists it to submit: copy its link, **Open
  campaign** (the Content Rewards page opens in the signed-in window on the computer, in the browser on the phone),
  submit it there yourself, then tap **Done**. Once a day the desktop app reads your submissions page on Content
  Rewards for each one's status, counted views and earnings (or set them by hand). Each campaign shows clips posted,
  views, how often the campaign approves your clips, earnings (estimated from views × the rate until it says) and per
  clip; its budget is checked daily and you're told when it runs low. Analytics can be filtered to one campaign, and
  the weekly review reads the campaigns' numbers too.
- **Research** (pages with the Research brief) — list the YouTube channels, TikTok and Instagram accounts and
  keywords a page watches (or let it find channels). Every morning their latest posts are checked against each
  account's usual views; the outliers (3× or more) go into a short brief: what's working, topics, three ideas (*Add to
  board*), hooks shaped for the page and, on a clipping page, what moments to look for (clip picking reads it too). It's
  on Today and the page's Research page, and Claude reads it in chat. **Analyse** any Short, TikTok or Reel link (or a
  video in the library): its hook, beats and edit, measured (cuts and words per second) and explained, with what the
  page can borrow — never its words.
- **Pipeline board** — drag cards through your stages (customisable per workspace; clipping pages go Making →
  Review → Ready → Scheduled → Posted).
- **Piece editor** — hook, script, notes and per-platform copy (TikTok, Instagram, YouTube Shorts, X) with
  character counters. Autosaves; **Save version** (Ctrl+S) snapshots it. **Alternatives** are parallel takes,
  each with its own history; compare any version with the current draft, restore it, or branch from it.
- **Library** — footage, photos and voice memos, transcribed locally with Whisper (word timestamps for captions
  later). Search finds words *spoken* in your videos.
- **Brand assets** — logos, fonts, LUTs, vocal-only nasheeds, SFX and templates for the video studio, plus ~30
  built-in sound effects (whooshes, risers, impacts, pops, clicks, dings, glitches) to listen to. No music, ever.
- **Claude panel** (Ctrl+J) — reads your board, pieces, transcripts, video frames and how your posts did, researches
  the web, writes drafts straight into pieces as new versions, creates alternatives, moves cards. It never publishes.
- **Voice learning** — when you rewrite Claude's text and save, it learns from the difference.
- **Idea capture** — talk or type an idea (big mic on the phone); it becomes a tidy idea card.
- **Notifications** — native on the desktop, push on the phone.
- **Video editor** (piece → **Edit video**) — your footage laid end to end in the brand's look, with a live preview
  that matches the render:
  - **Clips**: reorder, trim, split at the playhead, reframe (click where the subject is), zoom, clip volume.
    **Tighten** cuts the pauses (and “um”s) using the transcript's word timings.
  - **Captions** from what's said, in four styles (Bold, Karaoke, Clean, Subtitle), your fonts and colours. Fix
    misheard words there — it corrects the transcript too.
  - **Text & images**: titles, labels, logos and b-roll cutaways (full screen, top half, picture in picture);
    one click puts the draft's hook on screen.
  - **Sound**: built-in and brand sound effects, voice clean-up, loudness levelled to −14 LUFS (what TikTok, Reels
    and Shorts play at), and optionally a vocal-only nasheed that dips under your voice — only you can add one.
  - **Look**: 9:16 / 4:5 / 1:1, a LUT colour grade (applied in the render), a watermark. **Save this look** makes it
    the brand's default for new edits.
  - **Render** makes an MP4 on this laptop (about a minute for a short video) that lands in the piece's
    *Finished videos*. Every change is versioned — **History** restores any earlier edit.
  - Claude can do all of it from the chat: pick the best takes, tighten, caption, reframe, add sound effects and
    render. It never adds music or touches the nasheed.

- **Calendar** — every post in week, month or list view. Drag a post to another day (or onto a free queue time) to
  move it; drag a piece from *Ready to schedule* onto the calendar to schedule it. Failed or missed posts show at the
  top and as a badge on Calendar.
- **Accounts** (Calendar → Accounts) — connect TikTok, Instagram and YouTube accounts to the workspace (you sign in on
  the platform's own page), and set each account's **queue**: the weekly times “Next queue time” fills.
- **Schedule** (on a piece) — pick what (the finished video, other footage, or photos for a carousel), where (any
  connected accounts — cross-posting), and when (each account's next queue time, a time you pick with posts spaced
  out, or now). The captions are copied from the draft and can be tweaked per post; problems (too long, too many
  hashtags, YouTube can't take photos…) are flagged before you save. Then it goes out by itself:
  - **TikTok** goes to your TikTok inbox as a draft by default (that works before TikTok audits your developer app):
    you get a notification, open TikTok, paste the caption (the post has a *Copy caption* button) and post. After the
    audit, switch the account to *Post directly*.
  - **Instagram** posts Reels, photos and carousels. It downloads the media from your public address, so the Funnel
    must be on.
  - **YouTube** uploads the video (a Short if it's vertical and up to 3 minutes). Until Google audits your API
    project, uploads are private — publish them in YouTube Studio.
  - Failures retry by themselves (five tries over about 40 minutes) without ever posting twice; then you're notified.
    Each post shows what happened and has *Try again*, *Post now*, reschedule and edit.
  - If the computer was asleep or off at post time, the post goes out when it's back if it's no more than 3 hours
    late (Settings → Publishing changes that); otherwise it waits for you as *Missed*.
  - Cards move to *Scheduled* and then *Posted* on the board by themselves. Claude can read the schedule and
    suggest times, but only you schedule or post.

- **Analytics** — how each workspace's posts are doing, from the platforms' own numbers (read every few hours while a
  post is new, then daily, then weekly, for 90 days; *Refresh* reads them now):
  - Views, a **typical post** (median views after 24 hours) and engagement for the last 7, 28 or 90 days, against the
    period before, and followers across your accounts.
  - **How each post did**: every post's views after 24 hours against its account's typical post — above the line
    beat it, below didn't. Comparing at the same age keeps new and old posts fair. Click a bar for the post.
  - Per account: followers over time, and **when posts do best** (time of day and weekday, once there are a few posts).
  - A sortable table of every post (views, likes, comments, shares, saves, watch time). Each post's sheet (here or on
    the Calendar) shows its numbers and views over time; board cards show a posted piece's views.
  - TikTok drafts you finish in the TikTok app are picked up once posted (if public); otherwise paste the video's
    link into the post to see its stats.
  - **Weekly review**: once a week Claude reads the results and writes what worked and why, lessons for next week,
    ideas that build on the hits (*Add to board*), and better queue times when the numbers clearly support them
    (*Use these times* — nothing changes until you click). It also folds what works into the voice memory, marked
    “(from results)”, with *Undo*. *Review now* runs one any time; you get a notification when the weekly one is ready.

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
3. **Instagram** — a Business or Creator account; developers.facebook.com: a Business app with the Instagram product
   (Instagram business login), including the `instagram_business_manage_insights` permission for analytics. Use the *Instagram* app ID and secret; add yourself as an Instagram tester while the
   app is in development.
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
