// A small HyperFrames project for measuring renders on a machine: a title over footage (or a gradient) with a few
// GSAP moves and two-word captions, 1080 × 1920 at 30 fps.

import { copyFileSync, existsSync, linkSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** GSAP goes into every project folder, so a render never needs the network. */
export function copyGsap(dir: string) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const target = join(dir, 'assets/gsap.min.js');
  if (!existsSync(target)) copyFileSync(require.resolve('gsap/dist/gsap.min.js'), target);
}

/**
 * A file from elsewhere in the data folder put inside the project. A hard link: no copy of gigabytes, and its path
 * is inside the project (HyperFrames refuses files that resolve outside it, so a symbolic link shows black).
 */
export function linkAsset(dir: string, source: string, name: string): string {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const target = join(dir, 'assets', name);
  if (!existsSync(target)) {
    try {
      linkSync(source, target);
    } catch {
      copyFileSync(source, target);
    }
  }
  return `assets/${name}`;
}

export function writeTestProject(dir: string, opts: { seconds: number; video?: string }) {
  copyGsap(dir);
  const d = opts.seconds;
  const words = ['Rendered', 'on the', 'AI server', 'frame by', 'frame'];
  const per = d / words.length;
  const media = opts.video
    ? `<video id="bg" class="clip" data-start="0" data-duration="${d}" data-track-index="0" src="${linkAsset(dir, opts.video, 'footage.mp4')}" muted playsinline style="object-fit: cover"></video>`
    : `<div id="bg" class="clip" data-start="0" data-duration="${d}" data-track-index="0" style="background: radial-gradient(circle at 30% 20%, #3f3f46, #09090b 70%)"></div>`;
  const caps = words
    .map((w, i) => `<div id="cap${i}" class="clip cap" data-start="${(i * per).toFixed(3)}" data-duration="${per.toFixed(3)}" data-track-index="2"><span>${w}</span></div>`)
    .join('\n      ');
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
      #main { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: system-ui, sans-serif; }
      .clip { position: absolute; inset: 0; visibility: hidden; }
      #title { display: flex; align-items: flex-start; justify-content: center; padding-top: 360px; }
      #title h1 { color: #fafafa; font-size: 96px; font-weight: 800; letter-spacing: -2px; opacity: 0; transform: translateY(40px); }
      .cap { display: flex; align-items: flex-end; justify-content: center; padding-bottom: 560px; }
      .cap span { color: #fff; font-size: 84px; font-weight: 800; text-transform: uppercase; text-shadow: 0 4px 24px rgba(0,0,0,.6); }
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="test" data-start="0" data-duration="${d}" data-width="1080" data-height="1920">
      ${media}
      <div id="title" class="clip" data-start="0" data-duration="${d}" data-track-index="1"><h1>Content Studio</h1></div>
      ${caps}
    </div>
    <script>
      var tl = gsap.timeline({ paused: true });
      tl.to('#title h1', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2);
      tl.to('#title h1', { scale: 1.06, duration: ${Math.max(1, d - 1.5).toFixed(2)}, ease: 'none' }, 0.8);
      ${words.map((_, i) => `tl.from('#cap${i} span', { scale: 0.7, opacity: 0, duration: 0.18, ease: 'back.out(2)' }, ${(i * per).toFixed(3)});`).join('\n      ')}
      tl.set({}, {}, ${d});
      window.__timelines = window.__timelines || {};
      window.__timelines['test'] = tl;
    </script>
  </body>
</html>
`,
  );
}
