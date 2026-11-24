# CLAUDE.md

Content Studio, the new app (branch `next` since 2026-11-23; it replaces `main` once a daily episode comes out of
it): I press **Make** and a ready-to-post, production-grade video or carousel lands in Review. Claude makes every
creative choice, mechanical tools do the rest, my comments teach lessons. PLAN.md has the decisions, parts, targets
and phases; read only the section you need.

## Where things run

- **ai-server** (the GTX 1070 PC, `bouyaka@ai-server`, on 24/7): the app (Node 24 on 127.0.0.1:8787, systemd user
  service `content-studio`), its data (`~/.local/share/studio`), renders, and Claude (Agent SDK on my Pro login
  there). On the tailnet by Tailscale Serve: https://ai-server.tail1e2ac8.ts.net. Never Funnel.
- **Laptop**: Claude Code and the app in Chrome. `cs` talks to ai-server; `npm run deploy` ships code.
- **Phone**: the Android app (`mobile/`), paired with a code from Settings → Phone.

## Layout

- `server/` — Fastify + `node:sqlite`, run straight from TypeScript by Node's type stripping (no build): erasable
  syntax only (no enums, namespaces or parameter properties), relative imports end in `.ts`, `import type` for types.
  `db/` (SQL migrations, applied in name order), `services/` (board, inputs and resumable uploads, versions and
  renders, comments, rules, devices), `jobs/` (queue, runner with lanes: one heavy job at a time, kinds),
  `engine/` (`claude.ts`, `media.ts`, `render.ts` + `render-child.ts` = the HyperFrames producer in its own process,
  `writing.ts` for Write and Hooks, `recipes/`, `compose/`), `http/` (`app.ts` auth, `routes.ts`).
- `web/` — React 19 + Vite + Tailwind 4 + shadcn (`components/ui` is generated: compose, don't edit). Board, card
  (`components/card/`: Doc, Files, Review, Versions), page settings, rules, settings. `usePhone()` for the phone
  layout; `vite --mode app` builds the APK's UI.
- `cli/cs.ts` — the app from the terminal.
- `shared/` — types for every side (`types.ts`, `recipes.ts`), plain data only.
- `mobile/` — Capacitor 8 Android app: `StudioPlugin` (pairing, share inbox, background resumable uploads, downloads).
- `scripts/` — `setup-server.sh` (ai-server), `deploy.sh`.

## Rules that matter

- **Halal**: nothing made contains music or instruments, ever (SFX fine; voice-only sound fine; a vocal nasheed only
  by my choice); music in any footage is removed; no women on camera; nothing haram; religion cited, no rulings,
  nothing tied to another religion; Gentle Return never shows my face. Seeded as locked rules (`services/rules.ts`).
- **No Anthropic API key, ever**: Claude runs through `@anthropic-ai/claude-agent-sdk` on the Pro login
  (`engine/claude.ts` drops `ANTHROPIC_API_KEY`). Every call names its task and is counted (`claude_calls`). Opus for
  creative choices and reviews. Background work waits while 5-hour usage ≥ 80 % (`waitForUsage`); what I press and
  wait on never waits (`now: true`).
- **Claude never approves or publishes**: Approve is my click; there is no publishing code.
- **Every comment I leave is a lesson**: fixing it also records the general rule (rules, source `lesson`); when the
  pipeline caused it, change that code too so no later video repeats it.
- **Modular**: recipes are defaults, not limits; any page can use any recipe or mix them; a card's Notes steer it.
  Don't fit the engine to one scenario.
- **Existing FOSS first** (HyperFrames native projects, FFmpeg, local models), licences noted in PLAN.md *Parts*.
- **Auth**: the server listens on 127.0.0.1 only. Tailscale Serve adds `Tailscale-User-Login`; a paired device sends
  a bearer token (media and live events: `?t=`); Funnel requests are refused (`http/app.ts`).
- **HyperFrames**: footage goes into a project as a hard link (a symbolic link to outside the project renders black);
  GSAP is copied into each project, so a render never needs the network.
- **UI**: dark only, few words, quiet colours, one alarm colour (`destructive`) only on what needs me. No
  `alert`/`confirm`/`prompt`. Ask before adding a screen or a button.
- Stop processes by PID (`ss -ltnp | grep :8787`): `pkill -f` patterns match the shell running them and other repos'
  servers.

## Commands

- `npm run dev` (server on 8787 + Vite on 5173), `npm run typecheck`, `npm test`
- `npm run deploy` — push and restart on ai-server (the first time it runs `scripts/setup-server.sh` there)
- `npm run cs -- help`: `board`, `card`, `new`, `set`, `add`, `write`, `hooks`, `make`, `fix`, `test-render`,
  `comments`, `jobs`, `rules`, `pair`. `CS_SERVER` points it elsewhere (e.g. a test server).
- `npm run android` — the app's UI build + `cap sync`. APKs come from CI on a `v*` tag (bump the root
  `package.json` version). Never generate a new signing key.

## Working rules

- Commit and push when a job is done (typecheck passes, flow tried), without asking. Never commit secrets: service
  keys live in `~/.config/content-studio/keys.env` on ai-server.
- Few tokens: compact digests, small contact sheets, `cs` instead of reading code to check state.
