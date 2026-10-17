# Built-in sound effects

Non-musical only: no music, no instruments, no note sequences, no beats, no held tones. Built by
`server/scripts/make-sfx.py`; listed for the app in `shared/sfx.ts`.

| Files | Source |
|---|---|
| whoosh-fast, whoosh-soft, whoosh-heavy, swish, whoosh-reverse, riser-short, riser-long, riser-tonal, boom, boom-short, pop, pop-high, shutter, ding, ping, glitch, static, buzzer | Synthesised by the script (ours) |
| hit, thud, knock, slam | Kenney, *Impact Sounds* (CC0): impactPunch_heavy_000, impactSoft_heavy_000, impactWood_medium_000, impactPlate_heavy_000 |
| bloop, click, tick, toggle, scroll, ding-glass | Kenney, *Interface Sounds* (CC0): drop_002, click_001, tick_001, toggle_001, scroll_001, glass_001 |
| click-soft, mouse-click, typing | Kenney, *UI Audio* (CC0): click1, mouseclick1, switch1/2/3/5/7/9/11 (typing is a sequence of them) |
| whoosh-up, whoosh-down, swoosh-long, whoosh-whip, fly-by, downlifter, riser-huge, riser-tension, reverse-boom, punch, slap, body-fall, sub-drop, deep-impact, door-slam, wood-crack, glass-break, clank, explosion, bubble, water-drop, cork, balloon-pop, suction-pop, sparkle, data-burst, stutter, tap, swipe, key-press, keyboard-fast, denied, focus, page-turn, paper-rustle, pen-scribble, pen-tick, zipper, cash-drawer, coin, stamp, footsteps, heartbeat, clock-ticking, applause, snap, wind-gust, rain-burst, fire-crackle, water-splash, thunder, power-down, power-up, zap, radio-tune | Synthesised by the script (ours), the `NEW` set: shaped noise, short damped rings and glides, each seeded from its own name so it can be rebuilt alone (`make-sfx.py --new`, or names) |

The synthesised sounds are checked for pitch: none of the `NEW` set holds one pitch above 150 Hz for longer than about
100 ms, and none has two different held pitches. Glides (risers, the sub drop, power up/down) keep moving the whole
time. Levels: each file is peak-normalised in the script, with the peak picked so its loudest 400 ms sits with the
existing sounds of the same kind (whooshes and risers around −16 LUFS, big impacts −11 to −16, clicks and taps −25 to
−28, foley and nature −17 to −23).

Kenney's packs are public domain (CC0, https://creativecommons.org/publicdomain/zero/1.0/), from https://kenney.nl.
