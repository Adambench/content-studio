// Compute workers: the home PCs that take the heavy jobs (Whisper, Demucs, the person matte, the speaker scan, picture
// and video generation, the cloned voice, drawing a render's frames). A worker
// pairs with the laptop like the phone, polls it for tasks over Tailscale, runs the tool's command from its own scripts,
// and sends the output files back. The command line of each tool is defined here once, so the laptop's own run (the
// fallback when no worker is free) and a worker's run are the same command. A worker never runs anything else: the
// laptop sends a tool name and file names, never a command.

export const COMPUTE_TOOLS = ['transcribe', 'separate', 'matte', 'speakers', 'probe', 'image', 'video', 'speak', 'render'] as const;
export type ComputeTool = (typeof COMPUTE_TOOLS)[number];
/** Tools only a worker runs (the laptop has no GPU for them): a job waits for one instead of running here. */
export const WORKER_ONLY: ComputeTool[] = ['image', 'video', 'speak'];

/** Where things are on the machine that runs the tool (they differ between the laptop and a worker). */
export type MachinePaths = {
  /** The folder with transcribe.py, separate.py, matte.py, speakers.py, probe.py. */
  scriptsDir: string;
  /** Python for Demucs, the matte and the speaker scan. */
  toolsPython: string;
  /** Python for faster-whisper (the same as toolsPython on a worker). */
  whisperPython: string;
  matteModel: string;
  yunetModel: string;
  ffmpeg: string;
  /** stable-diffusion.cpp's command-line program, and the folder with the FLUX and Wan weights. */
  sdBin: string;
  genModels: string;
  /** Python with Chatterbox and Kokoro (its own environment: Chatterbox pins its own PyTorch). */
  voicePython: string;
  kokoroModels: string;
  /** Node, and the folder with render.mjs and its HyperFrames install (worker/src/render.ts). */
  node: string;
  renderDir: string;
};

export type ToolInfo = {
  label: string;
  /** Input file names the task needs, and output file names it makes. */
  inputs: string[];
  outputs: string[];
  /** The tool's stdout is its result (the speaker scan's JSON). */
  stdout: boolean;
};

export const TOOL_INFO: Record<ComputeTool, ToolInfo> = {
  transcribe: { label: 'Speech to text (Whisper)', inputs: ['audio'], outputs: ['json'], stdout: false },
  separate: { label: 'Voice from music (Demucs)', inputs: ['audio'], outputs: ['vocals', 'rest'], stdout: false },
  matte: { label: 'Person matte', inputs: ['video'], outputs: ['mask'], stdout: false },
  speakers: { label: 'Speaker scan', inputs: ['video'], outputs: [], stdout: true },
  probe: { label: 'Self-test', inputs: [], outputs: [], stdout: true },
  image: { label: 'Pictures (FLUX)', inputs: [], outputs: ['image'], stdout: true },
  video: { label: 'Video clips (Wan)', inputs: [], outputs: ['video'], stdout: true },
  speak: { label: 'My voice (Chatterbox)', inputs: ['job', 'reference'], outputs: ['wav'], stdout: true },
  // The laptop cuts and grades the footage and writes the composition; the worker draws its frames (headless Chrome),
  // encodes and mixes, from the project folder sent as one tar.
  render: { label: 'Video renders (HyperFrames)', inputs: ['project'], outputs: ['video'], stdout: false },
};

/** HyperFrames' settings for a finished video: the same on the laptop (studio/worker.ts) and a worker (render.ts). */
export const RENDER_JOB = { quality: 'standard', crf: 17, format: 'mp4', hdrMode: 'force-sdr', strictness: 'best-effort', useGpu: true } as const;

/** A render's progress line on a worker's output: "@progress 0.412 rendering". */
export const RENDER_PROGRESS = /^@progress (\d(?:\.\d+)?) ?(.*)$/;

