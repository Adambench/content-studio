import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { findBinary } from '../lib/bin';
import { emit } from '../lib/events';

/**
 * The clip tools: a Python environment in the data folder with Demucs (splits a clip's voice from the rest, so
 * background music goes), OpenCV's YuNet face detector (reframing on the speaker) and gdown (Drive), plus their
 * models — about 1.3 GB, installed from Settings like Whisper. Clips can't be made without them: the music check is
 * the halal rule, not an extra.
 */
export type ClipToolsInstall = { state: 'idle' | 'installing' | 'done' | 'error'; message: string };

let install: ClipToolsInstall = { state: 'idle', message: '' };

export const clipToolsInstallStatus = () => install;
export const clipToolsInstalled = () => existsSync(join(config.toolsDir, '.ready')) && existsSync(config.toolsPython);
/** The person matte model (U²-Net, human segmentation) for effects that cut the person out. */
export const matteModel = () => join(config.toolsDir, 'models/u2net_human_seg.onnx');
export const yunetModel = () => join(config.toolsDir, 'models/face_detection_yunet_2023mar.onnx');
/** For the tools' scripts: the models come from their own cache, offline (they were downloaded at install). */
export const toolsEnv = () => ({ ...process.env, HF_HOME: join(config.toolsDir, 'hf'), HF_HUB_OFFLINE: '1', PYTHONUNBUFFERED: '1' });

function update(next: ClipToolsInstall) {
  install = next;
  emit({ type: 'changed', entity: 'settings' });
}

/** Run `setup-tools.sh` from inside the app (no terminal needed); progress is its last line. */
export function installClipTools() {
  if (install.state === 'installing') return install;
  if (!findBinary('python3')) {
    update({ state: 'error', message: 'Python 3 isn’t installed on this computer.' });
    return install;
  }
  update({ state: 'installing', message: 'Starting…' });
  const child = spawn('bash', [join(config.scriptsDir, 'setup-tools.sh'), config.toolsDir], {
    env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/bin:/bin` },
  });
  let tail = '';
  const onData = (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-2000);
    const line = tail.trim().split('\n').pop() ?? '';
    // pip and Hugging Face chatter (warnings, progress bars) isn't progress worth showing.
    if (line && !/warning|unauthenticated|%\|/i.test(line)) update({ state: 'installing', message: line.slice(0, 200) });
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    if (code === 0 && clipToolsInstalled()) update({ state: 'done', message: 'The clip tools are ready.' });
    else update({ state: 'error', message: tail.trim().split('\n').slice(-3).join(' ').slice(0, 400) || `Setup failed (exit ${code}).` });
  });
  child.on('error', (err) => update({ state: 'error', message: err.message }));
  return install;
}
