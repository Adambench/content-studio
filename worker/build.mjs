// Bundles the worker into one file; scripts/setup-worker.sh puts it beside the Python scripts it runs.
import { build } from 'esbuild';

await build({
  entryPoints: { worker: 'src/main.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});
