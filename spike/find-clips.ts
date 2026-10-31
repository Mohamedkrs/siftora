// Phase 0.5 quality spike: video -> transcript -> LLM moment discovery -> rendered 9:16 clips.
// Throwaway code to answer one question: are local-LLM clip picks good enough?
// Usage: node spike/find-clips.ts <video> --tools <dir> --models <dir> [--out spike/out] [--count 8] [--min 20] [--max 60] [--lang auto]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

type Seg = { id: number; start: number; end: number; text: string; words: Word[] };
type Word = { start: number; end: number; text: string };
type Moment = {
  start_id: number; end_id: number; title: string; hook: string; category: string; rationale: string;
  scores: { hook: number; payoff: number; standalone: number; value: number };
};
type Clip = Moment & { start: number; end: number; score: number; notes: string[] };

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const video = argv[0] && !argv[0].startsWith('--') ? resolve(argv[0]) : '';
const toolsDir = flag('tools', process.env.VCF_TOOLS);
const modelsDir = flag('models', process.env.VCF_MODELS);
if (!video || !existsSync(video) || !toolsDir || !modelsDir) {
  console.error('Usage: node spike/find-clips.ts <video> --tools <dir> --models <dir> [--out dir] [--count 8] [--min 20] [--max 60] [--lang auto]');
  process.exit(1);
}
const COUNT = Number(flag('count', '8'));
const MIN_MS = Number(flag('min', '20')) * 1000;
const MAX_MS = Number(flag('max', '60')) * 1000;
const LANG = flag('lang', 'auto')!;
// resolve() so a model flag may also be an absolute path (e.g. an Ollama blob, which is a plain GGUF file).
const WHISPER_MODEL = resolve(modelsDir, flag('whisper-model', 'ggml-large-v3-turbo.bin')!);
const LLM_MODEL = resolve(modelsDir, flag('llm-model', 'Qwen3.5-9B-Q4_K_M.gguf')!);
const WINDOW_MS = 6 * 60_000;
const STEP_MS = 4.5 * 60_000; // 1.5 min overlap so setup and payoff are not split
const PORT = 8089;

const outDir = resolve(flag('out', 'spike/out')!, basename(video, extname(video)));
mkdirSync(outDir, { recursive: true });

// ---------- helpers ----------
function findExe(dir: string, name: string): string {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry.toLowerCase() === name) return p;
    if (statSync(p).isDirectory()) {
      try { return findExe(p, name); } catch { /* keep looking */ }
    }
  }
  throw new Error(`${name} not found under ${dir}`);
}

// Argument arrays only, never a shell string (file names are untrusted input).
function run(cmd: string, args: string[], opts: { cwd?: string; onStderr?: (s: string) => void } = {}): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => { err += d; opts.onStderr?.(String(d)); });
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`${basename(cmd)} exited ${code}\n${err.slice(-2000)}`))));
  });
}

const ms2clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const ms2ass = (ms: number) => {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  timings[label] = Date.now() - t;
  console.log(`  ${label}: ${(timings[label] / 1000).toFixed(1)}s`);
  return r;
}

// ---------- stage 1: probe + audio ----------
const ffmpeg = 'ffmpeg', ffprobe = 'ffprobe';
const probe = JSON.parse(await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', video]));
const durationMs = Math.round(Number(probe.format.duration) * 1000);
console.log(`Video: ${basename(video)} (${ms2clock(durationMs)})`);

const wav = join(outDir, 'audio.wav');
if (!existsSync(wav)) {
  await timed('audio extraction', () => run(ffmpeg, ['-y', '-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]));
}

// ---------- stage 2: transcription (cached) ----------
const transcriptPath = join(outDir, 'transcript.json');
if (!existsSync(transcriptPath)) {
  const whisper = findExe(toolsDir, 'whisper-cli.exe');
  const base = join(outDir, 'whisper');
  let lastPct = -1;
  await timed('transcription', () => run(whisper, [
    '-m', WHISPER_MODEL, '-f', wav, '-l', LANG, '-ojf', '-of', base, '-pp', '-dtw', 'large.v3.turbo',
  ], {
    onStderr: (s) => {
      const m = s.match(/progress =\s*(\d+)%/);
      if (m && Number(m[1]) !== lastPct) { lastPct = Number(m[1]); process.stdout.write(`\r  transcribing ${lastPct}%`); }
    },
  }));
  process.stdout.write('\n');
  const raw = JSON.parse(readFileSync(`${base}.json`, 'utf8'));
  const segs: Seg[] = raw.transcription.map((t: any, id: number) => ({
    id, start: t.offsets.from, end: t.offsets.to, text: t.text.trim(), words: tokensToWords(t.tokens ?? []),
  })).filter((s: Seg) => s.text);
  writeFileSync(transcriptPath, JSON.stringify({ language: raw.result?.language, segments: segs }, null, 1));
}
const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const segs: Seg[] = transcript.segments;
console.log(`Transcript: ${segs.length} segments, language ${transcript.language}`);

// whisper.cpp tokens are sub-word pieces; a leading space starts a new word. Special tokens look like [_BEG_].
function tokensToWords(tokens: any[]): Word[] {
  const words: Word[] = [];
  for (const t of tokens) {
    if (!t.text || t.text.startsWith('[_')) continue;
    const start = t.t_dtw > 0 ? t.t_dtw * 10 : t.offsets.from;
    if (t.text.startsWith(' ') || !words.length) words.push({ start, end: t.offsets.to, text: t.text.trim() });
    else { const w = words[words.length - 1]; w.text += t.text; w.end = t.offsets.to; }
  }
  return words.filter((w) => w.text);
}

// ---------- stage 3: moment discovery with llama-server ----------
const SCHEMA = {
  type: 'object',
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_id: { type: 'integer' }, end_id: { type: 'integer' },
          title: { type: 'string' }, hook: { type: 'string' },
          category: { type: 'string', enum: ['funny', 'educational', 'controversial', 'emotional', 'surprising', 'conversation'] },
          rationale: { type: 'string' },
          scores: {
            type: 'object',
            properties: Object.fromEntries(['hook', 'payoff', 'standalone', 'value'].map((k) => [k, { type: 'integer', minimum: 1, maximum: 5 }])),
            required: ['hook', 'payoff', 'standalone', 'value'],
          },
        },
        required: ['start_id', 'end_id', 'title', 'hook', 'category', 'rationale', 'scores'],
      },
    },
  },
  required: ['moments'],
};

