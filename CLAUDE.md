# CLAUDE.md

Content Studio: single-user Electron desktop app that shows me my videos and takes my clicks; Claude (Claude Code in
the terminal) does the editing, organising and scheduling. The phone (Android app, Capacitor) has every page the laptop
has, laid out for it, and also sends footage and downloads videos. PLAN.md has the decisions (*Phase 14* is the current shape), measurements and open items. Read only the
section you need.

## Layout

- `desktop/` — Electron: spawns `server/dist/server.mjs` with `ELECTRON_RUN_AS_NODE=1`, signs in with a per-launch
  `DESKTOP_TOKEN` (`POST /api/auth/desktop`), tray, notifications, `window.desktop` bridge (`src/preload.ts`), signed-in
  site windows (`src/sites.ts`).
- `server/` — Fastify on 127.0.0.1:8787. SQLite = `node:sqlite` behind a better-sqlite3-shaped shim
  (`src/db/sqlite.ts`); never import `drizzle-orm/better-sqlite3` (pulls in the native module; no C toolchain here).
  Main areas: `claude/` (the agent that fixes an edit before its render, its tools, prompts, plugin), `services/board.ts`
  (the board), `services/script-help.ts` (Hooks, Directions), `studio/` (edits → HyperFrames, render), `publish/`
  (Instagram), `campaigns/`, `clipping/`, `knowledge/` (the playbook as editable rules, references), `toolbox/` (what's
  installed and used, installing skills, the weekly scout), `jobs/` (queue), `db/phase14.ts` (the one-off move).
- `web/` — React UI. Top bar: Home, then one tab per page; under a page its sections (`lib/nav.ts`: Videos ·
  Series · Calendar, or Campaigns · Clips · Calendar). Home and the sections are one board (`components/board/Board.tsx`,
  columns from stages in `shared/board.ts`); a card opens at `/c/:id` (`pages/CardPage.tsx`: at every stage the Script
  + Notes document and the render + comments + Approve, the one the stage needs first; one shared `useDraft`). A series
  (`pages/SeriesPage.tsx`, `services/series.ts`) is a name, an About every episode follows, and cards numbered in its
  order (`pieces.seriesId`, `episode`). The phone (`usePhone()`: the app or a narrow window) gets the same pages in
  `components/PhoneShell.tsx` (a menu for the top bar, boards as one list: `board/BoardList.tsx`); offline it reads its
  copy and queues drafts (`lib/offline.ts`), and plays videos it downloaded (`lib/downloads.ts`).
  `isDesktop` (`lib/desktop.ts`), `isApp`/`isNative` (`lib/native.ts`, the `vite --mode app` build).
