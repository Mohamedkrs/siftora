<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/brand/siftora-horizontal-on-dark.svg">
    <img src="resources/brand/siftora-horizontal.svg" alt="Siftora" height="72">
  </picture>
</p>

<p align="center"><strong>Sift your long videos for the moments worth sharing.</strong></p>

<p align="center">
  <a href="../../releases/latest/download/Siftora-Setup.exe"><img src="resources/brand/download-windows.svg" alt="Download for Windows" height="60"></a>
</p>

Siftora is a free desktop app that turns long videos (podcasts, streams, interviews, vlogs) into vertical clips for TikTok, Instagram Reels and YouTube Shorts. It transcribes the video, finds the moments with a hook, a setup and a payoff, and renders them as 1080×1920 reels with animated captions.

Everything runs on your own computer. Your videos and transcripts are never uploaded.

## Features

- **Finds the moments for you.** A local AI model reads the whole transcript and picks clips with a real payoff, scored and explained. It is told to start where the setup starts, not to treat swearing as a hook, and to quote the payoff word for word, so clips are not cut off or invented.
- **Accurate captions.** Word-by-word timing from Whisper, voice detection so silence and music do not turn into made-up lines, and four caption fonts with an optional highlight on the spoken word.
- **Hears the room.** Optional reaction detection picks up laughter, applause and cheering, and YouTube's "Most replayed" graph gives a boost to the parts viewers rewatch.
- **Colour per speaker.** Optional speaker detection gives each person their own caption colour.
- **Review fast.** Filter moments by topic (funny, emotional, educational…), heart the keepers, delete the rest in one click, and nudge a clip's start and end.
- **Preview before you render.** Pick the caption style and layout on a real frame of your clip, drag the captions where you want them (or turn them off), then render one reel or all of them.
- **Ready to post.** Each rendered reel comes with a title, description and hashtags per platform.
- **Uses what you already have.** Finds Ollama, Python Whisper, FFmpeg and model files on your computer, so you download as little as possible.
- **Files or links.** YouTube, Facebook, TikTok, X, Instagram and the many other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports. Clip length and score limits can be set for all videos or per video.

## Requirements