const SYSTEM = `You are an expert short-form video editor. You find moments in a video transcript that would work as standalone TikTok / Instagram Reels / YouTube Shorts clips of ${MIN_MS / 1000}-${MAX_MS / 1000} seconds.

Transcript lines look like: [id] (mm:ss) text

A good moment:
- grabs attention in the first seconds (a hook: surprising claim, question, strong opinion, joke setup),
- contains its own setup AND payoff, so a viewer who has not seen the rest of the video understands it,
- starts and ends at complete sentences.

Return at most 3 moments for this excerpt, only genuinely strong ones. Return an empty list if nothing qualifies.
Pick start_id and end_id from the line ids. Never invent ids. Write title, hook and rationale in the transcript's language.
Scores are 1-5: hook = how strongly the first seconds grab attention; payoff = how satisfying the ending is; standalone = understandable without context; value = entertainment or information value.`;

async function discover(): Promise<Clip[]> {
  const server = spawn(findExe(toolsDir!, 'llama-server.exe'), [
    '-m', LLM_MODEL, '-ngl', '99', '-c', '16384', '--port', String(PORT), '--jinja',
  ], { windowsHide: true });
  let serverLog = '';
  server.stderr.on('data', (d) => (serverLog = (serverLog + d).slice(-4000)));
  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error(`llama-server exited\n${serverLog}`);
      try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not up yet */ }
      if (i > 240) throw new Error('llama-server did not become ready in 120s');
      await new Promise((r) => setTimeout(r, 500));
    }

    const found: Clip[] = [];
    const windows = Math.max(1, Math.ceil((durationMs - WINDOW_MS) / STEP_MS) + 1);
    for (let w = 0; w < windows; w++) {
      const from = w * STEP_MS, to = from + WINDOW_MS;
      const lines = segs.filter((s) => s.start >= from && s.start < to);
      if (!lines.length) continue;
      process.stdout.write(`\r  window ${w + 1}/${windows}`);
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          temperature: 0.3,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: lines.map((s) => `[${s.id}] (${ms2clock(s.start)}) ${s.text}`).join('\n') },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'moments', schema: SCHEMA } },
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
      const body = await res.json();
      const { moments } = JSON.parse(body.choices[0].message.content) as { moments: Moment[] };
      const ids = new Set(lines.map((s) => s.id));
      for (const m of moments) {
        if (!ids.has(m.start_id) || !ids.has(m.end_id) || m.end_id < m.start_id) continue; // reject invented ids
        found.push(refine(m));
      }
    }
    process.stdout.write('\n');
    return found;
  } finally {
    server.kill();
  }
}

// ---------- stage 4: deterministic refinement ----------
function refine(m: Moment): Clip {
  let a = m.start_id, b = m.end_id;
  const notes: string[] = [];
  const dur = () => segs[b].end - segs[a].start;
  while (dur() < MIN_MS && (b < segs.length - 1 || a > 0)) {
    if (b < segs.length - 1) b++; else a--;
    if (!notes.includes('extended to min duration')) notes.push('extended to min duration');
  }
  while (dur() > MAX_MS && b > a) {
    b--;
    if (!notes.includes('trimmed to max duration')) notes.push('trimmed to max duration');
  }
  const s = m.scores;
  const avg = 0.3 * s.hook + 0.25 * s.payoff + 0.3 * s.standalone + 0.15 * s.value;
  return { ...m, start_id: a, end_id: b, start: segs[a].start, end: segs[b].end, score: Math.round(((avg - 1) / 4) * 100), notes };
}

