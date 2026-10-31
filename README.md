# Siftora

Sift your long videos for the moments worth sharing.

A local-first desktop application that analyzes long-form videos and identifies promising short-form clips for TikTok, Instagram Reels, and YouTube Shorts.

Free and open source (GPL-3.0). Everything runs on your computer; no video or transcript is uploaded.

## What it does

1. Add videos (files or YouTube links) on **Create**, pick a layout (blurred background or cropped) and a caption style.
2. The app transcribes them (whisper.cpp, or OpenAI Whisper if you already have it), optionally detects speakers (sherpa-onnx), and an AI model (Qwen via llama.cpp, or your Ollama) picks moments with a hook, setup and payoff.
3. On **Results**, review the clips by score and render vertical 1080×1920 reels with karaoke captions (FFmpeg + libass).

On first start, onboarding checks your hardware (NVIDIA CUDA, Apple Metal, Vulkan or CPU), recommends models, and finds what you already have (Ollama, Python Whisper, FFmpeg, model files) so you download as little as possible.

## Running from source

```sh
npm install
node node_modules/electron/install.js   # npm 11 blocks Electron's own install script
npm run dev
```

`npm run typecheck`, `npm run build`, and `npm run dist` (installers via electron-builder) are also available. If you start it from a VS Code extension terminal and Electron behaves like plain Node, unset `ELECTRON_RUN_AS_NODE`.

The design and decisions are in [docs/PHASE0_PROPOSAL.md](docs/PHASE0_PROPOSAL.md).

## Engine updates

Engines (whisper.cpp, llama.cpp, FFmpeg, sherpa-onnx) are downloaded on demand, never bundled. The built-in list in `src/shared/engines.ts` is the fallback; the app also reads a tested list, `engines.json`, from this repo's `engines` release and offers an **Update** on the Models screen when an installed engine has a newer tested version (the old version is kept next to it).

That list is maintained by [.github/workflows/engines.yml](.github/workflows/engines.yml): weekly, or on demand, it picks up a new whisper.cpp release, builds the macOS versions upstream does not ship, smoke-tests every build with the app's own flags ([scripts/engines/smoke-whisper.mjs](scripts/engines/smoke-whisper.mjs)), and publishes only if all pass.

To turn it on, push the repo to GitHub, set `ENGINE_REPO` in `src/shared/engines.ts` to `owner/repo`, and run the workflow once from the Actions tab.

## Documentation

- [Project specification](PROJECT_SPEC.md) — product requirements and scope.
- [Development plan](DEVELOPMENT_PLAN.md) — milestones and acceptance criteria.
- [Architecture](ARCHITECTURE.md) — proposed application structure and engineering principles.
- [UI/UX](docs/UI_UX.md) — screens, workflows, and interaction requirements.
- [AI models](docs/AI_MODELS.md) — model categories, selection, compatibility, and lifecycle.
- [Processing pipeline](docs/PROCESSING_PIPELINE.md) — analysis stages and job lifecycle.
- [Viral scoring](docs/VIRAL_SCORING.md) — candidate detection and explainable scoring.
- [Video storage](docs/VIDEO_STORAGE.md) — original-file references, cache, outputs, and recovery.

## Important product principles

1. **Local-first:** user media and AI analysis remain on the user's machine by default.
2. **No source duplication:** imported videos are referenced by their original absolute paths and are not copied into the application folder.
3. **Modular AI:** optional analyzers can be installed independently.
4. **Hardware-aware:** recommend models based on actual runtime capability and available resources.
5. **Honest functionality:** never present mock analysis or fake progress as completed functionality.
6. **Human review:** AI suggestions are editable; scores estimate potential engagement and do not guarantee virality.

## Instructions for a coding agent

Read `PROJECT_SPEC.md` and all relevant documents before implementation. First inspect the existing repository and report its current structure, technology stack, and constraints. Then propose an architecture and phased implementation plan. Do not begin implementation until the user approves that plan.

Treat this documentation as product requirements, not permission to choose arbitrary technologies or introduce large dependencies without explaining their trade-offs.
