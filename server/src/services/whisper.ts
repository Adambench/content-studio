import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config } from '../config';
import { findBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { getSetting } from '../lib/settings';
import { whisperInstalled } from './media';

export type WhisperInstall = { state: 'idle' | 'installing' | 'done' | 'error'; message: string };

let install: WhisperInstall = { state: 'idle', message: '' };

export const whisperInstallStatus = () => install;

function update(next: WhisperInstall) {
  install = next;
  emit({ type: 'changed', entity: 'settings' });
}

/** Install faster-whisper into the data folder from inside the app (no terminal needed). */
export function installWhisper() {
  if (install.state === 'installing') return install;
  if (!findBinary('python3')) {
    update({ state: 'error', message: 'Python 3 isn’t installed on this computer.' });
    return install;
  }
  update({ state: 'installing', message: 'Starting…' });
  const child = spawn('bash', [join(config.scriptsDir, 'setup-whisper.sh'), config.whisperVenv, getSetting('whisperModel') ?? 'small'], {
    env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/bin:/bin` },
  });
  let tail = '';
  const onData = (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-2000);
    const line = tail.trim().split('\n').pop() ?? '';
    if (line) update({ state: 'installing', message: line.slice(0, 200) });
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    if (code === 0 && whisperInstalled()) update({ state: 'done', message: 'Whisper is ready.' });
    else update({ state: 'error', message: tail.trim().split('\n').slice(-3).join(' ').slice(0, 400) || `Setup failed (exit ${code}).` });
  });
  child.on('error', (err) => update({ state: 'error', message: err.message }));
  return install;
}
