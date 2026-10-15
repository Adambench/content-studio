# CLAUDE.md

Content Studio is a single-user desktop app (Electron) for planning, writing, editing and scheduling social
content, with a web UI that the phone uses through an Android app (Capacitor) or as a PWA. README.md lists features;
PLAN.md has the decisions and phased roadmap. Built: phase 1 (pipeline + Claude), 3 (scheduling/publishing via the
platforms' official APIs), 4 (analytics + weekly Claude review) and 6 (Android app); phase 2 (video studio:
HyperFrames + FFmpeg) is usable and being extended.

## Architecture

- `desktop/` — Electron main process spawns the bundled server (`server/dist/server.mjs`) with
  `ELECTRON_RUN_AS_NODE=1`, waits for `/api/health`, signs in via `POST /api/auth/desktop` with a per-launch
  `DESKTOP_TOKEN`, puts the session cookie into the window, and loads the UI. Tray, start-at-login (XDG
  autostart file), native notifications and a small `window.desktop` bridge (`desktop/src/preload.ts`).
- `server/` — Fastify on 127.0.0.1:8787. SQLite is Node's built-in `node:sqlite` behind a better-sqlite3-shaped
  shim (`server/src/db/sqlite.ts`) so drizzle's sync driver works and nothing native needs compiling for
  Electron (there's no C toolchain on this machine). Don't import `drizzle-orm/better-sqlite3` (the driver
  entry): it pulls in the native module. `server/src/db/index.ts` assembles the db by hand.
- `web/` — React UI. Detect the desktop app with `desktop`/`isDesktop` from `web/src/lib/desktop.ts`, the Android app
  with `isApp` (the `vite --mode app` build, into `web/dist-app`) / `isNative` from `web/src/lib/native.ts`.
- `mobile/` — the Android app: Capacitor 8 around the app build of `web/`, committed `android/` project (regenerated
  bits come from `cap sync`). Its native side is one plugin, `StudioPlugin` (Java): pairing kept with a Keystore key,
  share intents (`ShareInbox`), the upload queue (`UploadQueue` + `UploadWorker`, WorkManager + OkHttp, resumable),
  recorder, lock, Google's code scanner, Firebase started from options the server hands over (`App`). The app is
  paired with a server and signs in with a device token: never cookies. CI (`.github/workflows/android.yml`) builds
  the APKs; version = root `package.json` (`v*` tags must match).
- Auth (`server/src/routes/auth.ts`): `requestSession` takes the cookie or `Authorization: Bearer <device token>`
  (sessions store only its SHA-256). GETs the WebView makes without headers (media files/thumbs/proxies, `/api/events`,
  the studio preview and its scripts/fonts) may pass `?access_token=` — only paths in `TOKEN_IN_QUERY`; in the UI build
  such URLs with `fileUrl()`/`mediaFileUrl()`/`mediaThumbUrl()` and call the API through `api()`/`apiFetch()`, never a
  bare `/api/…` (the app's origin is `https://localhost`; the server answers it with CORS). Bump `API_VERSION`
  (`shared/devices.ts`) for changes an older app can't handle.
- Data: `~/.local/share/content-studio` (override `CONTENT_STUDIO_DATA_DIR`). App files resolve from
  `APP_RESOURCES` (set by Electron) or the repo root.
- Video studio (`server/src/studio`): an edit is JSON (`EditSpec`, `shared/edit.ts` — use `normalizeEdit`;
  `validateSpec` checks file ownership). `compose.ts` compiles it to a HyperFrames page used by both the preview
  (`/api/edits/:id/preview.html`, proxies, our own copy of the runtime) and the render (`render.ts`: FFmpeg cuts
  graded segments, then forks `worker.ts` → `server/dist/render-worker.mjs`, which runs `@hyperframes/producer`).
  Timed elements must not be zero-height (the runtime stretches them): put positioned content inside a full-frame
  `.layer`. HyperFrames' own colour grading hangs headless Chrome here — grade with FFmpeg `lut3d`.

- Publishing (`server/src/publish`): accounts per workspace (tokens server-side only — `publicAccount` strips them),
  OAuth via the system browser back to `/api/oauth/:platform/callback` (public; the one-time `state` is the proof),
  posts (copy snapshotted from the draft at scheduling), `scheduler.ts` (15 s tick → `post.publish` jobs, catch-up
  window, logind inhibitor, token sweep) and one adapter per platform in `platforms/`. Adapters keep resume state in
  `posts.remote` via `ctx.save` so a retry never posts twice — keep that true for any new platform. Instagram and
  TikTok photos download media from signed `/api/public/media/…` links on the public (Funnel) address.
  `CS_PLATFORM_API=http://127.0.0.1:9911` routes all platform calls to a local stand-in for testing.
- Analytics (`server/src/analytics`): `stats.ts` is the `stats.sync` job — adapters' `postStats`/`accountStats` (each
  platform declares the extra `statsScopes` it needs) → a `post_stats` reading per post (cadence by age,
  `statsInterval` in `shared/analytics.ts`), the latest copied onto `posts.stats`, followers once a day in
  `account_stats` (keyed by platform + external id, so history survives reconnecting). `report.ts` works out
  “× typical” (views after 24 h against the account's median), the page's overview and `digest()`, the text Claude reads.
  `review.ts` is the weekly review (`analytics.review` job, timer in `schedule.ts`). Keep the numbers mechanical; Claude
  only interprets the digest.

## Commands

- `npm run dev` — desktop window + server (tsx watch) + Vite; `npm run dev:web` for browser only
- `npm run typecheck` — server, web, desktop and mobile (TypeScript 7)
- `npm run install-app` — build, package (`desktop/release/linux-unpacked`) and install to
  `~/.local/lib/content-studio` with an app-menu entry; restarts the app if it was running
- `npm run db:generate -w server` — after editing `server/src/db/schema.ts`; migrations run on startup. drizzle-kit
  drops `ON DELETE` from foreign keys it adds with `ALTER TABLE`: check the generated SQL
- `npm run android` — build the app UI and `cap sync` it into `mobile/android`; `npm run dev:app -w web` tries the app
  UI in a browser. APKs need JDK 21 + the Android SDK (`cd mobile/android && ./gradlew assembleDebug`) or CI
- HyperFrames packages are pinned exactly (they release daily); keep producer, core and player on one version.
  `puppeteer@…` is blocked in `allowScripts` so installs don't download a 670 MB Chrome; the app fetches its own.
  Packages that read files from their own folder are external to the server bundle and copied with their
  dependency trees by `desktop/scripts/package.mjs` — add new ones there.
- `.claude/skills/` — third-party skills installed with `npx skills add <repo> -a claude-code --copy -s <names>`
  (tracked in `skills-lock.json`); `npx skills update -p` refreshes them — then delete `last30days/assets` again
  (demo files, one of them music). `content-principles` has no license: personal use only. `playbook` is ours (not
  in `skills-lock.json`): the shared knowledge base on hooks, retention, clipping, packaging, sound and halal.
- Screenshot the app for checking UI: `CONTENT_STUDIO_DATA_DIR=/tmp/x PORT=8797 CS_OPEN_PATH=/settings
  CS_SCREENSHOT=/tmp/x.png CS_SCREENSHOT_QUIT=1 node_modules/electron/dist/electron desktop` (after building)

## Rules that matter

- **Halal: no music, ever.** Nothing the app or Claude makes may contain music or musical instruments: no music
  tracks, beds, stingers, trending sounds or TikTok "auto add music". SFX are fine (whooshes, pops, clicks, impacts,
  dings, risers); a vocal-only nasheed only when the user OKs that edit. Background music in source footage is removed
  (Demucs) or the clip is dropped, and nothing haram is promoted (PLAN.md *Halal*). The third-party skills in
  `.claude/skills` assume music in places — that advice never applies here.
- **No Anthropic API key, ever.** Claude runs through `@anthropic-ai/claude-agent-sdk` on the user's Claude
  Pro login (`server/src/claude/options.ts` strips `ANTHROPIC_API_KEY`). Keep LLM calls few: mechanical work
  (transcription, probing, cutting) is done by Whisper/FFmpeg, background jobs use Haiku.
- **Claude's tools are scoped to one workspace** (`buildTools(workspaceId)` in `server/src/claude/tools.ts`);
  every tool checks ownership. Claude may edit drafts freely (each write is a version authored `claude`), but
  anything that schedules or publishes must require the user's click — never give Claude a direct publish tool.
  Claude only reads the schedule (`get_schedule`); scheduled posts hold their own copy so draft edits can't change
  what goes out.
  Rendering is local and allowed (`render_edit`); edits Claude saves are versions authored `claude`.
  The weekly review may rewrite the voice memory (with Undo, and only if it didn't change meanwhile), but queue-time
  changes and new idea cards from a review only happen on the user's click; `get_analytics` is read-only.
- **Skills in the app** (`server/src/claude/plugin.ts`): `.claude/skills` loads as the `studio-skills` plugin (built in
  the data dir in development, `claude-plugin/` in the package) with an allow-list (`CHAT_SKILLS`: knowledge skills
  only); the chat's one file tool, Read, is held to the plugin folder by a PreToolUse hook. `baseOptions()` turns off
  the login's claude.ai connectors (`ENABLE_CLAUDEAI_MCP_SERVERS=false`). Background prompts don't load skills: paste
  the playbook files they need with `playbook(...)`, first in the system prompt.
- The phone password can only be set from the desktop app (`/api/auth/setup` is refused when `DESKTOP_TOKEN`
  is set), so whoever reaches the Funnel URL first can't claim it.
- Drafts have one shape, `DraftContent` in `shared/types.ts`; use `normalizeDraft`/`mergeDraft`.
- Live updates: server `emit()` → `/api/events` SSE → `web/src/lib/live.ts`. New entities need both sides.
- External binaries (ffmpeg, ffprobe, python3) go through `findBinary` (`server/src/lib/bin.ts`): apps started
  from the launcher get a minimal PATH.
- UI: shadcn/ui (radix-nova) in `web/src/components/ui` — generated, compose rather than edit. Dark only.
  Mobile is first-class (Android PWA, bottom nav, share target). No `alert`/`confirm`/`prompt`.
- Stopping a dev server with `pkill -f "<pattern>"` from a shell whose own command line contains that pattern
  kills the shell; use `[x]yz`-style patterns or a separate command.
