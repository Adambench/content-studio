import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

// Apps started from the desktop launcher get a minimal PATH, so also look where user installs usually go.
const EXTRA_DIRS = [join(homedir(), '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin'];
const cache = new Map<string, string | null>();

/** Absolute path of a command, or null if it isn't installed. */
export function findBinary(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...EXTRA_DIRS].filter(Boolean);
  let found: string | null = null;
  for (const dir of dirs) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      found = join(dir, name);
      break;
    } catch {
      /* keep looking */
    }
  }
  cache.set(name, found);
  return found;
}

export function requireBinary(name: string) {
  const path = findBinary(name);
  if (!path) throw new Error(`${name} isn’t installed on this computer.`);
  return path;
}
