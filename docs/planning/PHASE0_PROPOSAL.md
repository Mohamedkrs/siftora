# Phase 0 Proposal — Stack, Hardware Diagnosis, and Architecture

**Status:** proposal, awaiting approval. Nothing here is implemented yet.

This document answers the Phase 0 questions in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): technology stack, packaging, module boundaries, and how the app picks the fastest hardware path on each machine.

## 1. Inputs and assumptions

- **No existing code.** The repository contains documentation only, so the stack is chosen from scratch.
- **Platforms:** Windows x64, macOS Apple Silicon, Linux x64. Intel Macs and Windows ARM are best-effort (CPU paths only at first).
- **Distribution:** free, published on GitHub under **GPL-3.0**. Any distributed version, including a modified one, must stay open source under GPL-3.0, which makes closed paid versions impossible. The project name and logo are excluded from the license, so forks must rebrand (stated in the README).
- **Languages:** multilingual, depending on the user's videos. Use multilingual Whisper models (not `.en` variants) with automatic language detection. The model catalog tags each LLM with its well-supported languages. If the detected language is weak for the selected LLM, the app says so ("moment detection may be less accurate for this language") instead of hiding it. Prefer multilingual LLM families (e.g. Qwen) as defaults.
- **Use:** clips are published as reels, and creators may monetize them, so default models must have permissive licenses (MIT / Apache-2.0).
- **Bare install:** the installer contains the app only. FFmpeg, inference engines, GPU libraries, and models are all downloaded during onboarding.

## 2. Key decision: native inference engines, not PyTorch

The usual Python + PyTorch stack conflicts with two requirements:

1. **Size.** PyTorch with CUDA is several GB before any model is downloaded.
2. **All GPUs on all platforms.** PyTorch's CUDA build doesn't help on AMD-on-Windows, Intel GPUs, or Apple Silicon without separate builds.

Instead, use compact native engines that ship per-backend builds and load quantized models:

| Capability | Engine | GPU backends | License | Notes |
|---|---|---|---|---|
| Transcription | whisper.cpp | CUDA, Metal (+CoreML), Vulkan, ROCm/HIP, CPU | MIT | Quantized Whisper models; token-level timestamps; built-in Silero VAD support |
| LLM (moment discovery) | llama.cpp (`llama-server`) | CUDA, Metal, Vulkan, ROCm/HIP, SYCL, CPU | MIT | GGUF quantized models; JSON-schema-constrained output |
| VAD | Silero VAD (via whisper.cpp or ONNX Runtime) | CPU is enough | MIT | Tiny model |
| Speaker diarization (later) | sherpa-onnx (pyannote segmentation + speaker embedding models, ONNX) | CPU is enough | Apache-2.0 | Avoids pyannote's PyTorch stack and gated downloads |
| Audio events (later) | YAMNet or PANNs via ONNX Runtime | CPU is enough | Apache-2.0 / MIT | AudioSet labels include laughter, applause, cheering, screaming, crying |
| Scene cuts | FFmpeg `scdet` filter or PySceneDetect-style content detection | CPU | LGPL / BSD | Lightweight |
| Face detection for focused crop (later) | YuNet or MediaPipe face detector via ONNX Runtime | CPU is enough | Apache-2.0 | Sampled frames only |
| Decode, render, encode | FFmpeg | NVENC, QSV, AMF, VideoToolbox, VAAPI | GPL build (see §9) | Hardware encoders detected at diagnosis |

whisper.cpp and llama.cpp share the same compute library (ggml), so they get the same backends. Both can load backends as separate libraries at runtime. The app downloads only the backend this machine can use (e.g. only the CUDA libraries on an NVIDIA PC).

Small models (VAD, audio events, face detection) run fast enough on CPU. They don't get GPU paths at first, which removes a whole class of compatibility work.

Model names are examples. The model catalog is data, not code, so newer models can be added at implementation time without changing the UI.

## 3. Hardware diagnosis and backend selection

The goal: **use the fastest backend that actually works on this machine, and prove it with a test instead of guessing from the GPU name.**

### 3.1 Detect (fast, no downloads)

- **OS and architecture.**
- **CPU:** model, logical cores, instruction sets (AVX2 / AVX-512 / NEON).
- **RAM:** total and available.
- **GPUs:** vendor, model, VRAM, driver version.
  - Windows: DXGI adapter list.
  - NVIDIA: NVML / `nvidia-smi`.
  - Linux: `/sys/class/drm` and vendor tools.
  - macOS: Metal device info, including the recommended working-set size of unified memory.
- **Disk:** free space on the model, cache, and output drives.

### 3.2 Pick candidate backends

