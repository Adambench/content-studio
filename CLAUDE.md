# CLAUDE.md

Content Studio, the new app (branch `next` since 2026-11-23; it replaces `main` once a daily episode comes out of
it). Rebuilt 2026-11-24 (N1): an **inbox** and a **studio per video**. I say what I want (or drop takes); Claude Code
works in the video's own folder on ai-server and saves versions; I leave notes pinned to moments, **Fix**, **Approve**,
post. Every note teaches a lesson. A **page** is one Instagram account (called a brand until 2026-11-24): I give what
I have (info, samples, a kit, links) and Claude sets it up with me in the page's own studio (`setup/`, a video row of
kind `page`): name, voice, look (`kit/`), formats, first ideas, written into the page's CLAUDE.md for every video.
PLAN.md has the decisions (*The app*), parts, targets and phases; read only the section you need.

## Where things run

- **ai-server** (the GTX 1070 PC, Linux Mint, `bouyaka@ai-server`, on 24/7): the app (Node 24 on 127.0.0.1:8787,
  systemd user service `content-studio`), the studio (`~/studio/<page>/<video>/`: files/, work/, renders/,
  project.md, script.md; each page also has `kit/` and `setup/`; `~/studio/CLAUDE.md` is written by the app,
  `lessons.md` and `<page>/CLAUDE.md` are the brain), the app's data (`~/.local/share/studio`: SQLite, uploads, tools, HyperFrames' private cache), and Claude (the
  Agent SDK's own Claude Code binary on my Pro login: a `claude setup-token` token in
  `~/.config/content-studio/keys.env`). Skills: the repo's `.claude/skills`, linked into `~/.claude/skills` on
  deploy. At https://ai-server.tail1e2ac8.ts.net:8443, on the tailnet and (Funnel, since 2026-11-26) the internet, for
  the phone, which can't run Tailscale. Port 443 there is Open WebUI's (Docker, with its own Funnel): never touch it.
- **Laptop**: Claude Code (dev) and the app in Chrome. `cs` talks to ai-server; `npm run deploy` ships code.
- **Phone**: the Android app, a thin shell that loads the live app from ai-server (`mobile/`): gallery share →
  a video ("Add & make"), background uploads, saving to the gallery.

## Layout

