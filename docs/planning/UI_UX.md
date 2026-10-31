# UI/UX Specification

## 1. Product experience

The interface should be approachable for non-technical users while exposing advanced model and processing controls when needed. The primary workflow should be simple: import, configure, analyze, review, export.

## 2. Main navigation

Suggested navigation:
- **Create** — import and configure videos.
- **Queue** — current and pending processing jobs.
- **Results** — completed analyses and candidate clips.
- **Models** — installed models and downloads.
- **Settings** — hardware, storage, defaults, diagnostics.

A compact queue indicator should remain visible from the main workspace.

## 3. Onboarding

### Welcome
Explain local-first processing and that models are downloaded separately.

### System check
Show CPU, RAM, GPU, usable acceleration backend, disk space, FFmpeg status, and any warnings.

### Capability selection
Group capabilities by transcription, speaker analysis, audio intelligence, visual intelligence, and LLM reasoning. Clearly label recommended, optional, and unavailable choices.

### Download
Show per-model progress and total progress. Explain required disk space and allow cancellation.

Users should be able to skip optional capabilities and revisit model setup later.

## 4. Create screen

Import methods:
- Drag-and-drop.
- Browse local files.
- Paste supported YouTube URL.

For each selected item show thumbnail, filename, duration, resolution, file size, and source availability.

Do not copy source media during import. Make it clear that the app references the original location.

## 5. Output setup

Provide simple presets for:
- Vertical 9:16.
- Landscape 16:9.
- Square 1:1.

For vertical:
- Blurred background.
- Focused/manual crop.

Subtitle controls should be grouped into readable sections. Include live preview and save-preset action. Avoid exposing dozens of advanced controls by default; place less common controls under Advanced.

## 6. Analyze action

Use one prominent **Analyze Video** action. The user should not need to start transcription, audio analysis, and moment detection separately.

Show which optional analysis capabilities will run, so users understand what their selected models enable.

## 7. Queue screen

Each job should show:
- Thumbnail and filename.
- Status.
- Current stage.
- Progress or indeterminate indicator.
- Estimated time only when supported by actual measurements.
- Cancel/retry/remove actions as appropriate.

Do not show a misleading percentage when the underlying stage cannot report progress.

## 8. Results screen

Use a candidate list or grid with:
- Video preview.
- Candidate title and short rationale.
- Duration and timestamps.
- Score and evidence breakdown.
- Transcript excerpt.
- Audio/visual event indicators when available.

Provide a detail editor with:
- Start/end trim controls.
- Playback preview.
- Transcript/subtitle editing.
- Crop positioning.
- Subtitle style.
- Render/export action.

## 9. Empty, error, and loading states

Design clear states for:
- No videos imported.
- No models installed.
- Source file unavailable.
- Unsupported/corrupt video.
- Model download failed.
- GPU unavailable.
- Insufficient disk space.
- Analysis failed at a specific stage.
- No candidate moments found.

Every error should explain what happened and provide a practical next action where possible.

## 10. Accessibility and usability

- Keyboard-accessible controls.
- Clear focus states.
- Readable contrast.
- Scalable text and layout.
- Avoid color as the only status indicator.
- Use plain-language explanations for technical terms.
- Preserve user settings and last-used directories.