| Hardware | Candidate order |
|---|---|
| NVIDIA (Windows/Linux) | CUDA → Vulkan → CPU |
| AMD (Linux) | ROCm/HIP → Vulkan → CPU |
| AMD (Windows) | Vulkan → HIP (if the HIP runtime is present) → CPU |
| Intel Arc / iGPU | Vulkan → SYCL → CPU |
| Apple Silicon | Metal (+ CoreML encoder for Whisper) → CPU |
| No usable GPU | CPU (AVX2 build, or a generic build if AVX2 is missing) |

### 3.3 Probe (proves the backend works)

For each candidate, download the small backend build and run a real test. For example: list devices, then run a tiny model for a few seconds.

- **Pass:** the backend is usable.
- **Fail:** record the reason (driver too old, missing runtime, out of memory) and give the user a plain-language fix. Example: "NVIDIA driver 516 is older than the 525 this CUDA build needs. Update the driver or use Vulkan."

A GPU being present is never reported as acceleration being available. Only a passing probe counts.

### 3.3a Offer GPU acceleration to the user

When a faster backend is possible but not installed yet, onboarding (and Settings) shows it as an explicit offer:

> NVIDIA RTX 3060 detected. Transcription and analysis can run about 5× faster with CUDA acceleration (estimate).
> **[Download CUDA acceleration (~600 MB)]**  [Skip, use CPU]

- **No CUDA Toolkit install needed.** The CUDA runtime libraries (cudart, cuBLAS) may be redistributed under NVIDIA's EULA. The app downloads them as a component, next to the CUDA build of the engines. The only thing the user must have is a recent enough **NVIDIA driver**.
- **Driver too old or missing:** the app can't install drivers, which need admin rights and are risky to change silently. It states the required version and links to NVIDIA's official driver page, then re-checks with **[Check again]** after the update.
- **Estimate, then measure.** Before the download, the speed-up is labeled as an estimate. After it, the app runs the benchmark (§3.4) and shows the measured result, e.g. "1-hour video: CPU ~40 min → CUDA ~7 min". If CUDA turns out no faster than Vulkan on that card, the app says so and recommends the smaller download.
- **Other vendors work the same way:** a Vulkan (or ROCm on Linux) acceleration pack for AMD and Intel GPUs. Apple Silicon needs no download, because Metal is built into macOS.
- **Removable.** Acceleration packs appear in Settings next to models, with size, version, and a remove action.

### 3.4 Benchmark (optional, about 30–60 s)

- **Transcription:** run a small Whisper model on a bundled 10-second audio sample with each passing backend, and measure the real-time factor.
- **LLM:** run a short generation and measure tokens per second.
- **Video encoding:** test-encode 1 second with each available hardware encoder, plus the software fallback.

This gives measured numbers for "a 1-hour video takes about N minutes on this machine". It also settles cases where Vulkan beats CUDA on a particular card. The fastest passing backend becomes the default, and the user can override it in Settings.

### 3.5 Recommend models

Recommendations come from **available** VRAM (or unified memory on Mac), RAM, and the benchmark results. They are labeled as estimates. Example tiers, with exact numbers taken from the catalog's memory estimates:

| Tier | Transcription | LLM |
|---|---|---|
| CPU only, or under 4 GB VRAM | Whisper small/base, quantized | 3–4B model, Q4 (warn that analysis will be slow) |
| 6–8 GB VRAM / 16 GB Mac | Whisper large-v3-turbo, quantized | 7–8B model, Q4 |
| 12 GB+ VRAM / 32 GB+ Mac | Whisper large-v3 | 14B model, Q4 |

Models run **one at a time**: transcription finishes and unloads before the LLM loads. That's why a 7–8B LLM and large-v3-turbo both fit an 8 GB card.

### 3.6 When to re-run

- From Settings, at any time.
- Automatically suggested when the GPU or driver version changes between launches.
- After any out-of-memory crash, the app offers a smaller model or the CPU fallback.

## 4. Application stack

All options use the same native engines from §2. They differ in the shell and orchestration language.

**Decision: option A, Electron + TypeScript** (approved).

| | **A. Electron + TypeScript (chosen)** | B. Tauri 2 + Rust | C. Python + PySide6 (Qt) |
|---|---|---|---|
| Installer size | About 100 MB | About 10–20 MB | About 80–150 MB |
| Video playback | Same Chromium on every OS; H.264/AAC built in | System webview differs per OS; Linux WebKitGTK depends on GStreamer plugins | Qt Multimedia's FFmpeg backend plays nearly everything |
| Languages | One (TypeScript for UI and orchestration) | Two (TS UI + Rust core) | One (Python) |
| UI building speed | Fast (React ecosystem) | Fast UI, slower core | Slower for polished custom UI |
| Memory use | Higher | Lowest | Medium |
| Packaging and auto-update | Mature (electron-builder) | Mature | Hardest (PyInstaller/Nuitka plus per-OS issues) |