- `server/` — Fastify + `node:sqlite`, run straight from TypeScript by Node's type stripping (no build): erasable
  syntax only (no enums, namespaces or parameter properties), relative imports end in `.ts`, `import type` for types.
  `db/` (SQL migrations, applied in name order), `services/` (pages, videos = folders, thread, notes, inputs and
  resumable uploads, versions, runs = what starts Claude, brain = the CLAUDE.md/lessons files, devices), `jobs/`
  (queue, runner with lanes: Claude runs one per video, GPU turns in `engine/gpu.ts`), `engine/` (`agent.ts` =
  Claude Code per video, `guard.ts` = its guard rails, `tools.ts` = the studio's MCP tools, `claude.ts` = login,
  usage, one-off answers, `render.ts` + `render-child.ts` = HyperFrames, `media.ts`), `http/` (`app.ts` auth,
  `routes.ts`, `terminal.ts` = Claude Code in the browser, a video's Terminal tab, over a WebSocket).
- `web/` — React 19 + Vite + Tailwind 4 + shadcn (`components/ui` is generated: compose, don't edit). Inbox, video
  page (`components/video/`: Stage, Timeline, Thread, Dock, Tabs, PostSheet, `player.ts` store), Brain, Server,
  Ctrl K palette, share sheet. `usePhone()` for the phone layout.
- `cli/cs.ts` — the app from the terminal.
- `shared/` — types for every side (`types.ts`), plain data only.
- `mobile/` — Capacitor 8 Android shell (`server.url` = ai-server; `shell/` = the offline page): `StudioPlugin`
  (share inbox, background resumable uploads, downloads).
- `scripts/` — `setup-server.sh` (ai-server), `deploy.sh` (also links the skills, keeps skill edits Claude made on
  ai-server in `~/studio/skill-changes/`).

## Rules that matter

- **Halal**: nothing made contains music or instruments, ever (SFX fine; voice-only sound fine; a vocal nasheed only
  by my choice); music in any footage is removed; no women on camera; nothing haram; religion cited, no rulings,
  nothing tied to another religion; Gentle Return never shows my face. Seeded as locked rules (`services/rules.ts`).
- **No Anthropic API key, ever**: Claude runs through `@anthropic-ai/claude-agent-sdk` on the Pro login
  (`engine/claude.ts` drops `ANTHROPIC_API_KEY`). Every call names its task and is counted (`claude_calls`). Opus for
  creative choices and reviews. Background work waits while 5-hour usage ≥ 80 % or the week's ≥ 90 % (`waitForUsage`); pages set up in
  bulk (`cs setup … --later`) run one at a time, and Go (or any message) starts a held one now. What I press and wait
  on never waits (`now: true`).
- **Claude never approves or publishes**: Approve is my click; there is no publishing code.
- **Claude Code per video**: full shell, no approval prompts (my yes, 2026-11-24) inside `engine/guard.ts`: never
  sudo, Docker, Ollama, Open WebUI, systemd or the network; deletes only inside the video's folder (or /tmp, the
  engine's tools, caches); no keys; never posts. Change the rails only with my say.
- **Few tokens per video** (PLAN.md *T1*): a run gets only the tools and skill descriptions it needs
  (`studioSettings()`, `TOOLS` in `engine/agent.ts`), resumes its session only within 55 min and under 60 k context
  (else a new one from project.md), and every run's cost is in `cs runs`. Mechanical work (transcripts, checks,
  building) belongs to the server's code and tools, not to Claude's turns; Claude gets short digests and small sheets.
- **Every comment I leave is a lesson**: fixing it also records the general rule (rules, source `lesson`); when the
  pipeline caused it, change that code too so no later video repeats it (a video's Claude queues it in
  `~/studio/pipeline-todo.md`, `cs todo`; the laptop session makes it).
- **Modular**: recipes are defaults, not limits; any page can use any recipe or mix them; a card's Notes steer it.
  Don't fit the engine to one scenario.
- **Existing FOSS first** (HyperFrames native projects, FFmpeg, local models), licences noted in PLAN.md *Parts*.
- **Auth**: the server listens on 127.0.0.1 only. Tailscale Serve adds `Tailscale-User-Login`; a paired device sends
  a bearer token (media and live events: `?t=`). From Funnel only a paired device gets in (`http/app.ts`): the
  sign-in screen takes a code from Server → Pair a phone or `cs pair`. More guard rails to come (my call, 2026-11-26).
- **HyperFrames**: footage goes into a project as a hard link (a symbolic link to outside the project renders black);
  GSAP is copied into each project, so a render never needs the network.
- **UI**: dark only, few words, quiet colours; blue (`you`) for what's waiting for me, `destructive` only for what
  broke. No `alert`/`confirm`/`prompt`. Ask before adding a screen.
- Stop processes by PID (`ss -ltnp | grep :8787`): `pkill -f` patterns match the shell running them and other repos'
  servers.

## Commands

- `npm run dev` (server on 8787 + Vite on 5173), `npm run typecheck`, `npm test`
- `npm run deploy` — push and restart on ai-server (the first time it runs `scripts/setup-server.sh` there)
- `npm run cs -- help`: `status`, `pages`, `page`, `setup`, `videos`, `video`, `new`, `add`, `say`, `go`, `fix`, `stop`, `note`,
  `thread`, `approve`, `posted`, `test-render`, `jobs`, `pair`, `runs` (what each Claude run cost), `todo`. `CS_SERVER` points it elsewhere (e.g. a test server).
- `npm run android` — `cap sync` of the shell. APKs come from CI on a `v*` tag (bump the root `package.json`
  version). Never generate a new signing key.

## Working rules

- Commit and push when a job is done (typecheck passes, flow tried), without asking. Never commit secrets: service
  keys live in `~/.config/content-studio/keys.env` on ai-server.
- Few tokens: compact digests, small contact sheets, `cs` instead of reading code to check state.
