# CLAUDE.md

Content Studio: single-user Electron desktop app for planning, writing, editing, scheduling and posting short-form
video, with Claude built in; the phone uses it through an Android app (Capacitor) or PWA. PLAN.md has the decisions,
measurements, open items and the current build plan (phase 8). Read only the section you need.

## Layout

- `desktop/` — Electron: spawns `server/dist/server.mjs` with `ELECTRON_RUN_AS_NODE=1`, signs in with a per-launch
  `DESKTOP_TOKEN` (`POST /api/auth/desktop`), tray, notifications, `window.desktop` bridge (`src/preload.ts`), signed-in
  site windows (`src/sites.ts`).
- `server/` — Fastify on 127.0.0.1:8787. SQLite = `node:sqlite` behind a better-sqlite3-shaped shim
  (`src/db/sqlite.ts`); never import `drizzle-orm/better-sqlite3` (pulls in the native module; no C toolchain here).
  Main areas: `claude/` (agent, tools, prompts, plugin), `ai/` (Claude or the self-hosted model per task, the local
  chat loop), `studio/` (edits → HyperFrames, render, generation), `publish/`,
  `analytics/`, `campaigns/`, `clipping/`, `research/`, `ideas/` (the brainstorm canvas, Saved pile, Notes), `knowledge/` (the
  playbook as editable rules), `toolbox/` (what's installed and used, installing skills, the weekly scout), `jobs/` (queue).
- `web/` — React UI. `isDesktop` (`lib/desktop.ts`), `isApp`/`isNative` (`lib/native.ts`, the `vite --mode app` build).
- `mobile/` — Capacitor 8, committed `android/`, one native plugin `StudioPlugin` (Java). CI builds APKs.
- `shared/` — types for both sides (`types.ts`, `edit.ts`, `campaigns.ts`, `clipping.ts`, …).
- Data: `~/.local/share/content-studio` (`CONTENT_STUDIO_DATA_DIR` overrides; also moves Electron's profile).

## Rules that matter

- **Halal: no music, ever.** Nothing made may contain music or instruments (tracks, beds, stingers, trending sounds,
  TikTok auto-add-music). SFX fine (non-melodic). The line is instruments: voice-only sound (a hum, wordless voices,
  a nasheed without instruments) isn't music: fine in references and sources, in an edit only as the nasheed. An edit's only track is `audio.nasheed` (vocal-only, set by the user
  only; `withAuthorNasheed` keeps Claude from changing it). SFX = `sfx` assets or built-ins (`shared/sfx.ts`,
  `server/assets/sfx`, rebuilt by `server/scripts/make-sfx.py`). No music asset type. Third-party skills' music advice
  never applies. Voiceover plays only `tts` or `capture` media.
- **No Anthropic API key, ever.** Claude runs via `@anthropic-ai/claude-agent-sdk` on the Pro login
  (`claude/options.ts` strips `ANTHROPIC_API_KEY`). Few LLM calls: mechanical work is Whisper/FFmpeg; background jobs
  use Haiku, but editing (picking clips, frame checks, directions, the check before a render, the chat) uses Opus, the best model; background jobs wait (not fail) while 5-hour usage ≥ 80 % (`waitForUsage(task)`), but what I click
  for and wait on (Ideas help, lock-in, directions, a UGC script) never waits: `askStructured({ now: true })`.
- **Every model call names its task** (`shared/ai.ts`): `askStructured({ task, … })` and the chat go to Claude or the
  self-hosted model (Ollama on a home PC) by `ai/route.ts` (Settings → Models: per task, *local only*, auto at a usage
  limit). A new AI call gets a task; the local chat (`ai/local-agent.ts`) calls the same studio tools, so a tool works
  on both. Self-hosted models are commercial-safe only (Qwen, FLUX.1-schnell, Wan 2.1, Chatterbox, Kokoro).
- **Generated pictures never show people or animals** (`shared/generate.ts`): prompts describe empty scenes, and every
  result is checked (task `pictures`) and made again or dropped. Generation and the cloned voice run only on workers
  (`WORKER_ONLY`); video clips only in the night window. Pictures and clips can instead be made by kie.ai
  (`ai/hosted/`, Settings → Models): the key lives in settings, write-only, never sent to the UI; every request is
  recorded in `ai_spend` and a daily cap ($10) stops new ones; hosted clips lose their sound. `CS_HOSTED_API` = stand-in.
- **Claude's tools are scoped to one workspace** (`buildTools(workspaceId)`), every tool checks ownership. Claude edits
  drafts/edits freely (versions authored `claude`) and may render, but never schedules, publishes, approves, rejects or
  submits: those need the user's click. Never give Claude a publish tool. On Ideas it only adds cards (`by: 'claude'`),
  never edits or deletes the user's; locking an idea in is the user's click.
- **Every comment I leave on a video is a lesson** (`knowledge/lessons.ts`): fixing it also records the general rule
  (a Knowledge rule, source `comments`, or the lesson it repeats) via `resolve_note` or `npm run notes -- fix`.
  Lessons go into every prompt that picks, makes or judges a video (`lessonsText`), and the check before a render
  tests each one (a broken one sends it back to Claude, clips too). When the mistake came from the pipeline (clip
  picker/maker, framing, a template), change that code as well, so the next video can't make it.
- Renders draw their frames on a home PC that has `render` (`setup-worker.sh --with render`): the laptop cuts and
  grades the footage, sends the project as a tar (`renderRemote`), and renders itself when no worker has it or fails.
- Chat skills: `.claude/skills` loads as the `studio-skills` plugin (`claude/plugin.ts`, allow-list `CHAT_SKILLS`);
  skills I install from the Toolbox go to `<data>/skills-added` (plugin `studio-added`, all in the chat) or
  `~/.claude/skills` (Claude Code only), never with sound or video files; the chat's Read is held to the plugin
  folders by a hook; claude.ai connectors off. Background prompts don't load skills:
  paste playbook files with `playbook(...)`, first in the system prompt.
- Scenes (`shared/scene.ts`) are data: never let a scene carry script, `url()` or `random()`.
- Publishing adapters keep resume state in `posts.remote` via `ctx.save` so retries never post twice. Tokens stay
  server-side (`publicAccount` strips them). `CS_PLATFORM_API=http://127.0.0.1:9911` routes platform calls to a stand-in.
- Signed-in windows (`readPage`, `lib/desktop.ts`): one read at a time, ≥ 5 s apart, daily cap, never click/post/submit.
  Only when Electron started the server (in `npm run dev` they answer "needs the desktop app").
- Auth: cookie or `Authorization: Bearer <device token>`. Header-less GETs (media, thumbs, proxies, `/api/events`,
  studio preview) may use `?access_token=` only for paths in `TOKEN_IN_QUERY`. In the UI build URLs with
  `fileUrl()`/`mediaFileUrl()`/`mediaThumbUrl()` and call the API through `api()`/`apiFetch()`, never a bare `/api/…`
  (the app's origin is `https://localhost`). Bump `API_VERSION` (`shared/devices.ts`) for changes an older app can't
  handle. `/api/auth/setup` is refused when `DESKTOP_TOKEN` is set.
- Drafts have one shape, `DraftContent`: use `normalizeDraft`/`mergeDraft`. Edits: `normalizeEdit`; `validateSpec`
  checks file ownership.
- Live updates: server `emit()` → `/api/events` SSE → `web/src/lib/live.ts`. New entities need both sides.
- External binaries go through `findBinary` (`server/src/lib/bin.ts`): launcher apps get a minimal PATH.
- Studio gotchas: timed elements must not be zero-height (put positioned content inside a full-frame `.layer`); grade
  with FFmpeg `lut3d` (HyperFrames' grading hangs headless Chrome); new built-in sounds go in compose *and* render's
  file list; transitions only overlap pictures (sound still cuts) so timings never move.
- UI: shadcn/ui (radix-nova) in `web/src/components/ui` is generated: compose, don't edit. Dark only. Mobile is
  first-class. No `alert`/`confirm`/`prompt`.
- `pkill -f "<pattern>"` from a shell whose command line contains the pattern kills that shell: use `[x]yz` patterns.

## Commands

- `npm run dev` (desktop + server + Vite), `npm run dev:web` (browser only), `npm run typecheck`
- `npm run install-app` — build, package, install to `~/.local/lib/content-studio`, restart if running
- `npm run notes` — my open comments on finished videos (pinned to a moment or stretch, with the words, clip and
  overlays there) and the lessons so far; after fixing, `npm run notes -- fix <noteId> "<what changed>"` plus the
  lesson: `--lesson <id> ["sharper rule"]`, `--new <topic> "<title>" "<rule>"` or `--one-off "<why>"` (`answer`
  leaves it open; `lessons` lists them). A clip whose story starts earlier or ends later than its cut:
  `npm run notes -- source <pieceId>` (the source's words around it), then `recut <pieceId> <start> <end>` (the running
  app makes it again on the same card, comments kept, and renders it; the chat has `get_clip_source`/`recut_clip`).
- `npm run db:generate -w server` after editing `server/src/db/schema.ts` (migrations run on startup). drizzle-kit
  drops `ON DELETE` from foreign keys it adds with `ALTER TABLE`: check the SQL.
- `npm run android` — app UI build + `cap sync`. APKs: CI, or JDK 21 + SDK (`cd mobile/android && ./gradlew assembleDebug`)
- HyperFrames packages pinned exactly, producer/core/player on one version. `puppeteer` blocked in `allowScripts`.
  Packages that read files from their own folder are external to the server bundle: add them to
  `desktop/scripts/package.mjs`.
- Skills: `npx skills add <repo> -a claude-code --copy -s <names>` (tracked in `skills-lock.json`); `npx skills update -p`,
  then delete `last30days/assets` again (music demo). `content-principles` has no license: personal use only.
  `playbook` is ours.
- Screenshot the built app: `CONTENT_STUDIO_DATA_DIR=/tmp/x PORT=8797 CS_OPEN_PATH=/settings CS_SCREENSHOT=/tmp/x.png
  CS_SCREENSHOT_QUIT=1 node_modules/electron/dist/electron desktop`. To drive it add `--remote-debugging-port=9223` and
  use `puppeteer-core` `connect({ browserURL })`; `DESKTOP_TOKEN=x` lets a script get a session (header
  `x-desktop-token` on `POST /api/auth/desktop`).

## Working rules

- **Commit and push when a job is done** (typecheck passes, flow tried) without asking. Never commit secrets.
- Android release: bump root `package.json` version, commit, push a matching `v*` tag; CI signs with the key in the
  `ANDROID_*` secrets. Never generate a new key (the phone could no longer update).
- The user's use cases, halal and clipping decisions are in PLAN.md: read those rather than asking again.

## Cloud sessions

Cloud sessions clone `main`: only pushed work is there. The SessionStart hook runs `scripts/cloud-setup.sh` (Node 24,
FFmpeg, Xvfb, Electron libs, espeak-ng, `npm ci`, Electron binary via `node node_modules/electron/install.js`; no-op on
the laptop). Commit to the session's branch, then `git fetch origin main && git rebase origin/main && git push origin
HEAD:main`. Tags can't be pushed from the cloud. Run Electron as `xvfb-run -a node_modules/electron/dist/electron
--no-sandbox desktop`. No user data, accounts, sign-ins, phone or Android SDK; the app's Claude calls usually lack a
login (test tool handlers directly). Test footage: `ffmpeg -f lavfi -i testsrc2` + `espeak-ng -w` (never tones or
music). Whisper models, yt-dlp sources and Whop/TikTok/Instagram need Full network access; otherwise test against a
stand-in and note what's left under PLAN.md *Waiting on me*.