**Why A:** this app is video-heavy (previews, trimming, subtitle preview), and Electron gives identical video behavior on all three OSes. One language for UI and orchestration also suits a small team. The 100 MB installer is still "lightweight" next to multi-GB models.

B is the right choice if installer size and RAM matter more than consistent playback. C would only make sense if we went back to PyTorch-based models.

## 5. Process architecture

```text
┌─────────────────────────────┐
│ UI (Electron renderer)      │  React. Never does heavy work.
└──────────────┬──────────────┘
               │ IPC (typed messages)
┌──────────────▼──────────────┐
│ Orchestrator                │  Electron utility process (Node).
│  - job queue + scheduler    │  SQLite: jobs, stage runs, media
│  - model/component manager  │  sources, candidates, settings.
│  - hardware diagnosis       │
│  - candidate scoring        │
└───┬─────────┬─────────┬─────┘
    │         │         │   child processes, argument arrays (no shell)
┌───▼───┐ ┌───▼────┐ ┌──▼──────────┐ ┌──────────────┐
│ffmpeg │ │whisper │ │llama-server │ │onnx worker   │
│       │ │ .cpp   │ │             │ │(VAD, events, │
└───────┘ └────────┘ └─────────────┘ │ faces; later)│
                                     └──────────────┘
```

Why the engines run as separate processes:

- **Crash isolation.** A GPU out-of-memory crash or driver fault kills only that engine. The job is marked failed at that stage and can be retried.
- **Swappable backends.** Moving from the CUDA build to the Vulkan build swaps a folder. Nothing gets recompiled.
- **Reliable cancellation.** Cancelling a job stops the engine process and cleans up partial outputs.
- **Accurate progress.** Engines report real progress (whisper.cpp reports processed audio time, FFmpeg reports processed frames). Stages that can't measure progress show an indeterminate state.

The orchestrator runs in its own utility process, not Electron's main process, so heavy JavaScript work can't freeze the window.

## 6. Component and model downloads

- **Signed manifest.** One manifest file lists every downloadable item: FFmpeg builds, engine builds per OS/architecture/backend, GPU runtime libraries, and models. Each entry has its URL, size, SHA-256, license, version, and requirements.
- **Pinned and self-hosted where possible.** Entries are pinned to exact versions and checksums, and app updates can ship a new manifest. Hosting artifacts on our own release storage avoids depending on upstream files staying put.
- **Install steps match the states in [AI_MODELS.md](AI_MODELS.md):** download → verify checksum → unpack → **validate by running a probe** → installed. A model or engine that fails validation is never marked installed.
- **Default storage locations (all configurable):**
  - Windows: models and cache in `%LOCALAPPDATA%\Siftora\`, config in `%APPDATA%\Siftora\`.
  - macOS: `~/Library/Application Support/Siftora/` and `~/Library/Caches/Siftora/`.
  - Linux: the XDG data, cache, and config directories.

## 7. Moment discovery (MVP approach)

This is the product's core, so the method is specified up front:

1. **Number the transcript.** Each transcript segment gets a stable ID with start/end times in milliseconds.
2. **Use overlapping windows.** The LLM reads windows of about 5–8 minutes, with 1–2 minutes of overlap so a setup and its payoff aren't split. Window size adapts to the model's context length.
3. **Constrain the output.** The LLM must return JSON matching a schema, which `llama-server` enforces. Each result has `start_segment_id`, `end_segment_id`, `category`, `hook`, a short `rationale`, and 1–5 rubric scores (hook, payoff, standalone context, entertainment/information value). **The LLM never outputs timestamps**; times come from the segment IDs, so they can't be invented.
4. **Refine deterministically.** Code (no LLM) then:
   - snaps boundaries to sentence ends and pauses, using word timings and VAD;
   - enforces the duration limits;
   - merges overlapping candidates from neighboring windows;
   - adds audio/visual evidence when those analyzers are installed. Missing signals are not penalties; see [VIRAL_SCORING.md](VIRAL_SCORING.md).
5. **Re-rank (optional).** The LLM compares the top candidates in pairs. This gives a more stable order than 0–100 scores from a small model.
6. **Run as stages.** The user clicks **Analyze Video** once. Inside, transcription and discovery are separate cached stages, and **Find moments again** reruns only discovery with new settings.

## 8. Rendering and previews

- **Subtitles:** generated as ASS files and burned in by FFmpeg (libass). That supports fonts, colors, outline, shadow, background boxes, word highlighting, and safe-area positioning.
- **Exact subtitle preview:** the preview image is rendered by the same FFmpeg + ASS path as the final export, from a frame of the user's video (debounced while sliders move). The preview matches the export exactly. A built-in sample image is used when no video has been imported yet.
- **Layouts as FFmpeg filter graphs.** Blurred background for 9:16:
  `split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
  Focused/manual crop is a `crop` filter driven by a position the user sets (later, a face-tracking path).
