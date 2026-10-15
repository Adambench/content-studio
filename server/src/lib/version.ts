import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';

/** The app's version (the repository's package.json, copied into the installed app). */
export const appVersion: string = (() => {
  try {
    return JSON.parse(readFileSync(join(config.resourcesDir, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