- **Windows 10 or 11, 64-bit.** macOS and Linux builds exist but are not ready yet; see [Platforms](#platforms).
- **8 GB of RAM** at least. 16 GB or more is better.
- **An NVIDIA graphics card is strongly recommended.** It makes Siftora 5–10 times faster. Other graphics cards work through Vulkan, and any computer works on the CPU, more slowly.
- **3–12 GB of free disk space** for the engines and AI models, depending on which you choose.

## Install

1. Click **Download for Windows** above, or pick a version on the [Releases](../../releases) page.
2. Run it. Windows may show "Windows protected your PC", because the app is not code-signed yet: choose **More info → Run anyway**.
3. On first start, Siftora checks your hardware, recommends models that fit it, and shows what it found already on your computer. Then it downloads what is missing.

## How to use it

1. **Create:** drop in a video or paste a link, then **Find clips**.
2. **Queue:** follow the progress. Finished steps are saved, so a retry does not start over.
3. **Results:** review the clips by score, pick a caption style and layout, and render the reels. They are saved in `Videos\Siftora`.

Age-restricted or members-only videos need your sign-in: in **Settings → Video links**, choose the browser you are signed in with (Firefox works best; Chrome-based browsers must be closed) or load a `cookies.txt` file. Siftora only uses it when a site asks for it.

Scores are estimates to help you choose. They do not guarantee that a clip will do well.

## Privacy

- Your videos, transcripts and clips **never leave your computer**. There is no account, no tracking and no analytics.
- Siftora goes online only to download its engines and AI models (from GitHub and Hugging Face), to check for engine updates, and to download the videos you add by link.
- If you choose a sign-in for video links, your browser's cookies (or your `cookies.txt`) are passed to yt-dlp on your computer, and only sent to the site of the video.
- What you do with found moments (hearts, deletes, trims, renders) is written to `feedback.jsonl` in the app's data folder, so you can measure how good the picks are. It stays there.
- If you point Ollama at another computer (its `OLLAMA_HOST` setting), transcripts are sent to that computer for the clip-finding step.

## Removing Siftora

- **Windows:** uninstall it from **Settings → Apps**. You are asked whether to also delete the downloaded models and settings.
- **Any system:** **Settings → Storage** in the app shows how much space it uses and can delete the engines and models, or remove all its data before you delete the app.

Your rendered reels are never deleted by either.

## Platforms

| | Windows | Linux | macOS |
|---|---|---|---|
| Status | Tested | Should work, untested | Not ready yet |
| Fast transcription | NVIDIA GPU | CPU only for now | Needs our own build (planned) |

## Building from source

```sh
npm install
node node_modules/electron/install.js   # npm 11 blocks Electron's own install script
npm run dev
```

Also available: `npm run typecheck`, `npm run build`, and `npm run dist` to build the installer into `release/`. If Electron starts as plain Node from a VS Code terminal, unset `ELECTRON_RUN_AS_NODE`.

The app is Electron, React and TypeScript. The work happens in `src/main/pipeline`: transcription (`transcribe.ts`), speaker detection (`speakers.ts`), reaction detection (`reactions.ts`), finding moments (`discover.ts`) and rendering (`render.ts`).

### Measuring the picks

`npm run eval` reads `feedback.jsonl` and reports, per AI model and finder version: precision@3/5/10 (share of the top moments you kept), acceptance, how far you moved the start and end, and duplicates. Only videos you reviewed count. Bump `FINDER_VERSION` in `discover.ts` whenever you change the prompt, so versions can be compared. Options: `npm run eval -- path/to/feedback.jsonl --k 3,5`.

### Releasing

1. Set the new version in `package.json` and commit it.
2. Open **Actions → Release → Run workflow** and choose what to do:
   - **Only build:** builds the installer as a download on the run, without releasing anything.
   - **Draft release:** builds it and creates a draft release. Review it, add notes and publish it yourself.
   - **Publish release:** builds it and publishes the release right away.
3. Once published, the **Download for Windows** button serves the new version.

[.github/workflows/release.yml](.github/workflows/release.yml) builds on a clean Windows machine. Publishing from the workflow creates the version tag, so if a tag ruleset protects `v*` tags, it must allow creating them (keep updates and deletions restricted); a draft creates no tag until you publish it. Pushing a matching tag (`git tag v0.2.0`, then `git push --tags`) also makes a draft.

### Engine updates

Engines are downloaded on demand, never bundled. Besides the built-in list in `src/shared/engines.ts`, the app reads a tested list, `engines.json`, from this repository's `engines` release, and offers an **Update** on the Models screen when a newer tested version exists.

[.github/workflows/engines.yml](.github/workflows/engines.yml) keeps that list current for Windows: on demand, or weekly once the repository variable `ENGINES_WEEKLY` is set to `true`, it picks up a new whisper.cpp release, smoke-tests the Windows build with the app's own settings ([scripts/engines/smoke-whisper.mjs](scripts/engines/smoke-whisper.mjs)), and publishes only if that passes. To enable it, set `ENGINE_REPO` in `src/shared/engines.ts` to this repository's `owner/repo` and run the workflow once from the Actions tab.

The original design notes are in [docs/planning](docs/planning).

## Contributing

Bug reports, ideas and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md). Please report security problems privately, as described in [SECURITY.md](SECURITY.md).

## License

Siftora is free software under the [GNU GPL v3](LICENSE).

The Siftora name and logo are not covered by the GPL. You are welcome to fork and modify Siftora under its license, but please give a modified version that you publish its own name and logo, so people can tell it apart from the original. Using the name to refer to Siftora itself, for example in a review or tutorial, is fine.

It builds on [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT), [FFmpeg](https://ffmpeg.org) (GPL), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache 2.0), [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), OpenAI's Whisper models (MIT), the CED audio tagger (Apache 2.0), Qwen models (Apache 2.0), Silero VAD (MIT), and the caption fonts listed in [resources/fonts](resources/fonts/README.md) (SIL Open Font License). The engines and models are downloaded from their publishers when you need them.