- **Encoding:** uses the fastest working hardware encoder found during diagnosis (NVENC / QSV / AMF / VideoToolbox / VAAPI), with a software fallback.
- **Playback of any source:** the review screen plays low-resolution H.264 proxies from the cache. Sources in HEVC, ProRes, MKV, etc. still play in Chromium. Proxies are derived cache files, never copies of the original, so this fits [VIDEO_STORAGE.md](VIDEO_STORAGE.md).

## 9. Licensing notes

- **Default models:** MIT/Apache-2.0 (Whisper, Qwen-family LLMs, Silero, YAMNet). Llama-family models are allowed as options, but their license requires attribution and has usage terms. Gemma has a prohibited-use policy. The catalog shows each license, and restrictive ones are never the default.
- **App license: GPL-3.0.** All app dependencies must be GPL-3.0-compatible (MIT, BSD, Apache-2.0, LGPL, and GPL-3.0 are fine; GPL-2.0-only code is not).
- **FFmpeg:** because the app is GPL-3.0, it can ship a **GPL FFmpeg build that includes libx264** as the software H.264 encoder, alongside hardware encoders. Distributing that build requires making its matching source available (e.g. linked from the release page).
- **H.264/AAC patents:** hardware encoders and OS codecs are typically covered by the platform vendor. Get a legal review before any commercial release.
- **Source content:** the app doesn't check whether the user has the rights to republish a video. A short notice at export is enough. This is another reason to defer YouTube import.

## 10. Changes to the development plan

1. **Quality question: already answered.** An earlier prototype (Python openai-whisper + Ollama qwen3:14b) rated about 80% of its clips as good on a 25-minute group game-show video. That's enough to build the app. The lessons from it are in §11. [spike/find-clips.ts](../../spike/find-clips.ts) stays as a reference for the segment-ID discovery approach.
2. **Phase 2 (hardware diagnosis)** follows §3: detect, probe, benchmark, recommend.
3. **Phase 3 (downloads)** covers engines, GPU runtimes, and FFmpeg, not only model weights.
4. **YouTube import** moves to after Phase 11 as an optional feature.
5. **Forced alignment** (accurate per-word timing when the transcriber's word timing is weak) is listed as an optional capability for word-by-word subtitles.

## 11. Lessons from the AutoShorts prototype

These are requirements for the app, taken from the prototype's output:

| Problem seen | Requirement |
|---|---|
| Starts were moved onto the hook line, cutting the setup (e.g. the quiz question) | Clips keep their setup. Optional **hook teaser**: show 1–2 s of the peak moment first, then play from the setup. |
| Most hooks were exclamations or swearing ("oh fuck", "oh my god"): with text only, the LLM treats profanity as energy | Prompt penalizes exclamation-only hooks. Audio evidence (laughter, loudness) confirms a moment landed. A named payoff is required. |
| Payoff text described an answer that wasn't in the clip | The LLM picks segment IDs, never times or quotes. Hook and payoff text are checked against the clip's transcript, and mismatches are flagged or rejected. |
| Whisper repetition loops ("that's a, that's a, that's a") during overlapping speech | VAD before transcription, no conditioning on previous text, re-decode segments with a high compression ratio. |
| Low-scored clips ("low energy") were still rendered | A minimum score threshold. Weaker candidates are shown collapsed, not exported by default. |
| Wide shots in blurred-background layout made people tiny | A **zoom** control that crops the sides (16:9 → 4:3 / 1:1) in the first release. Per-shot auto framing (face crop on close-ups, full frame on wide shots) later. |
| Small title and captions; profanity in on-screen titles | Bold boxed title style, larger default captions, optional profanity masking for titles and captions. |
| Manual iteration across many candidate versions | **Find moments again** reruns discovery only. Useful / not-useful marks build a local evaluation set for prompt and model changes. |
| Users may already have models in Ollama | Onboarding detects existing Ollama GGUF models and offers to use them in place instead of re-downloading. |

## 12. Open questions

1. **Code signing** is needed for a smooth install even for a free app: Apple notarization (USD 99/year developer account) and a Windows code-signing certificate. Free signing for open-source projects is available through programs such as SignPath Foundation.