function dedupe(clips: Clip[]): Clip[] {
  const kept: Clip[] = [];
  for (const c of [...clips].sort((x, y) => y.score - x.score)) {
    const clash = kept.some((k) => {
      const overlap = Math.min(k.end, c.end) - Math.max(k.start, c.start);
      return overlap > 0.5 * Math.min(k.end - k.start, c.end - c.start);
    });
    if (!clash) kept.push(c);
  }
  return kept;
}

// ---------- stage 5: render ----------
async function pickEncoder(): Promise<string[]> {
  // Probe instead of trusting the encoder list: FFmpeg lists QSV even on CPUs without an iGPU.
  try {
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
    return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '21'];
  } catch {
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
  }
}

function buildAss(c: Clip): string {
  // Karaoke (\k) highlights each word as it is spoken: white (secondary) -> yellow (primary). ASS colours are &HAABBGGRR.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,76,&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,0,2,80,80,520,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  for (const s of segs.slice(c.start_id, c.end_id + 1)) {
    const words = s.words.length ? s.words : [{ start: s.start, end: s.end, text: s.text }];
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3);
      const t0 = chunk[0].start, t1 = Math.max(chunk[chunk.length - 1].end, t0 + 300);
      const text = chunk.map((w, j) => {
        const next = chunk[j + 1]?.start ?? t1;
        return `{\\k${Math.max(1, Math.round((next - w.start) / 10))}}${w.text.replace(/[{}]/g, '')}`;
      }).join(' ');
      lines.push(`Dialogue: 0,${ms2ass(t0 - c.start)},${ms2ass(t1 - c.start)},Default,,0,0,0,,${text}`);
    }
  }
  return header + lines.join('\n') + '\n';
}

async function render(c: Clip, i: number, encoder: string[]) {
  const name = `clip${String(i + 1).padStart(2, '0')}`;
  writeFileSync(join(outDir, `${name}.ass`), buildAss(c));
  // Blurred background: blur a small copy (fast), scale it up, overlay the full frame centred.
  const vf = `[0:v]split[a][b];[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=1080:1920[bg];` +
    `[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,subtitles=${name}.ass[v]`;
  // cwd = outDir so the subtitles filter gets a plain relative name (avoids Windows drive-letter escaping).
  await run(ffmpeg, [
    '-y', '-v', 'error', '-ss', String(c.start / 1000), '-to', String(c.end / 1000), '-i', video,
    '-filter_complex', vf, '-map', '[v]', '-map', '0:a?', ...encoder, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', `${name}.mp4`,
  ], { cwd: outDir });
  return `${name}.mp4`;
}

// ---------- main ----------
const candidates = await timed('moment discovery', discover);
const clips = dedupe(candidates).slice(0, COUNT);
console.log(`Candidates: ${candidates.length} raw, ${clips.length} kept after dedupe`);

const encoder = await pickEncoder();
console.log(`Encoder: ${encoder[1]}`);
const files = await timed('rendering', async () => {
  const out: string[] = [];
  for (const [i, c] of clips.entries()) out.push(await render(c, i, encoder));
  return out;
});

const rtf = timings.transcription ? (timings.transcription / durationMs).toFixed(3) : 'cached';
const report = [
  `# ${basename(video)}`, '',
  `Duration ${ms2clock(durationMs)} · language ${transcript.language} · encoder ${encoder[1]}`,
  `Timings: ${Object.entries(timings).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(' · ')} · transcription real-time factor ${rtf}`, '',
  ...clips.flatMap((c, i) => [
    `## ${i + 1}. ${c.title} — ${c.score}/100 (${c.category})`,
    `\`${files[i]}\` · ${ms2clock(c.start)}–${ms2clock(c.end)} (${Math.round((c.end - c.start) / 1000)}s)` + (c.notes.length ? ` · ${c.notes.join(', ')}` : ''),
    `**Hook:** ${c.hook}`, `**Why:** ${c.rationale}`,
    `Scores: hook ${c.scores.hook}, payoff ${c.scores.payoff}, standalone ${c.scores.standalone}, value ${c.scores.value}`,
    `> ${segs.slice(c.start_id, c.end_id + 1).map((s) => s.text).join(' ')}`,
    `Your verdict: [ ] useful  [ ] not useful  [ ] bad boundary  [ ] duplicate`, '',
  ]),
].join('\n');
writeFileSync(join(outDir, 'report.md'), report);
writeFileSync(join(outDir, 'clips.json'), JSON.stringify({ video, durationMs, timings, clips }, null, 1));
console.log(`Done: ${join(outDir, 'report.md')}`);
