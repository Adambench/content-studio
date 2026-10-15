// Compiles the Electron main process and preload script.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: 'linked', logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });
console.log('Built desktop → desktop/dist');