- `mobile/` — Capacitor 8, committed `android/`, one native plugin `StudioPlugin` (Java). CI builds APKs.
- `shared/` — types for both sides (`types.ts`, `edit.ts`, `campaigns.ts`, `clipping.ts`, …).
- Data: `~/.local/share/content-studio` (`CONTENT_STUDIO_DATA_DIR` overrides; also moves Electron's profile).

## Rules that matter

- **Halal: no music, ever.** Nothing made may contain music or instruments (tracks, beds, stingers, trending sounds,
  TikTok auto-add-music). SFX fine (non-melodic). The line is instruments: voice-only sound (a hum, wordless voices,
  a nasheed without instruments) isn't music: fine in references and sources, in an edit only as the nasheed. An edit's only track is `audio.nasheed` (vocal-only, set by the user
  only; `withAuthorNasheed` keeps Claude from changing it). SFX = `sfx` assets or built-ins (`shared/sfx.ts`,
  `server/assets/sfx`, rebuilt by `server/scripts/make-sfx.py`). No music asset type. Third-party skills' music advice
  never applies. Voiceover plays only my own recordings (`capture`, `share` or `upload` audio).
- **No Anthropic API key, ever.** Claude runs via `@anthropic-ai/claude-agent-sdk` on the Pro login
  (`claude/options.ts` strips `ANTHROPIC_API_KEY`). Few LLM calls: mechanical work is Whisper/FFmpeg; background jobs
  use Haiku, but editing (picking clips, frame checks, directions, the check before a render and its fix) uses Opus,
  the best model; background jobs wait (not fail) while 5-hour usage ≥ 80 % (`waitForUsage(task)`), but what I click
  for and wait on (Hooks, Directions) never waits: `askStructured({ now: true })`. Every model call names its task
  (`shared/ai.ts`); everything runs on Claude (the self-hosted model, generated pictures/clips and computer voices were
  deleted on 2026-11-05).
- **AI in the UI is only Hooks and Directions on a script, and the look switch on a render** (PLAN.md *Phase 14*). No
  chat, no other AI buttons, no stats screens; few words, quiet colours, one alarm colour (`destructive`) only on what
  needs me. Ask before adding a feature, a button or a screen.
- **Claude never rewrites my scripts**: Hooks are other first lines to take or leave, Directions go under Notes, each on
  my click. Gentle Return (the Islamic page) is the exception: Claude writes its scripts and plans their visuals in Notes
  (`npm run series`), I record the voice (my face is never seen), and changes I make there are mine. A card's document is `script` (what I say) then `notes` (the effects I want); I can rename both headings
  (`DraftContent.labels`).
- **Claude's tools are scoped to one workspace** (`buildTools(workspaceId)`), every tool checks ownership. The in-app
  agent (`claude/agent.ts`) only fixes an edit that fails the check before its render; I talk to Claude in Claude Code.
  Claude edits drafts/edits freely (versions authored `claude`) and may render, but never schedules, publishes,
  approves, rejects or submits: those need the user's click. Never give Claude a publish tool. Footage landing on a
  card doesn't start an edit: I tell Claude Code.
- **Every comment I leave on a video is a lesson** (`knowledge/lessons.ts`): fixing it also records the general rule
  (a Knowledge rule, source `comments`, or the lesson it repeats) via `resolve_note` or `npm run notes -- fix`.
  Lessons go into every prompt that picks, makes or judges a video (`lessonsText`), and the check before a render
  tests each one (a broken one sends it back to Claude, clips too). When the mistake came from the pipeline (clip
  picker/maker, framing, a template), change that code as well, so the next video can't make it.
- Renders draw their frames on a home PC that has `render` (`setup-worker.sh --with render`): the laptop cuts and
  grades the footage, sends the project as a tar (`renderRemote`), and renders itself when no worker has it or fails.
- Skills: `.claude/skills` loads as the `studio-skills` plugin for the in-app agent (`claude/plugin.ts`, allow-list
  `CHAT_SKILLS`); skills I install from the Toolbox go to `<data>/skills-added` (plugin `studio-added`) or
  `~/.claude/skills` (Claude Code only), never with sound or video files; the agent's Read is held to the plugin
  folders by a hook; claude.ai connectors off. Background prompts don't load skills: paste playbook files with
  `playbook(...)`, first in the system prompt, and a skill's SKILL.md with `skill(...)` (`services/script-help.ts`).
- Scenes (`shared/scene.ts`) are data: never let a scene carry script, `url()` or `random()`.
- **Only Instagram** (2026-11-03; TikTok, YouTube and X posting deleted 2026-11-05). Campaign rules naming another
  platform don't apply to an Instagram clip (`ruleScope`). A campaign link I drop on a clipping page (Campaigns) is my
  yes: once read it goes live unless the halal screen rejects it.
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
- Stages: every page has `BOARD_STAGES` (`shared/types.ts`); `columnOf` (`shared/board.ts`) maps them to the board.
  A render that finishes moves a card in Making, Editing or Ready to film to Review (`studio/render.ts`).
- UI: shadcn/ui (radix-nova) in `web/src/components/ui` is generated: compose, don't edit. Dark only, laptop first; every
  page also fits the phone (`md:` for the laptop's layout, `usePhone()` where it differs). No `alert`/`confirm`/`prompt`.
- `pkill -f "<pattern>"` from a shell whose command line contains the pattern kills that shell: use `[x]yz` patterns.

## Commands

- `npm run dev` (desktop + server + Vite), `npm run dev:web` (browser only), `npm run typecheck`
- `npm run install-app` — build, package, install to `~/.local/lib/content-studio`, restart if running
- `npm run notes` — my open comments on finished videos (pinned to a moment or stretch, with the words, clip and
  overlays there) and the lessons so far; after fixing, `npm run notes -- fix <noteId> "<what changed>"` plus the
  lesson: `--lesson <id> ["sharper rule"]`, `--new <topic> "<title>" "<rule>"` or `--one-off "<why>"` (`answer`
  leaves it open; `lessons` lists them). A clip whose story starts earlier or ends later than its cut:
  `npm run notes -- source <pieceId>` (the source's words around it), then `recut <pieceId> <start> <end>` (the running
  app makes it again on the same card, comments kept, and renders it).
- `npm run edit` — editing a video from here (`-- help` for everything): `<card>` (the edit: clips with their words and
  mid-word cut warnings, overlays, versions, renders, the card's files), `takes` (each take as lines between pauses;
  flags reps Whisper skipped), `types` (the edit's types, instead of reading `shared/edit.ts`), `set` / `put` (save a
  version: a few fields, or a design `.mts` kept in `<data>/edit-work/<pieceId>/`), `frames` / `preview` (one small
  contact sheet to Read), `check`, `render --wait`, `heard` (what the render says, by Whisper).
- `npm run series` — every page's series with its episodes; `-- <seriesId>` with their scripts; `new <page> "<name>"
  ["<about>"]`, `about`, `episode <seriesId> "<title>" --script <file> --notes <file> [--film]` (Claude's, as a
  version), `write <pieceId> …`, `add <pieceId> <seriesId|none>`, `order <seriesId> <pieceId>…`.
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
- **Edit videos on few tokens**: every step through `npm run edit` (no scratch scripts; read studio source only to change
  the pipeline, and fix the command when it lacks something). Pictures: its sheets as they come (300 px a frame);
  bigger only for one frame's detail. `--dry` before a big change. One video per session: once its render is queued or
  a pipeline fix is committed, tell me in one line to `/compact` (or `/clear` for the next video).
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
