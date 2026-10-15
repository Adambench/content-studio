// Bundles the server into one file that the desktop app runs with Electron's built-in Node.
import { build } from 'esbuild';

await build({
  // The server, and the video renderer that the server forks for each render.
  entryPoints: { server: 'src/index.ts', 'render-worker': 'src/studio/worker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: false,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // These find files inside their own packages (the Claude binary, HyperFrames' runtime and workers, Chrome downloads),
  // so they stay real dependencies; desktop/scripts/package.mjs copies them into the app.
  external: ['@anthropic-ai/claude-agent-sdk', '@hyperframes/*', 'puppeteer-core', '@puppeteer/browsers'],
  // Bundled CommonJS dependencies still expect require/__dirname.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('Bundled server → server/dist/server.mjs, render-worker.mjs');
