import { builtinSfx } from '@shared/sfx';
import { fileUrl, mediaFileUrl } from './api';
import type { Media } from './types';

/** Where to play a sound-effect cue from: one of the app's own sounds or a library file. */
export function sfxUrl(id: string) {
  const builtin = builtinSfx(id);
  return builtin ? fileUrl(`/studio/sfx/${builtin.name}.ogg`) : mediaFileUrl(id);
}

export function sfxName(id: string, media: Map<string, Media>) {
  return builtinSfx(id)?.label ?? media.get(id)?.originalName ?? 'A removed sound';
}

let current: HTMLAudioElement | null = null;

/** Play a sound to hear it, stopping whatever was playing; resolves when it ends. */
export function listen(src: string, volume = 1) {
  current?.pause();
  const audio = new Audio(src);
  audio.volume = Math.min(1, Math.max(0, volume));
  current = audio;
  return new Promise<void>((resolve) => {
    const done = () => {
      if (current === audio) current = null;
      resolve();
    };
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('pause', done, { once: true });
    audio.addEventListener('error', done, { once: true });
    audio.play().catch(done);
  });
}

export const stopListening = () => current?.pause();
