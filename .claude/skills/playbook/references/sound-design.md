# Sound design

Sound in Content Studio is the voice, the room and **non-musical sound effects**. Never music or instruments
(`halal.md`). That's a strength: a clean voice with a few well-placed effects sounds deliberate, and original audio
is what most small accounts do best with anyway.

## The voice comes first

- The voice is the content. Clean it (the app's voice enhancement), keep it even, and let the whole mix be
  normalised to −14 LUFS.
- Footage with music under the speaker gets voice isolation first; if the music can't be removed, the clip is
  dropped.
- Room tone between words is fine. Dead silence after tightening can feel clipped: leave the natural breath where
  a cut sounds abrupt.

## Which effect, where

| Effect | Where it goes | How often |
|---|---|---|
| **Pop** | as the hook card or a callout appears | on the hook card; then only on key callouts |
| **Whoosh / swish** | a b-roll cutaway coming in, a big reframe, a slide-in overlay | a few per video at most |
| **Click / tick** | each item of a list appearing, a cursor or UI moment | once per item, short and quiet |
| **Impact / thud / boom** | the reveal, the big number, the turn of a story | once, maybe twice, in a whole video |
| **Ding / chime** | a result, a "correct", a goal reached | once |
| **Riser / sweep** (tonal, non-musical) | building into the payoff; it **ends exactly** on the moment | once |
| **Camera shutter, paper, keyboard** | showing a photo, a document, typing | when the picture shows it |
| **Silence** | drop everything for half a second before a reveal | rarely; it works because it's rare |

A sound effect marks a moment that already matters. It doesn't create importance.

## Placement

- **On the frame:** the cue's time is the frame where the thing happens (text appears, the cut lands). Risers end on
  that frame, so they start their own length earlier.
- **Between words where possible.** An effect over a key word hides it. Put it in the gap just before or after.
- **Never on every cut.** A 30-second clip usually wants 2 to 5 effects, and an effect more often than every 5 to 8
  seconds turns into noise. Leave whole stretches with only the voice.
- **Consistency per page.** The same pop for the hook card, the same whoosh for cutaways: it becomes part of the
  page's look.

## Levels

- Effects sit **under the voice**: noticeable, never louder than speech. Under speech, start around 0.3–0.5 of the
  effect's own level; in a gap with no speech, up to about 0.8. Judge it by ear and keep the voice clearly on top.
- Impacts and booms are the loudest by nature: turn them down rather than up.
- Watch the low end on phone speakers: a deep boom can sound like distortion. A shorter, higher impact often reads
  better.

## Fit the tone

- Playful pops and dings suit light content. A serious story, grief, or religious content gets few effects or none:
  a soft whoosh at most, never a cartoon sound.
- Campaign clips: if the brief bans added effects or asks for clean audio, follow the brief.

## Never

- music, instruments, beats, stingers, jingles, drum hits, bass drops, record scratches
- a "sound effect" that is really a slice of a song
- effects covering words
- an effect on every cut

## Sources

The `viral-hooks` three-layer hook reference (sound as the timing cue that ties the layers together), with every
music-based suggestion left out; the `viral-short-form` retention reference (pacing); the `viral-youtube-shorts`
algorithm reference (original audio for smaller channels); the app's sound model (`shared/edit.ts`: SFX cues on the
finished video's timeline, loudness normalised to −14 LUFS); the user's halal rules (PLAN.md, *Halal*).
