import { spawn, type ChildProcess } from 'node:child_process';
import { findBinary } from './bin';

let lock: ChildProcess | null = null;

/**
 * Ask logind not to suspend the computer while a post is about to go out (`systemd-inhibit`, which needs no root
 * for the signed-in user). The lock is held by a `cat` reading from us, so it ends with this process too.
 * Closing the lid still suspends unless logind is told to ignore it (see the README).
 */
export function holdSleepLock(on: boolean, why: string) {
  if (on === !!lock) return;
  if (!on) {
    lock?.stdin?.end();
    lock?.kill();
    lock = null;
    return;
  }
  const inhibit = findBinary('systemd-inhibit');
  const cat = findBinary('cat');
  if (!inhibit || !cat) return;
  const child = spawn(inhibit, ['--what=sleep', '--who=Content Studio', `--why=${why}`, '--mode=block', cat], { stdio: ['pipe', 'ignore', 'ignore'] });
  child.on('error', () => lock === child && (lock = null));
  child.on('exit', () => lock === child && (lock = null));
  lock = child;
}