export type ToolParams = {
  model?: string;
  /** Transcribe: the language spoken, when Whisper's own guess is wrong. */
  language?: string;
  fps?: number;
  /** Speaker scan: camera changes found some other way (a check of a finished video), seconds of the video. */
  addCuts?: number[];
  /** Generation: what to make, at what size, from which seed; frames for a clip. */
  prompt?: string;
  negative?: string;
  width?: number;
  height?: number;
  seed?: number;
  frames?: number;
};

/** The command for a tool: `files` maps each input and output name to a path on this machine. */
export function commandFor(tool: ComputeTool, files: Record<string, string>, params: ToolParams, m: MachinePaths): { bin: string; args: string[] } {
  const script = (name: string) => `${m.scriptsDir}/${name}`;
  switch (tool) {
    case 'transcribe':
      return { bin: m.whisperPython, args: [script('transcribe.py'), files.audio, '--out', files.json, '--model', params.model ?? 'small', ...(params.language ? ['--language', params.language] : [])] };
    case 'separate':
      return { bin: m.toolsPython, args: [script('separate.py'), files.audio, '--vocals', files.vocals, '--rest', files.rest] };
    case 'matte':
      return { bin: m.toolsPython, args: [script('matte.py'), files.video, '--model', m.matteModel, '--out', files.mask, '--ffmpeg', m.ffmpeg] };
    case 'speakers':
      return { bin: m.toolsPython, args: [script('speakers.py'), files.video, '--model', m.yunetModel, '--ffmpeg', m.ffmpeg, '--fps', String(params.fps ?? 8), ...(params.addCuts?.length ? ['--add-cuts', params.addCuts.join(',')] : [])] };
    case 'probe':
      return { bin: m.toolsPython, args: [script('probe.py'), '--matte-model', m.matteModel, '--ffmpeg', m.ffmpeg] };
    case 'image':
    case 'video': {
      const size = ['--width', String(params.width ?? 768), '--height', String(params.height ?? 1344), '--seed', String(params.seed ?? 1)];
      const clip = tool === 'video' ? ['--frames', String(params.frames ?? 81), `--negative=${params.negative ?? ''}`] : [];
      // `--prompt=…` keeps a prompt that starts with a dash from reading as a flag.
      return { bin: m.toolsPython, args: [script('generate.py'), tool, '--sd', m.sdBin, '--models', m.genModels, '--ffmpeg', m.ffmpeg, `--prompt=${params.prompt ?? ''}`, ...size, ...clip, '--out', files[tool]] };
    }
    case 'speak':
      return { bin: m.voicePython, args: [script('tts.py'), files.job, '--models', m.kokoroModels, '--clone', files.reference, '--out', files.wav] };
    case 'render':
      return { bin: m.node, args: [`${m.renderDir}/render.mjs`, files.project, '--out', files.video, '--fps', String(params.fps ?? 30)] };
  }
}

/** What a worker says about itself when it polls. */
export type WorkerReport = {
  name: string;
  gpu: string;
  tools: ComputeTool[];
  busy: boolean;
  speed?: { matteMsPerFrame: number | null; cuda: boolean };
  /** The text/vision model server it hosts (Ollama), as the laptop reaches it over Tailscale. */
  llm?: { url: string };
};

export type WorkerInfo = {
  id: string;
  name: string;
  gpu: string;
  tools: ComputeTool[];
  online: boolean;
  lastSeenAt: number | null;
  /** What it is doing now. */
  task: { tool: ComputeTool; progress: string } | null;
  /** From the self-test: seconds per matted frame, for comparing with the laptop. */
  speed: { matteMsPerFrame: number | null; cuda: boolean } | null;
  /** The model server it hosts, if any. */
  llmUrl: string | null;
};

/** A task as the worker sees it. */
export type WorkerTask = { id: string; tool: ComputeTool; params: ToolParams; inputs: { name: string; size: number }[]; outputs: string[]; timeoutMs: number };

export const WORKER_ONLINE_MS = 45_000;
