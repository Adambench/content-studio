# Content Studio — plan

Decisions, measurements and what's left. What's built is in the code and git history; don't re-describe it here.

## Decisions

| Topic | Decision |
|---|---|
| Users | Just me (single user) |
| Where | Electron desktop app on the laptop (Zorin 18, i5-1135G7, 16 GB, Iris Xe) runs its own server; the phone uses the Android app (or PWA) over Tailscale Funnel's `*.ts.net` address |
| Posting | Each platform's official API with my own developer apps; no aggregators. Formats: short vertical video + image posts/carousels |
| Claude | Agent SDK on the Claude Pro login, never an API key; or the self-hosted model on the home server (phase 9). Edits ideas/drafts/edits freely; scheduling, publishing, approving and submitting are always my click |
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

2026-10-27: the pages to post on next are the personal brand (Muslim entrepreneurship, lifestyle) and a separate Islamic
page; Vetto is dropped and clipping is paused (see *Phase 12*).

### Pages (account review, 2026-10-27)

Five pages: a personal brand, an Islamic page and three clipping pages (Whop clipping and Whop UGC campaigns). All in
English, Instagram Reels first (TikTok and Shorts later; settings stay ready for them). Step 0 still wipes the old
clipping data; the three clipping pages start clean.

| Personal brand | |
|---|---|
| Name | Not decided |
| Goal | Document now and share what I know: an entrepreneurial reputation first. The business comes later (a real model AI can't copy, not a vibe-coded app; maybe a startup, not decided) |
| Topics | Halal business; lifestyle and discipline. Real experience: selling products, services, content/clipping |
| Audience | Anyone, through a Muslim lens (how visible the lens is, and the call to action, are in my scripts) |
| Scripts | I write them. Claude never rewrites my words; it offers 2–3 alternative first lines I can take or leave |
| Format | On camera (2026-11-03; was faceless): I film myself talking to camera on my phone and share the clips to the app; the edit cuts pauses, stumbles and retakes. My voice on camera (a voice memo for parts I don't film), the AI voice as backup. Mascot explainers and paper boards as cutaways in lessons, my own B-roll for lifestyle. My own editing touches go in as Knowledge rules |
| Tone | Changes with the video: calm for lessons, blunt for opinions, energetic, funny for the relatable ones |
| Look | Paper / sketch (off-white paper, ink lines); clean sentence captions, a line at a time; accent picked by Claude |
| Cadence | 3 a week |
| References | Later, through Knowledge → References |

| Islamic page | |
|---|---|
| Name | Gentle Return |
| Goal | Reminders at scale: reach as many Muslims as possible, for the reward |
| Topics | Reminders (akhirah, patience, tawakkul, the heart); stories of the prophets, sahaba, seerah and history (told, never shown); one ayah or hadith explained, names of Allah, du'as; practical deen (salah, habits; contested fiqh left out) |
| Audience | All Muslims |
| Sources | The Quran, sahih hadith and well-known scholars, always cited on screen; no fatwas |
| Mix | 1 a day: about half lecture clips, half originals. Modules: ideas & scripts, clipping, research |
| Originals | I pick the ayah, hadith or story; Claude writes the script, with citations. My own voice (a voice memo); no AI voice |
| Lecture clips | Only channels that allow clips (they say so, or Creative Commons), the speaker always named on screen. The lecture footage when it's strong, else the voice over scenery, picked per clip. Any music in the source removed |
| Ayat | Arabic on screen with the English meaning; the voice speaks English only (no recitation audio) |
| Look | Picked per video: Islamic geometry (gold on deep green or navy, calligraphy), night and lantern light, empty landscapes. Clean sentence captions |
| Mascot | A faceless figure (no eyes, no mouth). Never a prophet or companion |
| References | Later |

Clipping pages: one niche each, Whop campaigns only (nothing between campaigns), 1–2 clips a day each, every clip
reviewed by me. UGC is faceless only (mascot, motion, screen recordings, AI voice). A third clipping page waits (my
proposal was tech, AI and apps).

| Blox Moments (Roblox) | |
|---|---|
| Does | Clips only: Roblox creators' videos and game campaigns' own footage. No UGC that needs me to play |
| Out | Games built on gambling mechanics (spins, crates, betting), on top of the halal screen. Game music always removed |

| Long Story Short (podcasts) | |
|---|---|
| Does | Clips from interview, life-story and business podcasts; faceless UGC campaigns when they fit (business, apps), acted by its mascot |

Both clipping pages: big word-by-word captions. Brands (2026-10-29): Claude drafts every page's brand (mascot, profile
picture, palette, fonts, captions, voice, bio) and I approve or ask for changes. Drafts in
`~/Documents/content-studio-brand/` (open `index.html`; rebuilt by `node src/build.mjs` there, mascots drawn in
`src/rig.mjs` as one posed outline rig). All approved (2026-10-30):
- Personal brand (amber, paper and ink): me faceless (no eyes or mouth; the page went on camera on 2026-11-03, the mascot stayed faceless as my drawn double for cutaways): a cap with an amber
  growth-arrow patch, gold aviators, a full beard, the oversized amber hoodie, a crossbody bag with cash sticking out.
  Profile picture: him on an amber circle with a hand-drawn rising chart and $ behind him.
- Gentle Return (emerald and gold): the Traveller (faceless, thobe and kufi, a lantern). Profile picture, flat with no
  gradients: an arched door ajar, its light spilling across the floor, the Traveller silhouetted in it.
- Blox Moments (cyan): Blok, a classic blocky avatar (yellow head, simple smile, plain cyan shirt, sideways cap).
- Long Story Short (orange on charcoal): a human podcast host (curly hair, short beard, orange hoodie, big orange
  headphones); signature pose at the desk mic with the page name on the desk.

In the app (2026-10-30, a one-off script kept with the drafts, `src/to-app.mts`; database backed up to
`backups/2026-10-30-before-brands.sqlite` first): four pages in this order: Personal brand (personal, amber), Gentle
Return (personal kind for now, emerald; ideas, clipping, research), Blox Moments (the old Clipping page renamed, cyan)
and Long Story Short (clipping, orange). Each has its niche, About (the bio), a brand guide (goal, topics, rules,
look, palette with hex codes, fonts, captions, voice, mascot), five research keywords, the profile picture under
Brand → Logos, and a video look for new edits: Personal brand *Clean* in ink with amber (dark words now get a paper
box instead of a black one, so they read on footage and vanish on paper), Gentle Return *Subtitle* in cream with gold
and no sound on every move, Blox Moments *Bold* in Fredoka with yellow, Long Story Short *Bold* in Montserrat with
orange. No watermark yet (clipping campaigns often forbid one). The mascot SVGs become step 5's rig.

### Halal (2026-10-15)

| Topic | Decision |
|---|---|
| Music | Never music or instruments anywhere: no tracks, beds, stingers, trending sounds, TikTok auto-add-music; no music asset type |
| Nasheeds | Vocal-only, only with my OK per edit; only the UI sets it, Claude can suggest |
| Voice-only sound | The line is instruments (2026-11-02): a hum, wordless voices, a vocal bed aren't music. Fine in references and sources (never a caution); in an edit only as the nasheed |
| SFX | Allowed: whooshes, pops, clicks, impacts, dings, risers; nothing tonal-melodic |
| Source audio | Music in source footage removed (Demucs voice stem) or the clip dropped |
| Content | Music promotions hidden; nothing haram promoted (gambling, alcohol/drugs/smoking, dating, immodest imagery, interest-based finance). Briefs screened when added, moments by transcript and frames |
| Women on camera | Never (2026-11-04), however dressed. Podcast and interview clips show only the show's own cameras: the guest's inserted photos, home videos and B-roll are cut out (the frame check names those shots, `leftOut`) |

### Clipping (2026-10-15)

Goal: crayo.ai but better: 5–15 clips a day across the pages, made automatically to each campaign's rules, approved
by me one by one. Free and local, apart from Claude. Mechanical filtering first (loudness, pace, chat replay, brief
keywords), then one Claude request per source picks moments; rejections keep their reason for the next pick.
Submitting on Content Rewards stays my click; the app tracks status, counted views and earnings (views × rate until
the site says). Whop has no Content Rewards API for clippers: rules, source files and submissions are read through
the signed-in desktop window.

2026-11-02: two marketplaces, Content Rewards (Whop) and Vyro (MrBeast's, app.vyro.com). Campaigns are a page's:
each is added from the page it posts on (Campaigns in that page's menu; `/campaigns` links open it there) and
confirming needs no page picking. I paste every link (campaigns and source videos), mostly through Claude Code in the
terminal, where the skills are. One key per campaign (the Content Rewards UUID, the last 8 characters of Vyro's id),
so pasting it again never makes a second one (from another page it's added to that page too). whop.com's own pages
aren't campaign links (they don't say which campaign is open). Reading the sites' "joined" lists by themselves was
built and dropped the same day: Content Rewards' cards on /c/campaigns carry no links. When a page can't be read as
it should (Vyro's `?c=` link landed on its catalog once), the read says so and the campaign can be read from its
page's text pasted in (*Read from pasted text*, or `POST /api/campaigns/:id/read {text}`).

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
| UGC | I film it; Claude writes script, shot list, requirements, captions from the brief. Or (phase 12) the page's 2D outline mascot acts it out |

### Publishing (2026-10-14)

| Topic | Decision |
|---|---|
| Apps | One developer app per platform, shared; accounts belong to a workspace |
| Sign-in | System browser → `<public address>/api/oauth/<platform>/callback`, proven by one-time `state` |
| Copy | Snapshotted from the draft when scheduled; later draft edits never change a post without a click |
| TikTok | Send to inbox by default (works unaudited); Post directly after the audit with TikTok's required UI |
| YouTube | Uploaded at the scheduled time (not `publishAt`); unaudited uploads come back private |
| Retries | 5 attempts (30 s → 32 min), each resuming from `posts.remote`; post up to 3 h late after sleep, else missed |
| Queue | Approving a video schedules it (2026-11-03): each account's queue times, at most 2 a day, 3 h apart; a queue time missed by < 3 h with nothing out since means right away; a full day moves it to the next. New accounts: 12:30 and 19:30 (`POSTING`, shared/publish.ts) |

Platform limits: Instagram needs a Business/Creator account and media at a public HTTPS URL, ~50–100 API posts/24 h.
TikTok unaudited = private only (inbox works). YouTube unaudited = private; consent screen must be *In production* or
refresh tokens die in 7 days; no image posts. X: pay-per-use.

### Analytics (2026-10-15)

“× typical” = views after 24 h over the median of the account's posts from the last 90 days. Best times only for
groups of 2+. The weekly review (one Sonnet call per workspace) may rewrite the voice memory (with Undo, only if
unchanged meanwhile); queue times and ideas only on my click. Numbers stay mechanical; Claude only interprets.

### Review loop and dashboard (2026-11-03)

Every finished video goes round: my review (*To watch*, or *Check again* after Claude's changes) → my comments make it
*With Claude* (I say "fix my comments" in Claude Code; it fixes, re-renders, records the lesson) → back to me → *Approve
& schedule* (the queue rule above; Undo in the toast) → Scheduled → Posted. One decision card on the video's page shows
the step and holds the buttons; approving is refused while a comment is open. On boards with a Review column (clipping,
Islamic) the card follows the loop (2026-11-04): my first open comment moves it to the *With Claude* column just before
Review, so Review holds only what I haven't watched; it comes back by itself once no comment is open and its newest
render shows the edit as it is now (`followComments`, `studio/notes.ts`). The dashboard (Today) has the totals on
top (my turn, with Claude, going out today, 7-day views) and one column per page: posting goal (posts a week, mine or
the kind's: personal 3, Islamic 7, clipping 14), this week and today against it, 7-day views and followers, what needs
me there, my turn, Claude's turn, going out, posted lately.

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
| Camera changes | FFmpeg `scdet` on every frame of a 60 s 1080p clip: 2–3 s, every camera change on its exact frame (the old 8 fps scan: 10 of 13 late by 1–3 frames, a 0.57 s shot missed, inset changes taken for cuts). Rule: a jump ≥ 4/100 and ≥ 8× the motion of the 6 frames either side; on three clips it found all 30, with one harmless extra (a split screen's box changing) and no near-misses. Scan v2 with faces: ~10 s a minute |

## Phases

0. **Setup** — on me, not started: Meta app (Instagram API with Unified login: new apps don't get Instagram Login, 2026-11-01), TikTok app (Login Kit + Content
   Posting + Display API), Google Cloud (YouTube Data + Analytics API, audit form), Tailscale Funnel, Firebase.
1. **Pipeline + Claude** — done.
2. **Video studio** — done. Open: grade shown in the preview; hardware encoding (libva).
3. **Scheduling & publishing** — built, tested against a stand-in. Open: real accounts; the TikTok audit demo.
4. **Analytics & weekly review** — built, tested against a stand-in. Open: real numbers.
5. **Later** — X, comments inbox.
6. **Android app** — built, tested on an emulator; v0.2.0 released 2026-11-05 (`API_VERSION` 3). Open: a real phone
   (Obtainium, QR scanning needs Play services, real FCM).
7. **Clipping, campaigns, research, formats** — built.
8. **Streamlined video pipeline** — in progress, see *Phase 8 build plan*
   - [x] Step 1 — Every video is a package; nav per kind; Inbox + search instead of the Library (2026-10-16)
   - [ ] Step 2 — Feedback loop in the package (timestamped notes → Claude edits → re-render → before/after)
   - [x] Step 3 — Compute workers on the home PCs (2026-10-16; protocol tried with a real worker process on CPU, not on a GPU)
   - [x] Step 4 — Skills and the creative arsenal (2026-10-16; no new skills installed, see the step)
   - [x] Step 5 — Creative directions (personal/business) and varied clip edits (clipping) (2026-10-16; the pitch untried against a real Claude login)
   - [x] Step 6 — One-button finder for clipping pages (2026-10-16; only tried against stand-ins, see the step)
   - [x] Step 7 — Effects library, local only (2026-10-16; a first set, see the step)
9. **Self-hosted models** — built 2026-10-17, tried against stand-ins only (see *Phase 9 build plan*)
   - [x] Step 1 — Routing: each AI task on Claude or the home server's model; one *local only* switch; auto switch
   - [x] Step 2 — The chat and the video chats on the local model (own tool loop over the studio tools)
   - [x] Step 3 — A worker hosts the text/vision model (Ollama), found by the laptop on its own
   - [x] Step 4 — Generated b-roll images, video clips (overnight) and covers, never showing people or animals
   - [x] Step 5 — My own voice, cloned, for voiceovers
10. **Hosted generation** — built 2026-10-19 against a stand-in (see *Phase 10 build plan*)
11. **Ideas canvas and save-from-anywhere** — built 2026-10-21 (see *Phase 11*)
12. **Viral quality, knowledge base, toolbox** — built except step 3's recorded library (waits on my pick of a source): steps 0–7 done by 2026-10-30 (see *Phase 12*)
13. **Frame-exact cuts** — built 2026-11-04 (see *Phase 13*); no outside editor
14. **Declutter** — built 2026-11-05 (see *Phase 14*)

## Waiting on me

- Phase 14, after the install: look over the board (my ideas are cards now; Claude's flesh-outs are in each card's
  history), delete one of the two "Announcement" cards, and copy the old Notes plan to Obsidian (it stays in the
  database's `notebook` table). Then update the phone (Android 0.3.0 from Obtainium) and try *Add footage* and sharing
  clips to a video.
- Phase 12 step 3: pick the recorded SFX source (licence must allow commercial use).
- Knowledge → References: paste 2–3 shorts I like and write what I like about each (no Claude read since Phase 14).
- Still open from the account review: the personal brand's name; the third clipping page. Read each page's Settings →
  Brand guide once and fix anything off. Mascots (shared/mascots.ts): tell Claude Code each page's (Personal brand: the
  founder, Blox Moments: Blok, Long Story Short: the host).
- Gentle Return is hidden (Phase 14); its Islamic features stay in the code for when it comes back.
- Phase 0 on Meta's site (Instagram API with Unified login), then connect the real accounts.
- Settings → Clip tools → Install in the real app (~3 min, 1.4 GB), then a real campaign source through to Review.
  Listen to the first clips from a source with background music (the music check was only tried on stand-ins).
- Listen to the built-in SFX (86 now; the 55 added on 2026-10-17 were only checked by measurement) and drop any I don't
  like (`server/scripts/make-sfx.py`, `shared/sfx.ts`).
- Settings → Connected sites: sign in to Content Rewards (Whop), Vyro and Instagram; check each says “Signed in”. A Vyro
  campaign: if the read lands on Vyro's catalog, read it again from pasted text (Claude Code). Whop's session cookie is
  a guess (`SITES.whop.sessionCookie`).
- Renders on the home PCs: pull the repo on each PC and run `scripts/setup-worker.sh --server … --code … --with render`.
  Settings → Compute should list *Video renders (HyperFrames)*; then render a video and see the stage say "… on <PC>".
  Measure a 50 s clip there against the laptop (~5 min here). The same for Whisper, Demucs, the matte and the speaker
  scan (`journalctl --user -u content-studio-worker`; the CUDA builds for Pascal are untried).

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
| Effects | Free and local only, rebuilt in code (HyperFrames + FFmpeg): orbit, couch wall, UI world, frame break, digital zoom, phone mockup, checklist, headline wall, zoom-through cut, chart grow, pull-back reveal, green screen, paper cut, doodle boil, vertigo, cover story, glass type; plus paper collage, hand-drawn and film looks. Cut-outs of a person by a local matting model. No paid image/video generation (self-hosted generation came in phase 9). onetake isn't used (non-commercial licence); Clawd is Anthropic's mascot, so the cartoon style uses my own characters |
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

**Step 3 — Compute workers (built; untried on the home PCs).** Done: a worker pairs like the phone (`POST /api/auth/pair` with `worker: true` → a session of kind `worker`, which may only call `/api/worker/*`), long-polls the laptop (`server/src/compute/workers.ts`, in-memory task queue, 90 s lease, a lost task is queued once more then run here), downloads the inputs, runs the tool's command and uploads the outputs (`worker/src/main.ts`, bundled by `worker/build.mjs`); the command line of each tool is defined once in `shared/compute.ts` (`commandFor`), so the laptop's own run and a worker's are the same command and a worker never runs anything the laptop sends as a command (tools: transcribe, separate, matte, speakers, plus a self-test `probe.py`); `runTool` (`server/src/compute/run.ts`) is used by every Whisper, Demucs, matte and speaker-scan call site and falls back to the laptop when no worker has the tool, is online, or its run fails; the scripts use CUDA when it's there (faster-whisper int8, torch, onnxruntime-gpu); Settings → Compute lists workers (online, GPU, tools, current task, matte ms per frame), adds one (pairing code + the command) and runs a test; `scripts/setup-worker.sh` (tools with CUDA builds, the bundle, pairing, a systemd user service). Tried: a worker process on this CPU-only box paired, polled, took a matte test (2 s of video, 11 s) and the laptop took it when the worker was away. Not done: the speed measurements on the two cards against the laptop (needs the PCs), HyperFrames renders and FFmpeg/NVENC encodes on workers, sending only a range of a source, resumable transfers, the moving of heavy jobs when the laptop is the only machine with the file. Original plan: A small worker (Node, systemd service) on each home PC, reached over Tailscale and
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

**Step 5 — Directions and variety (built).** Done: clipping — `studio/clip-looks.ts` gives each made clip one of 5 looks (hook card style, punch-ins, first-cut move), the one the page's last 6 clips used least, noted in the version message (`· look: id`), no model call; personal/business — `pieces.directions`, `shared/direction.ts`, job `direction.pitch` (`studio/directions.ts`, Sonnet, playbook + arsenal + the page's recent picks), `POST /api/pieces/:id/directions[/choose]`, `DirectionPanel` on the package page; picking sends the direction to the video's chat to write the script and build the edit. Not done: the pitch isn't offered automatically when a video is created. Original plan: Personal/business: `direction.pitch` (one Sonnet call with the playbook and the
arsenal) → 2–3 directions on the package; picking one writes the script/edit plan. Clipping: `clip.make` chooses an
edit direction per clip from the arsenal (hook card style, captions, graphics, transitions, effects) and varies it
across the page's recent clips.

**Step 6 — Finder (built; untried with network).** Done: *Find clips* panel on a clipping page's Find (`FinderPanel`), `finder.run` job (`server/src/finder/finder.ts`) that chains campaigns → videos → viral → clips with a progress list, every morning after 7:00 unless switched off; `rankVideos` (views × recency × length, mined videos last; `shared/finder.ts`); channels are remembered (`sourceListings`) and listed again, views/dates/creator kept on `campaign_sources`; the best 2 per campaign start downloading (max 3 in progress); viral moments: `finder/viral.ts` searches YouTube for the creator's short clips (yt-dlp `ytsearch`), takes outliers (≥ 3× median, ≥ 20k views), matches their captions to the source transcript (`matchToSource`, trigram offsets) and stores `viral` hints, run between transcript and scan, whose stretches the scan always includes and the pick reads first; campaign discovery (`finder/discover.ts`): reads `DISCOVER_URL` in the signed-in window with one Haiku call (rate, budget, halal screen), leads with Add (= paste the link) / open on Whop. Not done: TikTok/Instagram searches for viral clips (YouTube only); auto-suggesting niche channels for research; `DISCOVER_URL` is a guess (in *Waiting on me*). Original plan: Campaign discovery (the signed-in window reads Content Rewards' campaign list; rank and screen;
Today/Find shows them to join), creator sources (channels from the brief, yt-dlp listings, ranked), viral-moment
matching (YouTube Shorts / TikTok searches for the creator's clips, outliers by views, their transcript found in the
source), auto research (channels suggested and added), the *Find clips* button with one progress view. Daily.

**Step 7 — Effects library (first set built).** Done: three new motion-graphic templates (Checklist, Bar chart that grows to the numbers, Headline wall; rendered and looked at); a local person matte (`server/scripts/matte.py`, U²-Net human segmentation via onnxruntime, cached per video as a grey mask video, model downloaded by `setup-tools.sh` — people who installed the clip tools earlier run Install again) and two effects built on it, made with FFmpeg into a new video file the edit's clips swap to: *New background* (blur, dim, colour, picture — the green-screen look) and *Glowing outline* (`shared/effects.ts`, `studio/effects.ts`, job `media.effect`, Claude's `apply_effect`; tried on a real portrait, ~0.25 s per frame on this CPU, so a minute of video takes ~4 min until the home workers). The arsenal lists them. Not done (still planned in the arsenal): orbit, frame break, vertigo, cover story / text behind the person (needs the text drawn as its own layer: FFmpeg's drawtext can't read the bundled woff2 fonts), couch wall, UI world, digital zoom, phone mockup, pull-back reveal, paper cut, doodle boil, glass type, collage/hand-drawn/film looks; no editor UI for the matte effects yet (Claude's tool only). Original plan: The effects above as templates/scenes/edit effects with previews in the editor and in
the arsenal; a local person matte (u2net human seg via onnxruntime or HyperFrames' `remove-background`) cached per
clip for frame break, green screen, vertigo, cover story and couch wall.

**Creative range (2026-10-17, built).** Everything the editor and Claude can reach was widened, all as named choices in
the edit (`shared/looks.ts`, `shared/fonts.ts`) that the arsenal lists and `update_edit` documents: 28 transitions
(`server/src/studio/transitions.ts`: dips to black/white, zoom in/out, whips, pushes, drop, spin, 3D flip and cube,
squeeze, stretch, fall away, iris, wipe, diagonal, blinds, shutter, light leak, burn, impact shake, bounce), 20 caption
presets (`studio/captions.ts`: one word, highlight box, marker, reveal, bounce, impact, neon, outline, retro 3D, glitch,
comic, handwritten, editorial, typewriter, minimal, arcade…) and a caption font picker over 13 bundled fonts (10 new,
OFL + Permanent Marker under Apache 2.0), 16 ways for text and images to come in, 8 b-roll layouts (bottom half, side by
side, circle, inside a phone, tilted photo card…), 12 camera moves per clip (push/pull, pans, drift, snap zoom, impact
shake, handheld, dutch tilt, pulse), 16 colour looks for the video or one clip (CSS filters on each picture; a
backdrop-filter layer measured 80 % slower to render, the element filter 33 %), film textures (grain, vignette,
scanlines, light leak, cinema bars, frame; grain and leak cost ~30 % render time each), 29 motion-graphic templates (17
new: versus, timeline, countdown, steps, pros/cons, percent ring, star rating, price drop, comment, notification, search
bar, highlighter, blur reveal, question, definition, news ticker, circle it), 86 built-in sounds (55 new, synthesised,
non-melodic, pitch-checked; `make-sfx.py --new`), 3 more clip looks for made clips (drift, snap zooms, impact), and
scenes that can use far more CSS (gradients, gradient text, masks, blend modes, 3D) and GSAP's plugins (TextPlugin,
count-ups, motion paths, MorphSVG, DrawSVG, Physics2D, CustomWiggle eases, steps/slow eases, stagger from centre/edges).
The chat also loads `embedded-captions`, `talking-head-recut` and `hyperframes-registry` as idea catalogues. All of it
rendered through HyperFrames and looked at (contact sheets of every transition, preset, look, layout and animation).
API version 3 (an older phone app would drop the new fields when saving an edit).

## Phase 9 build plan (2026-10-17)

What I asked for: the option to run on self-hosted models only, for everything Claude does today (chat, editing,
background jobs) plus image and video generation and my own voice, because Claude's weekly usage runs out and videos
still need to go out (5–10 a day; how long each takes doesn't matter).

| Topic | Decision |
|---|---|
| Hardware | The two home PCs: GTX 1070 (8 GB) + 32 GB RAM and GTX 1050 Ti (4 GB) + 16 GB. Pascal cards do half precision ~64× slower, so everything runs on ggml runtimes (llama.cpp/Ollama, stable-diffusion.cpp) with quantized weights and fp32 maths, not PyTorch fp16 |
| Switching | Per task: Claude, local, or auto. Auto = Claude until its weekly (or 5-hour) usage passes a limit I set, or Claude refuses for usage, then local. One *local only* switch overrides everything. Background jobs on local never wait for Claude's window |
| Text + vision model | One Qwen3-VL model in Ollama on the 1070 PC (30B-A3B MoE, partly in RAM; text, images and tool calls), so nothing swaps between calls. Chosen in Settings from what the server has |
| Chat on local | Its own tool loop (Ollama's chat API with tools) over the same studio tools, the skills as a `read_skill` tool, `web_fetch`; no web search. Same rules: never schedules, publishes, approves, rejects or submits |
| Images | FLUX.1-schnell (Apache 2.0, GGUF) in stable-diffusion.cpp, 4 steps; b-roll stills (with a camera move), backgrounds and covers |
| Video | Wan 2.1 T2V 1.3B (Apache 2.0) in stable-diffusion.cpp, 480×832, ~5 s; ~20–60 min a clip on the 1070, so video clips queue and run **overnight** (a window in Settings); the text model is unloaded first |
| Halal | Generated pictures never show people or animals (any living being): the prompt asks for an empty scene (diffusion models read "no people" as people), a negative prompt backs it, and the vision model checks every image (three frames of a video) and a retry with a new seed replaces a failed one. No music, as always |
| Voice | My voice cloned with Chatterbox (MIT), English, from a 10–30 s clean recording set in Settings; it's one more voice next to Kokoro's for voiceovers and format videos. Runs on a worker (CPU fallback on the laptop only if installed there) |
| Licences | Commercial-safe only (Qwen, FLUX.1-schnell, Wan 2.1, Chatterbox, Kokoro) |

**Built (2026-10-17).** Step 1: `shared/ai.ts` (10 tasks, modes, routing settings), `server/src/ai/route.ts`
(`routeFor(task)`: local only → per-task mode → auto: Claude until its weekly usage ≥ the limit (default 90 %), or its
5-hour usage ≥ the limit (background jobs: ≥ 80 % as before), or it refused for usage (`claudeLimitedUntil`, an hour),
and only when the local model answers), `server/src/ai/local.ts` (Ollama's own API: `/api/tags`+`/api/show` for the
models and what they can do, `/api/chat` streamed with `format` = the JSON schema for structured answers, `think:
false`, one fixed context window so the model never reloads, a rough token check before sending). Every
`askStructured` call names its task and goes local or to Claude (a Claude usage refusal on auto is answered locally);
`waitForUsage(task)` never waits when the task is local. Settings → Models (`ModelsSettings.tsx`, `GET/PATCH
/api/ai`). Step 2: `server/src/ai/local-agent.ts`, its own loop over the same studio tools (zod shapes → JSON schema,
arguments checked with zod before the handler runs), `read_skill` (the chat's skills, own files only) and `web_fetch`
(public addresses only); history from the stored messages within ~35 % of the window; old tool results are cut when a
turn fills it; pictures from tools go in as a user turn. The chat picker has *Local*; a Claude chat on auto moves
there with a one-line note saying why. Measured on the stand-in: the instructions + 45 tools are ~64 k characters
(~18 k tokens), so 32 k is the smallest useful window. Step 3: `setup-worker.sh --with llm` installs Ollama in the
worker's folder (no root), runs it as a user service bound to the Tailscale address, pulls the model; the worker
reports `CS_LLM_URL` and the laptop uses the first online worker's server unless an address is set. Step 4: compute
tools `image` and `video` (`WORKER_ONLY`: a job waits for a worker instead of running on the laptop),
`server/scripts/generate.py` → stable-diffusion.cpp (`master-929-3f8527a`, built by the setup script with CUDA for
compute 6.1; prompts through files, sd-cli has no `--prompt=`), job `media.generate` (`studio/generate.ts`): clips wait
for the night window (Settings → Models, default 23:00–07:00), up to 3 tries with new seeds until the vision check
(task `pictures`) finds no person, animal or haram thing, into the piece's files, and with `place` into the edit as
b-roll (a full-screen still drifts in slowly); `generate_media` for Claude, *Generate* on a video's Footage; the arsenal
lists both. Step 5: compute tool `speak` = `tts.py --clone REF` in the worker's own Chatterbox environment (Kokoro
voices in the same job still work, so a dialogue can mix them); *My voice* in every voice picker; Settings → My voice
keeps the recording (`/api/voice`, mono 24 kHz, first 30 s, silence trimmed). Tried: a stand-in Ollama (schema-shaped
JSON, scripted tool calls) for capture → idea card, chat turns with `get_board`/`read_skill`, history, the auto switch
at 95 % weekly usage, an unreachable server; a real worker process with a stand-in sd-cli for a picture into the edit,
3 failed checks → a clear error, a clip waiting 77 min for the window then made (480×832, 5.06 s) and placed; the
cloned voice through the worker with stub models, and a mixed clone + Kokoro job; the Settings cards, the Generate
dialog (desktop and phone width). Not done: covers aren't sent to the platforms as covers (Instagram's `cover_url`);
the pictures go in as b-roll or a background; no web search on the local chat.

## Phase 10 build plan (2026-10-19): hosted generation, so quality isn't capped by the home PCs

Why: the local models (FLUX.1-schnell, Wan 2.1 1.3B at 480p) are the weakest generators there are, and a soft clip
upscaled to 1080×1920 hurts reach. Videos that ship should use better models; the home PCs stay for drafts, the text
model and anything that must stay free. Crayo does have an API (crayo.ai/features/api, bearer key); parked for now at the user's request. (An earlier check wrongly found none.) Its exports come in as ordinary footage meanwhile.

| Topic | Decision |
|---|---|
| Provider | kie.ai (one key, one credit wallet, ~$0.005 a credit; Wan 2.5, Kling 3, FLUX 2). Behind a small provider interface (`server/src/ai/hosted/`: `submit`, `poll`, `download`, `price`) so fal.ai or Replicate can be added without touching callers. The key is stored server-side only (never in `publicAccount`-style responses or logs) |
| Text | No hosted text API. Claude stays on the subscription login (the *no Anthropic API key* rule stands) and falls back to the local model as built in phase 9 |
| Where each thing runs | Pictures and clips: *hosted*, *home PC* or *auto* (hosted when a key is set and the cap allows, else the worker), set per kind in Settings → Models. Hosted clips ignore the night window and take minutes, not hours. The edit, render, Whisper, FFmpeg, captions, effects and stock voices stay on the machine running the server |
| Quality | Clips: Wan 2.5 / Kling 3, 720p or better, ~5 s, about $0.30–0.40 each; stills: FLUX 2 1K–2K, ~$0.025. Hosted clips are upscaled to 1080×1920 with FFmpeg when needed |
| Halal | Unchanged and enforced on our side: prompts describe empty scenes (`EMPTY_SCENE`), the negative prompt is sent where the model takes one, and every result is checked (task `pictures`, three frames of a clip) and made again or dropped. Each retry is paid, so retries count against the cap |
| Spend cap | $10 a day (Settings → Models, editable), kept in a ledger table (`ai_spend`: provider, model, kind, credits, dollars, piece, time). A request that would pass the cap waits until tomorrow (job `wait`), or falls back to the home PC when the setting is *auto*. Shown as today's spend on the Models card and on each job |
| Failures | The task id is saved in `jobs` so a restart resumes polling and never pays twice; a refused prompt (provider moderation) counts as a failed try; the result file is downloaded at once because provider links expire |
| Crayo | Has a REST API (api.crayo.ai); parked. Exports go into Footage like any footage meanwhile |
| Voice | Stock Kokoro voices stay free on the laptop. A hosted cloned voice is not planned (open question: only if the Chatterbox result on the home PC isn't good enough) |

Steps: (1) `shared/ai.ts` + settings: generation backend per kind, hosted settings, cap; (2) kie.ai client + provider
interface + ledger, tried against a stand-in at `CS_HOSTED_API` (like `CS_PLATFORM_API`); (3) `studio/generate.ts`
takes the backend: hosted path skips `WORKER_ONLY` and the window, same check and retries, same placement;
(4) Settings → Models card: key (write-only), backend per kind, cap, spend today; Generate dialog shows the
estimated price; (5) docs (CLAUDE.md rule on the hosted key and the cap), typecheck, commit, push.

Waiting on me: a kie.ai key (80 free credits to test), the real prices from its dashboard (the figures above come from
search results and its marketing pages), and which Wan/Kling model names its API exposes today.

**Built (2026-10-19):** steps 1–5 except resume-after-restart. `shared/hosted.ts`; `server/src/ai/hosted/` (kie.ts client,
ledger.ts, `ai_spend` table); `studio/generate.ts` picks hosted or home per try (`backendFor`), checks every result, and
scales to 1080×1920 with the sound stripped; Settings → Models → Hosted generation; Generate dialog shows the price.
Tried against a stand-in (`CS_HOSTED_API`): create, poll, download, resize, cap, bad key. Not tried against kie.ai itself:
the model ids, input fields and credit prices are from its public docs/price list and are editable in Settings. A restart
mid-task loses that task (its spend is already counted): task ids are in `ai_spend`, not yet resumed.

## Phase 11 (2026-10-21): Ideas canvas and save-from-anywhere

Why: brainstorming for the personal brand had nowhere to go but the Videos board (one title per card). Ideas comes
before the board: write freely, at any depth, and lock an idea in as a video when it's ready.

| Topic | Decision |
|---|---|
| Shape | An auto-laid mind map per personal/business page (`ideas` table, a tree; layout in `web/src/components/ideas/layout.ts`): nothing is placed by hand. Tab = sub-idea, Enter = next idea, typing edits, drag onto a card = move under it (between two = reorder), Alt+arrows move with the keyboard, Delete with undo |
| Clutter | Three levels show under the card being looked at; deeper ones, collapsed cards and lists past 12 fold into a count. Double-click (or Shift+Enter) opens any card as its own canvas with a breadcrumb |
| Writing | Click a card: a side panel (full screen on the phone) with notes, a script draft (any time), labels (colour from the name, nothing to manage) and Claude's buttons |
| Series | A card kind: premise, format/hook style, numbered episodes (its idea children). Board cards and the video page show "Series · Ep n"; scheduling an episode before the previous one warns |
| Claude | Only on my click: Expand, Angles, Episodes (series), Challenge, results in the panel to add as sub-ideas or notes (task `ideas`, one call each). Locking in creates the video (Idea, or Script when drafted) with my notes, sub-ideas and inspirations, then Claude adds hooks, angle and outline as a new version (`ideas.flesh`). The chat gets `get_ideas` and `add_ideas` (adds only) |
| Saved | Each page has a Saved pile (newest first, "n new"). Posts are kept as research items (source `saved`): details fetched with no Claude (`ideas.details`: TikTok's embed page, else yt-dlp; thumbnail; × the account's usual; words from captions or Whisper); *Break it down* is Research's analysis on my click. Drag a saved post onto an idea = inspired by |
| Share | Android: a second share target, **Save to Ideas** (`ShareActivity`, no screen): links, text and screenshots go to the last personal/business page opened, queued like uploads (the phone picks the card id, so retries and a later note join the same card); a notification has *Add a note* (typed in it) and *Change page*. Footage still goes through the app's share screen. The PWA share target saves text and links the same way |
| Phone | The same cards as a nested list: tap to open, swipe for sub-idea/delete, a quick-add box; Ideas is in the bottom bar |
| Research | The old "Ideas" tab is *Research*; its brief ideas and outliers save to the Saved pile |

**Built (2026-10-21):** all of the above. Tried against a test server: cards, ordering, moves, delete/undo, page moves,
pictures, board import, saved TikTok and YouTube posts (details, thumbnails, × usual for YouTube), lock-in with a real
flesh-out, a real Episodes call, the chat tools, and the canvas, panel and phone list in headless Chrome. Not tried:
the Android parts (no SDK here: CI builds them), Instagram saves, Whisper on saved TikToks (the test had no Whisper).
Also fixed: thumbnails of still JPEGs (FFmpeg skipped their one frame when asked to seek).

## Phase 12 (2026-10-27): videos that go viral, a knowledge base I can edit, a toolbox

Why: the app makes videos, but not ones that go viral consistently. Weak spots: the hook, graphics and pictures,
animation, no enforced content model (hook → content → payoff), sound design, no quality bar, UGC. References:
damianodesu's reels (Claude + HyperFrames motion; 240 recorded SFX, each on the exact frame of its motion),
palmier.io's launch video, motionloved, pavelfucksu's 3D breakdown; yihui-dev/awesome-opus5-5-videos (703
single-HTML motion prompts: GSAP, Three.js, WebGL, Canvas; MIT); charlesdove977/UGC-Factory (beat sheet hook →
problem → reveal → demo → CTA, 15 genre styles; its AI personas break the no-people rule, so only the structure is
reused).

| Topic | Decision |
|---|---|
| Pages | Personal brand (Muslim entrepreneurship, lifestyle) and a new Islamic page; posting starts later. Vetto dropped. Clipping paused: its videos, sources, moments, renders and campaigns deleted, the cache cleared, the empty page kept |
| First focus | Faceless motion explainers: designed animation, kinetic type, graphics and 3D, frame-synced SFX, voiceover |
| Content model | Every video has a hook (a promise in the first 1–3 s: picture, words, on-screen text), content that builds toward it, and a payoff (what the viewer waited for) near the end. The plan names the promise and where it's paid; checked before render. Clips follow it too when clipping resumes |
| Quality score | Before render each edit gets a score with reasons and fixes: hook, promise → payoff, pacing, motion density, SFX coverage, captions, first frame; measured where it can be, judged against the knowledge base. Below the bar Claude fixes it first. (Not colour grading) |
| Knowledge | A Knowledge page: the playbook as rules I can read, edit and add to (seeded from `.claude/skills/playbook`), a reference library (paste a link → downloaded and measured: hook, beats, cuts per second, motion, SFX timing; Claude drafts the lessons, I approve them) and lessons from my own results once posting. Every video's prompts use it. No fine-tuning |
| Toolbox | A page listing skills, MCP servers, models, binaries and libraries: installed, version, licence, source, how often each was used. A weekly scout finds new repos, skills, MCPs and models and lists them with licence, what they'd add and risks (music advice, paid services); installing is my click |
| Character | One recurring 2D outline mascot per page (each page its own), Dani-style (simple body, blank or dot face): a vector rig (poses, gestures, walk, point, react) animated in the edit. Drawn, not generated, so the no-people rule for generated pictures stands |
| Sound | A real recorded SFX library (non-melodic, screened, licence noted), placed on the frame of every motion event |
| Motion | A scene library drawn from the awesome-opus5-5-videos prompts, ported to seek-safe HyperFrames scenes |
| Budget | kie.ai cap unchanged ($10 a day) |

Steps: to be detailed when building. Rough order: (0) clipping cleanup and Vetto removal; (1) Knowledge page, content
model and quality score; (2) Toolbox and the weekly scout; (3) SFX library and frame-synced placement; (4) motion scene
library; (5) mascot rig; (6) the Islamic page; (7) reference measuring.

- [x] Step 0 — Clipping cleanup and Vetto removal (run 2026-10-30, script deleted). Data only, no code. A script (backs the database up to
  `backups/2026-10-27-before-clipping-cleanup.sqlite` first) deletes the Clipping page's videos, files, renders and every
  campaign (sources, moments), finished jobs, the finder's state, the HyperFrames frame cache and source downloads, and
  the Vetto page; the empty Clipping page stays. Auto mode wouldn't run the deletes: on me (see *Waiting on me*).
- [x] Step 1 — Knowledge, content model, quality score (2026-10-27):
  - **Knowledge** (`knowledge` table; a rule = topic, title, body, source, on/off; `workspaceId` null = every page).
    Seeded from the playbook's references, one rule per `##` section, plus a new `content-model.md`; an app update
    refreshes seeded rules I haven't changed and never touches the ones I have. Seeded halal rules can't be changed or
    turned off (I can add more). `playbook(...)` reads the live rules, so every background prompt uses my edits; the
    chat gets `get_knowledge` and `suggest_rule` (lands as *Suggested*, approving is my click). Page: `/knowledge`
    (sidebar; phone: More), topics down the side, rules as cards edited in place, search, Suggested on top.
  - **Content model**: an edit has a `story` (the promise, the payoff, the second it's paid). Directions pitch both;
    Claude fills them when it builds an edit; the editor shows them over the timeline (*Paid here* from the playhead).
  - **Quality score** (`edit_versions.quality`, task `quality`): hook, promise → payoff, pacing, motion, SFX coverage,
    captions, first frame, each 0–10 with what was measured, why and the fix. Measured from the edit (first words and
    text in the first 3 s, longest stretch with nothing changing on screen, events per 10 s, motion events with a
    sound on their frame, caption coverage of speech, what's on screen at 0 s); the hook and the payoff are judged by
    one call against the knowledge rules. Bar 70/100. Render = check first: below the bar Claude fixes it in the
    video's own chat (one round), it's checked again, then it renders whatever the score. *Check* on its own;
    *Render without the check* in the render menu. Claude's `render_edit` runs the check and hands it the fixes
    first. Clip renders skip it while clipping is paused.
  - Tried on a test server: seeding (65 rules), edits, the halal lock, delete/undo, an update of the playbook (untouched
    rules follow it, mine stay, dropped sections go), *Back to the playbook*, `playbook()` with my edits; a real check
    (71/100 in 9 s) and a real render with the check: 40/100 → Claude fixed it in the video's chat (v5) → 80/100 →
    rendered. Knowledge page and the editor's Quality tab looked at in headless Chrome, desktop and phone width. Not
    tried: `get_knowledge`/`suggest_rule` and `render_edit`'s gate from a real chat.
- [x] Step 2 — Toolbox and the weekly scout (2026-10-27):
  - **Toolbox page** (`/toolbox`, sidebar; phone: More): *Installed* lists skills (version and licence from SKILL.md or
    the source repo, source from `skills-lock.json`, whether the chat loads it), the studio's tools (the in-app MCP
    server and the web), models (Claude on the Pro login, the local model, Whisper, Kokoro, FLUX/Wan/Chatterbox on the
    workers, kie.ai), programs (ffmpeg, yt-dlp, Python, Tailscale, the renderer's Chrome, the Python environments'
    packages) and libraries (the app's packages; `libraries.json` is written when it's packaged). Each with what it
    does, version, licence, where it runs, *Not set up* (and how) and how often it was used (`tool_uses`: chat tool
    calls, skills opened, every background prompt on the playbook, every Claude/local model call, kie.ai from
    `ai_spend`; counted from now on).
  - **Weekly scout** (job `toolbox.scout`, task `scout`, Haiku; once a week after 7:00, or *Scout now*): GitHub's
    search (names, descriptions, topics: skills, HyperFrames, MCP servers, motion, GSAP, sound effects, short-form,
    faceless video; changed since the last find, made in the last 18 months) and Hugging Face's trending video, picture
    and speech models, no keys. New ones (not installed, not seen before) go to one call that scores each 0–10 for these
    videos (knowing the halal rules, the home PCs' GPUs and the next steps of this phase) with what it'd add and its
    risks; the licence is checked without the model. 5+ show under *Finds* (skill repos get their `npx skills add`
    command); *Want it* / *Not for me*. Installing stays my click, outside the app. It also refreshes the installed
    skills' repos (licence, stars).
  - Tried on a test server: the inventory (36 skills, 41 studio tools, 11 models, 11 programs, 36 libraries; versions,
    licences, *Not set up*), counting (skills, tools, web, models), three real scout runs (GitHub + Hugging Face, one
    Haiku call, ~2 min; the first queries matched READMEs and found only big lists, so names/descriptions/topics only
    now, and GitHub's 403s wait and retry): 40 judged, 6 shown (herk-edit-kit, anything2explainer, motionmaxxing,
    claude-video-vision, lemo-opuscar, MOSS-TTS). Page looked at in headless Chrome, desktop and phone width. Not tried:
    the packaged app's `libraries.json`/`skills-lock.json` (next `npm run install-app`).
  - **Installing from the app** (2026-10-31; running the command left the app none the wiser, and which place to pick
    wasn't clear): *Install* on a skill find (or *Install a skill* with a GitHub link) shows the repo's skills (size,
    files left out, *Runs commands*, where each is already) and two places: **Content Studio** (`<data>/skills-added`,
    the `studio-added` plugin, every skill in the chat from the next message, kept across updates) and **Claude Code**
    (`~/.claude/skills`, every project; the skills CLI's `~/.agents/.skill-lock.json` gets the entry so `npx skills
    update -g` still works). Recommended: know-how → Content Studio, a skill with scripts → Claude Code. Files come
    straight from GitHub (tree API + raw files; no npx, which the launcher's PATH lacks), with progress; sound and
    video files are never copied (music), built-in names are left alone. *Installed* groups skills by place, with
    *Remove* and *Use in Content Studio too* (for a Claude Code skill). Finds whose repo is installed anywhere move to
    an *Installed* filter. The scout shows what it's doing; *Stop* drops a run, *Finish now* judges what it found so
    far, and a run waiting on Claude's usage says so, with *Run now*. Tried on a test server with a GitHub stand-in
    (install both places, remove, copy, find matching, the SDK loading `studio-added:*`, the Read hook, stop/finish/
    run now) and in headless Chrome, desktop and phone width. Not tried: a real GitHub install, the packaged app.
- [ ] Step 3 — SFX library and frame-synced placement. Placement done (2026-10-27), the recorded library waits on
  my pick of a source:
  - **Sound on every move** (`audio.autoSfx`, on by default, editor → Sound; Claude's `update_edit` can turn it off for
    a serious or religious video): `shared/sound-design.ts` reads every move of the edit and puts a built-in sound on
    its frame unless one is there: scene tweens (spring in → pop, slide or fly → swish/whoosh, slam from big or a big
    word → hit, turn → whip, a line drawing → scribble, letters → typing, a few words or items → a tick each), text
    and picture entrances (fades stay silent), snap zooms and impact shakes. Two moves on one frame get one sound (the
    stronger), each kind takes turns between its sounds, quiet (0.3–0.55). Worked out at compose and render like the
    graphics' and transitions' own sounds, so timings follow every change; the timeline shows them as hollow dots. The
    quality score counts scene moves and snaps as motion events now. The playbook's sound reference has a *Motion
    videos* section (talking-head clips stay sparse).
  - Tried: a test render (voice off) with a punch, a zoom title and a scene of 5 tweens: the sounds start at 3.00,
    3.25, 3.50, 3.75, 4.50, 5.97, 7.53 and 9.09 s, each on its planned frame. Sound tab looked at in headless Chrome,
    desktop and phone width. Not heard by ear yet.
  - Left: the recorded library (real SFX, screened as non-melodic, licence noted, tagged by kind) joining the pools.
- [x] Step 4 — Motion scene library (2026-10-27): 19 ready-made scenes (`shared/scene-library.ts`), each a technique
  from the awesome-opus5-5-videos prompts redone as scene data (plain elements and GSAP tweens with explicit start
  states, nothing random, so every frame seeks): *Kinetic lines* (a speech staged in type, stacking onto a floor),
  *Shape morph* (one shape: button → loader → tick → result card), *Cursor click*, *Phone island*, *Growth line* (a
  chart that draws itself with a dot on its tip), *Orbit*, *Flow*, *Card deck*, *Rolling number*, *Iris reveal*,
  *Before / after wipe*, *Fly through*, *Shards*, *Shine title*, *Burst*, *Word rows*, *Terminal*, *Route*, *Time
  passing*. A library scene keeps its preset and words (`preset`, `fill`) and is built again whenever the edit changes
  (`normalizeEdit` → `fitLibraryScenes`; the editor does the same as I type): its length (shorter than it wants, it
  plays faster), the frame (9:16, 4:5, 1:1) and the accent colour. Rewriting one with `write_scene` makes it custom.
  - Claude: `add_library_scene` (preset, words, start, optional end/background; changes one with its sceneId),
    `get_arsenal` kind `scene` lists each with when it fits and its words, the chat prompt looks there before
    `write_scene`; `get_edit` shows library scenes as their words, not their design. Editor: Overlays → *Scene* menu, the
    scene's words and *Behind it* (the video, darkened, plain dark) in its panel.
  - Sound: a tween can name its sound (`sound`: a kind or `none`; Claude's `write_scene` too). Steady motion (ease
    `none`: spins, drifts, scrolls) makes no sound; a shape changing size by 150 px or more gets a swish.
  - Fixed on the way: scenes tweened a line's dash offset as CSS, which GSAP rounds to whole pixels, so every drawn
    line (Claude's scenes too) stayed hidden and snapped on halfway; it's tweened as the SVG attribute now, like the
    graphics.
  - Tried: every scene built with its example words (no dropped styles), stills of each rendered over test footage in
    9:16 and seven in 1:1 and looked at (fixed: clipped serif lines, a lost space beside accent words, a seam in *Fly
    through*); the sounds each gets listed; `add_library_scene` called directly (missing words refused, add, change,
    faster when shorter, rebuilt for 1:1 on save, `get_edit`); the editor's *Scene* menu and fields in headless Chrome,
    desktop and phone width. Not tried: `add_library_scene` from a real chat; not heard by ear.

- [x] Step 5 — Mascot rig (2026-10-30): the four approved mascots (`shared/mascots.ts`: the founder, the Traveller,
  Blok, the host) ported from the brand drafts onto a jointed rig: each limb is two segments in nested SVG groups
  that turn at the shoulder and elbow (hip and knee), so a pose is a few angles. Poses: idle, point, think, cheer,
  shock, du'a, lantern, at the mic, and three that loop while held (walk, wave, talk; a talking face opens and shuts
  its mouth). Each mascot has the poses that suit it (the Traveller never cheers or shocks; only the host has the mic);
  others are drawn standing. Faces switch with the pose (Blok, the host).
  - Pages: `workspaces.mascot` (migration 0020), picked on Brand (top: the four, *No mascot*, the chosen one's poses).
    The chat prompt names the page's mascot and its poses.
  - Scenes: an element of kind `mascot` (the page's, or one named; start pose; `flip`) and a tween `to: { pose }`
    that turns every joint into the next pose over its duration and ease (`server/src/studio/scene.ts`
    `mascotTweens`: fromTo attribute tweens with explicit start values, parts switched halfway, loops as finite
    yoyo repeats, so any frame seeks). x/y/scale tweens move the whole mascot. Cheer and shock get a quiet pop;
    other pose changes are silent. `write_scene` documents all of it.
  - Library: *Mascot explains* (walks in, points at a card with the line), *Mascot says* (pops up talking under a
    speech bubble, words in turn) and *Mascot reacts* (a white-outlined sticker bottom left, the reaction picked by
    `sub`, a word tag above it).
  - Fixed on the way: overlay stills (`view_overlay`) had nothing to show when no footage sat under the overlay (a
    video made of scenes): they get a black frame now.
  - Tried on a test copy of my data: every pose of every mascot drawn; a scene per mascot (walk in, point, cheer or
    du'a or mic, talk) and the three presets on each page rendered through the real overlay stills (HyperFrames);
    the timeline seeked in headless Chrome (each joint lands on its pose); Brand → Mascot at desktop and phone width,
    picking one and *No mascot* saved. Not tried: Claude writing a mascot scene from a real chat; a full render with
    sound.
- [x] Step 6 — The Islamic page (2026-10-30):
  - **Kind** *Islamic page* (`islamic`: ideas, clipping, research; stages Idea → Script → Record → Edit → Clips making
    → Review → Ready). Claude's rules for it: only the Quran, sahih hadith and known scholars, cited on screen and in
    the caption; ayat read with `get_quran` and shown with the ayah scene; no fatwas or contested fiqh; no prophet,
    companion or named person shown; the creator's own voice only (`write_format_video` and computer-voice
    voiceovers refused there); calm look.
  - **Arabic**: Noto Naskh Arabic bundled (Fontsource, OFL; Arabic, Latin, Latin Extended), next in every font stack
    so Arabic letters never fall back to a system font. Scenes may set `direction`.
  - **The Quran text** (`server/src/islamic/quran.ts`): Tanzil's Simple text with its marks and the Saheeh
    International translation, downloaded once into `quran/` in the data folder with their notices, checked complete
    (6,236 ayat, 114 surahs). `lookupAyat("94:5-6")`: verbatim Arabic (the basmala taken off a first ayah, ayah
    numbers in end marks when there are several), meaning, citation (`Ash-Sharh 94:5–6`); at most 6 ayat and 600
    characters a card. `GET /api/quran?ref=`, Claude's `get_quran`.
  - **Scenes**: *Ayah* (deep green, the Arabic in a gold arch that draws itself, stars, the meaning in Playfair italic,
    the reference in gold capitals; only the reference is given, the rest is filled from the Quran text, Claude can't
    pass Arabic), *Hadith* (navy, a fine gold frame, who said it, the words in turn, collection and number; Arabic only
    if I paste it) and *Speaker* (a name tag at the top, held for a whole clip, up to 180 s). Ayah and hadith hide
    the captions while they're on (no meaning twice). The editor looks an ayah up as I type its reference.
  - **My voice**: the editor's Sound → *Your voice*: record, upload or pick a recording of the script; it's kept with
    the video (`POST /api/pieces/:id/recording`, never an idea card) and becomes the voiceover, its words captioned.
    Claude sees the video's recordings in `get_edit` and can set one as the voiceover. Browser recordings (WebM with
    no length in the header) get their length by decoding.
  - **Lecture clips** (`server/src/islamic/lectures.ts`): the page's *Lectures* opens its own campaign (origin
    business, made and read the first time, waits for my OK) with the lecture rules as its brief; the clipping
    pipeline does the rest (download, transcript, moments, music removed, Review). A pasted video downloads by itself
    only under Creative Commons (yt-dlp's licence line); otherwise it waits as *not downloaded* with a note until I
    click *Get*. Every clip gets the speaker tag (the channel's name, the lecture's title) after its hook card.
  - Fixed on the way: scene text was cut at 300 characters (a long ayah lost its end).
  - Tried on a test copy: lookups (94:5-6, 2:255, 112:1-4, first ayat, too long, too many, out of range), stills of
    every new scene through the real overlay render (short and long ayat, hadith, speaker held 45 s), the probe on a
    header-less WebM, the licence gate on a real standard and a real Creative Commons lecture, the lecture campaign
    made once. Not tried: a lecture through to a clip in Review; Claude's `get_quran` and ayah scene from a real
    chat; the editor's *Your voice* and ayah look-up clicked in a browser (built, typechecked); recording on the phone
    app; a full render with a recorded voiceover.

- [x] Step 7 — Reference measuring (2026-10-27): Knowledge → *References*. I paste a link (YouTube, TikTok, Instagram;
  for every page or one), job `reference.measure` downloads it (yt-dlp, the research downloader) and measures it with
  no model (`server/src/knowledge/measure.ts`): hard cuts (FFmpeg scene detection), every change on screen (a cut, or the
  picture starting to move or moving much more than just before, from the frame-to-frame difference of a small grey
  copy at 30 fps, judged against the video's own usual level so a talking head's small moves don't count), the longest
  still stretch, how much of it moves, the sound-effect hits (the sound jumping 10 dB in 150 ms, found in what isn't
  voice: Demucs splits it when something is said; without the clip tools only the pauses count), music's beat (8+ hits
  on a steady grid are music, taken out of the hits and flagged), a bed under the voice, sounds on the changes (−0.12 to
  +0.25 s, as the quality score counts), words a second, the first word, the first 3 s. Then job `reference.lessons`
  (task `lessons`, one call with the numbers, every 2 s, what's said, the first frame and a 12-frame contact sheet,
  against the live Knowledge rules) writes its read (hook, promise → payoff and its second, the beats, motion, sound,
  cautions) and up to 4 lessons, which land as Suggested rules (`knowledge.referenceId`, source *From a reference*):
  approving is my click. The card shows the numbers beside my own latest edits' (same measures from the edits:
  changes per 10 s, longest still, sound on moves, first word), a strip (motion, changes, cuts, sounds, the payoff),
  the read, the frames, the lessons and what's said; *Read it again*, *Try again*, *Delete* (approved lessons stay as
  rules). Suggested rules link back to their reference. The chat gets `get_references` (for "make it like that one").
  - Calibrated on three real videos (a 13 s sound-design explainer, a 63 s 2D explainer, a 50 s talking head with jump
    cuts): cuts found on every jump cut, the hits checked on a waveform and spectrogram (the whooshes land where the
    hits are), a music beat every 0.53 s caught and taken out, music beds flagged. Demucs takes ~1.2× the video's length
    on this CPU. Tried on a test server: a real paste through measure and read (one Claude call; the first try returned
    no JSON, the retry worked: the read was grounded in the numbers, 2 good lessons), a dead link (error, *Try again*),
    the same link twice (not measured again), approve, delete, `get_references` called directly; the page in headless
    Chrome at desktop and phone width (fixed: a badge too wide for a phone, the payoff label off the strip's edge).
    Not tried: a TikTok or Instagram link; the chat calling `get_references`.
  - Not done: the quality score doesn't use the references' numbers as its targets yet (they're beside my numbers on
    the card); *Measure as a reference* from Research or a saved post on Ideas.
  - **Reworked as inspiration (2026-11-02).** The reads graded my references against the playbook ("weak by the
    rules") and drafted small rules that missed why the videos moved me. Now Knowledge opens on *Inspiration*, page by
    page: each video is read for how it's built (why it works, its shape over time) and split into 6–10 ingredients
    (idea, story, visuals, quality, voice, text, pace, sound, feel), each one I mark *Want* or *Not for me*, with a
    note, and a "what moved me" note per video. The page's **style** (`page_styles`, job `inspiration.build`, my click
    *Write it from my marks*) is written from those marks (my notes count most, *not for me* goes under "Leave out",
    the brand guide wins where they differ); I can edit it, and it says when my marks changed since. Every prompt that
    makes something for the page carries it (`inspirationText`: the chat, directions, idea capture, script drafting,
    the research brief, UGC); `get_references` gives the chat the ingredients and marks. No more lessons drafted from
    references (the 17 waiting were deleted); the rules are the *Playbook* tab. Voice-only beds aren't cautioned
    (`voiceBed`: the voice track sounding in the pauses); a transcript in the wrong language is heard again as English
    (`transcribe.py --language`). The 6 Gentle Return references were read again; the style waits for my marks.
- **Clean cuts (2026-11-02, from my review of the 6 clips).** Cuts were placed on Whisper's word times with fixed
  padding, so a clip could start on an "um" Whisper never wrote down (the $60B one, 2 s) or end on the first sound of
  the next sentence. `studio/clean-cuts.ts`: the voice's loudness every 10 ms; word times fitted to it (a pause inside
  a word's times means the sound before it isn't that word); every cut moved into the pause beside it (a soft pause
  in a noisy track); a short cut with no clean pause keeps the words instead; a shot without a whole word is dropped.
  The render fades the sound 12 ms at every cut and 120 ms at the end. Used by the clip maker and the editor's
  *Tighten*. **Whole picture** (`EditClip.fit: 'whole'`): a game or a screen shows all of itself, as wide as the
  frame, over a blurred copy (baked by FFmpeg in the render, CSS in the preview), the hook card above and the
  captions below; the clip maker picks it for games (campaign or page) and for wide footage with a face under a third
  of the time; editor switch *Show the whole picture*; Claude's clips take `fit`. Text overlays can sit at their own
  height (`y`), e.g. a hook under a watermark.
  Not done: in fast talk over game sound Whisper's word times are up to 0.3 s off, so a few cuts still need picking
  by hand on the loudness (the Clash Royale clip did); a forced aligner (WhisperX-style) would fix it for good.
- **Hooks, order, who's talking (2026-11-03, my second review).** The whole-picture Roblox clips lost their hook
  (the picture was a small strip) and jumped around the video. Now a whole-picture clip opens full screen until its
  first scene cut 1.2–4.5 s in (`clipping/framing.ts` `fillHook`), then shows whole. A creator's edited video is
  clipped in its own order with its intro kept whole, cutting only blanks, setup, plugs and filler (playbook
  `clipping.md`). **Who's this** (graphic `who`): a drawn arrow from a name card to the speaker. The pick names who
  mainly talks (`moments.speaker`: name, who they are, `known`), and the clip maker adds the arrow where a guest
  most viewers wouldn't know first shows (`whoTag`: the person talking in at least 65 % of the on-screen talk,
  matched across shots by where the camera has them; otherwise none, so a host is never named as the guest).
- **Comments on a video (2026-11-03).** I go over a finished video on its page and pin comments to a moment or a
  stretch (pause and type, or C; play on and "to 0:15" makes it a stretch). They stay (`video_notes`), show as marks
  on a strip under the player and in a list beside it, with Claude's answer under each. Claude reads them with the
  words, clip and overlays at each spot: in the app's chat (`get_notes`, `resolve_note`, *Fix with Claude*) or in
  Claude Code (`npm run notes`, `npm run notes -- fix <id> "…"`). Claude marks one *fixed*; I close it or reopen it.
- **Notes (2026-11-03).** Personal and business pages get a Notes page beside Ideas: free writing, no cards (the
  canvas is Ideas). A list of notes, first line the title, each saved as I type (`notebook`); deleted ones come back
  with Undo for a month, blank ones go. Ctrl K finds them. Claude only reads them (`get_notebook`, *Ask Claude*) and
  turns one into idea cards when I ask; it never changes a note.
- **Watched or not (2026-11-03).** Every video with a finished render shows where I am with it (`shared/review.ts`):
  *To watch* (never commented on), *To improve* (open comments), *Check again* (comments fixed or closed, or a new
  render since), *Looks good* (my click under the player, on that exact render; it closes Claude's fixes; a newer
  render asks again). A clip's yes in Review counts as watched. Cards carry the label, the board's chips show only
  those videos, and Claude's `get_board` sees it. Videos already out with nothing said aren't asked about.
- **Lessons from my comments, renders on the home PCs (2026-11-03).** I said "train you": every comment now also
  teaches a lesson, so no later video makes that mistake. A lesson is a Knowledge rule (source *From my comments*,
  active at once, `knowledge/lessons.ts`), linked to the comments that taught it; a comment that repeats one joins it
  (*You said it 6 times*). Fixing a comment needs one (`resolve_note` `lesson`/`lessonId`/`oneOff`; `npm run notes --
  fix … --new|--lesson|--one-off`). Every prompt that picks, makes or judges a video lists them (clip picking, the
  chat, directions, UGC, idea scripts), and the check before a render tests each one: a broken lesson sends the edit
  back to Claude even above the bar. Clips now get that check too (lessons only: their motion and SFX scores are for
  motion videos). Knowledge → Playbook → *From my comments* lists them. Seeded from my 31 open comments (11 lessons:
  endings ×6, one visual hook in the first seconds ×6, the frame stays on the speaker ×4, cuts between thoughts,
  no repeats, story steps, one-colour text, show what's said, no flash frames, open on a sentence start).
  What the comments showed the pipeline doing wrong, now fixed in code: clips cut 6 s before and 16 s after the pick
  and moved onto whole sentences (`clipping/bounds.ts`: back to where the first sentence starts, on to where the last
  one ends, or back to the last finished one within the campaign's cap); the hook card hides the captions while it's on
  (`hidesCaptions`, editor: *Captions wait while it's on*) and the *Who's this* arrow waits for the second shot; hook
  and title text is one colour, emphasis by weight (titles) or size (word slam); the halal frame check looks at one
  frame per shot (up to 12) instead of three; framing stays on the person the camera is on unless someone else clearly
  talks 2.5 s (a face in the source's picture-in-picture took the frame before) and the speaker scan reports how far a
  face moves in a shot (`x0`/`x1`), so a leaning speaker is framed on all of it without a punch-in.
  **Renders on the home PCs**: tool `render` (`setup-worker.sh --with render`: the laptop's exact HyperFrames and
  Chrome's headless shell, bundled `worker/src/render.ts`). The laptop still cuts and grades the footage, then sends
  the project as one tar; the PC draws, encodes and sends the video back. One render per PC at a time (two PCs, two at
  once); none online or a failed run, the laptop renders. Cancel stops the PC's run at its next heartbeat. Tried with a
  worker process on this laptop against a test server: a render there (6 s in 18 s), a cancel mid-capture, the
  fallback when the worker went away; the Knowledge page at desktop and phone width. Not tried: the real PCs (not paired
  yet), a real quality check with lessons (no Claude call spent), a clip made with the new bounds. Still open: a
  source's own layout animating (a picture-in-picture sliding in) drags the speaker off a static crop between scan
  samples: framing that follows within a shot needs keyframed crops.
- **My 31 comments fixed, and what they showed the pipeline still did wrong (2026-11-03).** The seven clips the app
  made from the Iced Coffee Hour × Bloom source were cut again on their own cards (`clipping/recut.ts`: the moment's
  new start and end, made the whole way again, comments and versions kept; chat `get_clip_source`/`recut_clip`,
  terminal `npm run notes -- source|recut`), each on where its story starts and ends; the four the terminal maker
  built were fixed by hand or cut again from new segment lists. Fixed in code so the next clip can't do it: a question
  the speaker starts at the end ("Do you guys feel…") is cut before rather than finished, and a lead-in "And/So" isn't
  pulled in at the start (`bounds.ts`); the speaker scan gives each face its own track (two hosts side by side shared
  one, so their mouths compared to each other looked like talking and took the frame) and finds a cut's exact frame;
  the framing of one shot never carries into the next (a quarter second of the next shot kept the last crop and
  showed the can on the table), and a sliver of another shot at a clip's edge is trimmed when nothing is said in it;
  jump cuts read as cuts (`smoothJumps`: a 0.07 s skip on the same framing becomes no cut, two zooms within 6 % get a
  clear 12 % punch); another brand's logo burned into the source (Model ML and Flex on 20VC) is found by the frame
  check and framed out (`cropBurnedIn`); a cut Claude makes by hand never lands inside a word (`wholeWordCuts`), and
  the fix after the lessons check is checked again before the render (it used to be dropped by Review's re-render).
  What watching the remakes taught on top: the in-app fix after the check sometimes made things worse (cut the setup,
  ended on "…gathering. And", cut through "hours"), so a clip never renders ending on and/but/so (`trimDanglingEnd`,
  "looks like." is fine), a hook card Claude adds hides the captions by default and `update_edit` can set it, the
  judge is told when the captions are hidden (it kept flagging them), the clip's padding never runs into the next
  word ("…family. Like"), and the halal frame check judges each frame as the vertical clip shows it (the bank clip
  was dropped for product footage in the right half of a split screen its crop never shows). Not fixed: Whisper on a
  whole cut sometimes merges a stutter ("is, is, is, is" became one "is"), so tightening keeps it; Whisper on the
  finished render hears it, which is how I check every render by ear now.

Accounts (2026-10-27): each page gets its own mascot (not one shared). Once every buildable step is done, I go over
each account with Claude (name, goal, niche, language, the mascot's look): steps 5 and 6 are built after that.

Open: which SFX source (licence); the personal brand's name; the third clipping page.

## Phase 13 (2026-11-04): frame-exact cuts

Why: my renders "glitch when switching clips" (13 comments on three clips: "bad cut", "weird cut", "bad frame",
"again"). Every one, looked at frame by frame, came from where the cuts landed, not the renderer. Where the framing
follows the source's camera change, 1–3 frames of the new camera still wore the old crop (a chair, a mic, a hedge
flashed past): the speaker scan put camera changes 1–3 frames late (it looked every 4th frame). It also merged a real
0.57 s reaction shot away (17 frames on the guest's crop). Cuts weren't on frame boundaries, so `cutSegment -ss 4.280`
started a segment 1/30 s late and its first frame showed twice. A cut a few frames before a camera change took the
next shot's framing early (up to 0.36 s of it). One clip ran 1.2 s into a wide shot on the guest's crop (Bloom v7,
0:24). Bloom's 0:15 "bad cut" was the snap zoom turning about the middle of the frame: it pushed his head out the top.

Decision (2026-11-04): no outside editor. The goal is that I never fix a cut by hand, and an editor given the same
cut list shows the same flashes, so the fix is in the pipeline. If a hand editor is ever wanted: Kdenlive (official
Flatpak, never forked), driven by its MLT project file and `melt` (research below).

- [x] Speaker scan v2 (`speakers.py`): camera changes from FFmpeg's scene score on every frame, exact to the frame,
  with a 16 × 9 grid of what changes at each (a box beside the speaker changing vs the whole picture); faces sampled
  at least twice in every shot. Older scans are made again; a home PC with the old script gets the scan redone here.
- [x] Every render plans its cuts exact (`studio/exact-cuts.ts`), without moving the timeline: a framing change a few
  frames off a camera change moves onto it; a clip across a camera change splits where the framing changes; a sliver
  under 0.4 s beside a cut and a camera change goes on the framing of the clip before when almost nothing was cut
  between (that clip going on), else the frame beside it holds over it while the sound plays; a flash under 0.2 s
  inside a clip holds the frame before; a transition's handle never reaches into another shot.
- [x] `cutSegment` exact: in and out on the file's own frames, trimmed by frame count, the first frame at 0 (never
  shown twice); held frames padded after the change to 30 fps. New clips are cut from the source on a source frame.
- [x] Each finished video is checked frame by frame (`checkCuts`): a picture change the plan didn't make, in the
  footage, is a camera change the scan missed: the video is scanned again with it and drawn again (once). Flashes are
  logged. On the three old renders it found the flashes at 9 of the comments and nothing else.
- [x] Zooming camera moves (push-in, pull-out, snap zoom, pulse) turn about the face; jump cuts compare the framing
  either side of the cut with camera moves included. Listener cutaways keep only their longest part on one shot.
- [x] The three videos rendered again and the comments resolved (lesson "No flash frames of another shot").

Research (2026-11-04, not used): no paid editor has been open-sourced (Lightworks promised to in 2010; Resolve is
closed). Kdenlive (GPL, 26.08) is the most complete open editor on Linux: MLT XML project (in/out in frames) that
`melt` renders headless with its monitor's engine. Shotcut: same engine, weaker editing. OpenShot, Blender VSE,
Olive: slow, heavy or stalled. Agent-first editors (WeftCut, OpenChatCut, OpenCut, Palmier Pro): one-person, pre-1.0
or Mac-first; on the tech radar. HyperFrames Studio edits the graphics page, not footage. The Kdenlive MCP servers are
unlicensed or need a patched build; auto-editor (public domain) is the reference for writing `.kdenlive` files.

## Phase 14 (2026-11-05): declutter

Why: I don't find things fast, the dashboards are cluttered, there's AI everywhere, and I lose scripts between idea
bubbles (Personal brand: 67 bubbles four levels deep, 19 holding scripts, 30 made by Claude; two videos both called
"Announcement"). The app is a dashboard: it shows me what's going on and takes my clicks. Claude does the editing
(through Claude Code), the organising and the scheduling. What the app must be perfect at: editing videos
professionally with Claude. Laptop first (1920 × 1080).

| Topic | Decision |
|---|---|
| Pages | Personal brand, Long Story Short, Blox Moments. Gentle Return hidden (its Islamic features stay in the code) |
| Unneeded features | Code deleted, not hidden; their data stays in the database (no tables dropped) |
| Deleted | In-app chat; Ideas mind map (and Expand/Angles/Challenge/Episodes); Notes page (I move the notebook to Obsidian); Saved pile and the phone's *Save to Ideas*; Inbox; Capture; Research and Find; Campaigns and Brand screens; Analytics and all statistics (I read them on Instagram), the weekly review; the Edit studio; search; AI pictures and clips (home PC and kie.ai); the self-hosted model; the cloned voice; the AI voice and UGC; Claude's breakdown of references; TikTok, YouTube and X posting |
| Kept | Calendar, Knowledge, Toolbox, Settings (as now, minus deleted features). Campaigns: rules keep steering clips, I submit on Content Rewards' site; a clipping page's *Campaigns* section is only the list of links I drop for Claude to check when making its videos (paste, remove; "Ended" once the budget is used up) |
| Navigation | No sidebar. Top bar: Home, then one tab per page; Knowledge, Toolbox, Settings at the right. Under a page, its sections: Personal brand *Ideas · Videos · Calendar*, a clipping page *Campaigns · Clips · Calendar* |
| Home | The board of every page, nothing else (a To do list was tried in mockup 2 and dropped: the board already shows what waits): Ideas · Writing · Ready to film · Editing · Review · Scheduled · Posted (last 7 days); clips start at Editing; a comment sends a card back to Editing. Cards: page dot, title (two lines at most), length, time or episode. A page's Ideas and Videos/Clips sections are the same board for that page |
| Ideas = videos | One thing: an idea is its video card from the start (no lock-in, no copies). Series stay (numbered episodes) |
| Old bubbles | Mine (37) move over with their scripts; sub-bubbles become bullet notes in their idea; Claude's 30 go (and Claude's flesh-out notes on the locked-in videos). Both "Announcement" videos stay: I delete one (Delete on the card, with Undo) |
| Card page | Full page, with a sidebar to jump between ideas (Ready to film, then Writing, then Ideas). One document with two preset headings I can rename: *Script* (what I say), then *Notes* under it (the effects I want). Hooks and Directions (help to script, with the viral skills): answers beside the document, a click takes one (a hook swaps my first line, with Undo; a direction goes under Notes) |
| Review | Player, comments pinned to moments, post text (caption, hashtags), older renders. One *Approve* button that schedules (the top one only scrolled; the real one waited for every campaign rule to be ticked). Campaign rules hidden: a clip that breaks one shows one red line. I start fixes by saying "fix my comments" in Claude Code |
| Look | Claude edits in its favourite of 2–3 looks; I can switch after the first render |
| Footage | What I share lands on the video I pick; the card stays where it is until I tell Claude Code to edit it |
| Look and feel | Mostly greys, one alarm colour only on what needs me, the page as a small dot (Long Story Short's dot violet: its orange looked like Personal brand's amber). Big text, calm spacing, almost no helper sentences |
| Phone | Only: footage to a video I pick (shared from the gallery, or the app's *Add footage*: pick clips, then the video), and write scripts (Ready to film, Writing, Ideas). Nothing else |

Build (after the mockup):
- [x] Mockup: Home, a card being written, a card in review, Calendar, the phone (share + scripts), with my real titles (three rounds, approved 2026-11-05)
- [x] Delete the features above (server, web, shared, Android), and the rules in CLAUDE.md that go with them (2026-11-05). The in-app agent stays, only to fix an edit that fails the check before its render
- [x] Move the Personal brand bubbles onto video cards (`db/phase14.ts`, at the first start; the database is copied to `backups/` first). Tried on a copy: 11 ideas, the series numbered
- [x] Pages on the top bar, sections under them; Gentle Return hidden; every page on `BOARD_STAGES`
- [x] Home board; card page; review page with the one Approve (tried on a copy: approve → Sat 12:30, Undo; a real Hooks call, 8 s)
- [x] Phone app: share to a video, Add footage, scripts; `API_VERSION` 4; Android 0.3.0 (CI builds it)
