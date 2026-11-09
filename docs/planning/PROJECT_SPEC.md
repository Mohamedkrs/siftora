# Project Specification — Siftora (local AI clip finder)

## 1. Product overview

Build a desktop application that analyzes long-form video and finds potentially engaging moments that can be edited into short-form videos for TikTok, Instagram Reels, and YouTube Shorts.

The application must prioritize local processing. Imported video and audio, transcripts, intermediate analysis, and generated clips should remain on the user's machine by default. No mandatory cloud AI service and no required media upload.

The app starts lightweight. Large AI models are not bundled with the installer; users select and download capabilities during onboarding or later in Settings.

The application must be modular, maintainable, hardware-aware, and extensible.

## 2. Core user journey

1. Install and launch the lightweight application.
2. Complete a hardware/system check.
3. Select desired AI capabilities and compatible models.
4. Download selected models with visible progress.
5. Import local videos or provide a supported YouTube URL.
6. Choose output layout and subtitle styling.
7. Start one analysis job with a single **Analyze Video** action.
8. Monitor processing stages and queue.
9. Review, edit, and rank candidate clips.
10. Render and export selected clips.

## 3. Installation and onboarding

### 3.1 Lightweight installation

- Do not bundle large model weights in the installer.
- Include only the application and essential runtime components.
- Clearly communicate additional disk space needed for selected models.
- Keep application installation, model storage, cache, and output directories separate.

### 3.2 Hardware and system check

Inspect and report:

- Operating system and architecture.
- CPU model and logical core count.
- Total and available system RAM.
- GPU model(s) and dedicated/shared memory where available.
- Whether the intended GPU compute backend is actually usable.
- CUDA/runtime and driver compatibility where relevant.
- Available disk space for models, cache, and outputs.
- FFmpeg availability and supported codecs.
- Relevant runtime/dependency status.

Do not infer CUDA usability merely from the presence of an NVIDIA GPU. Run a safe capability check using the selected inference runtime. Provide CPU fallback where supported.

Show a clear report with compatible, limited, and unavailable capabilities. Explain actionable fixes without claiming unsupported compatibility.

### 3.3 Model and capability selection

Group optional capabilities by function:

**Speech transcription**
- Timestamped speech-to-text.
- Language identification where supported.
- Word-level timestamps when available.

**Voice and speaker analysis**
- Voice activity detection (VAD).
- Speaker diarization.
- Optional speaker embeddings or speaker matching.
- Do not imply that diarization identifies a real person's identity.

**Audio events and vocal delivery**
- Laughter, applause, cheering, shouting, screaming, crying, and other supported sound events.
- Vocal intensity and delivery changes.
- Excitement or emotion estimates, clearly labeled as uncertain model predictions.
- Dramatic pauses and overlapping speech.
- Optional pitch/F0 analysis.

**Visual analysis**
- Scene/shot boundary detection.
- Face/person detection where appropriate.
- Active-speaker or reaction analysis if supported.
- Visual activity and movement signals.

**Language model**
- Transcript/context analysis for candidate moment discovery.
- Hardware-compatible local model recommendations.
- Avoid requiring an LLM for tasks better handled by dedicated models or deterministic algorithms.

For each model show:
- Name and provider.
- Functionality.
- Download size.
- Approximate runtime memory requirements.
- Supported CPU/GPU backends.
- Language/support limitations.
- License and usage restrictions.
- Source and version/checksum when available.
- Whether it is required or optional.

Users can skip optional models. The app must still work with a minimal configuration.

### 3.4 Model downloads and lifecycle

- Show per-model and overall progress.
- Show download size, bytes downloaded, speed, and estimated time when reliable.
- Support retry and cancellation.
- Support pause/resume only when the download mechanism reliably supports it.
- Verify integrity using published checksums or signatures when available.
- Handle network interruption and insufficient disk space.
- Do not mark a model installed until verification and runtime validation succeed.
- Allow install, update, remove, and select-default actions in Settings.
- Never delete a model currently in use by a running job.

## 4. Media import

Support:
- Drag-and-drop local files.
- File picker import.
- Multiple local files and recordings.
- YouTube URL input, subject to platform rules, access restrictions, and tool support.

For local media, display:
- Thumbnail.
- Filename.
- Duration.
- Resolution.
- Frame rate.
- File size.
- Source path or a shortened path.

Validate supported formats and report unsupported/corrupt files clearly. Do not silently transcode or duplicate original files during import.

### 4.1 Original file handling

Imported videos must be processed from their original file locations.

- Store a reference to the original absolute path; do not copy the original media into the application directory.
- Do not modify, rename, move, or overwrite original media.
- Do not duplicate original media as part of import or queueing.
- Re-check source availability before processing and when resuming a persisted job.
- If a file is moved, renamed, disconnected, or deleted, mark the source unavailable and let the user relink it.
- Treat removable drives and network locations as potentially unavailable.
- Do not assume a path remains valid forever.
- Where possible, record file size, modification time, and a lightweight identity fingerprint to detect a changed file at the same path. Do not hash huge files synchronously on the UI thread.

## 5. Output configuration

### 5.1 Aspect ratios

Support:
- 9:16 vertical.
- 16:9 landscape.
- 1:1 square.

Allow output resolution and frame rate to be configured where supported.

### 5.2 Portrait layouts

Provide:
- **Blurred background:** fill the canvas with a blurred enlarged copy of the source while fitting the full source frame in front.
- **Focused crop:** crop/reframe around a selected subject or active speaker when reliable tracking is available.
- **Manual positioning:** let the user adjust framing and position.

If subject tracking is unavailable or uncertain, provide a sensible centered/manual fallback. Do not imply active-speaker tracking is available unless the relevant capability is installed and working.

### 5.3 Subtitle styling

Allow configuration of:
- Font family and size.
- Text color and active-word highlight color.
- Background color and opacity.
- Outline and shadow.
- Screen position and safe margins.
- Word-by-word or sentence-based display.
- Animation style where supported.

Provide a live preview and saveable presets. Ensure text remains readable on mobile and does not overlap platform UI safe areas.

## 6. Analysis workflow

The user should trigger analysis with one primary action: **Analyze Video**. Internally, the app runs a staged, modular pipeline and skips optional stages whose models are not installed or enabled.

Stages:

1. Media validation and preparation.
2. Audio extraction / decoding.
3. Speech transcription.
4. Optional VAD and speaker diarization.
5. Optional audio event and vocal delivery analysis.
6. Optional visual scene/person/reaction analysis.
7. Candidate moment detection and scoring.
8. Clip boundary refinement.
9. Candidate review.
10. Rendering and export.

Transcription and moment discovery should be one user workflow, not two mandatory user actions. Internally they remain separate stages so results can be inspected, retried, cached, or reused.

### 6.1 Transcription

- Produce timestamped transcript segments.
- Preserve word timestamps when the model supports them.
- Include language and confidence metadata when available.
- Support transcript correction by the user.
- Keep source timestamps aligned with the original media timeline.
- Do not fabricate word-level timestamps if the model only returns segment-level timing.

### 6.2 Speaker analysis

When enabled:
- Detect speaker turns.
- Assign stable speaker IDs within the media item.
- Associate transcript segments with speakers when possible.
- Represent unknown/overlapping speakers explicitly.
- Avoid claiming biometric identity.

### 6.3 Audio analysis

When enabled, detect supported events such as:
- Laughter.
- Applause and cheering.
- Shouting or screaming.
- Crying.
- Other relevant non-speech events.
- Sudden changes in loudness or vocal intensity.
- Pitch/F0 movement.
- Pauses, interruptions, and overlapping speech.

Return timestamped events with confidence values and model provenance. Distinguish acoustic measurements (such as loudness or pitch) from inferred emotions. Emotion labels are uncertain and must not be treated as objective facts.

### 6.4 Visual analysis

When enabled:
- Detect scene/shot boundaries.
- Detect people/faces where appropriate.
- Estimate visual activity and reactions where supported.
- Associate visual observations with timestamps.
- Use conservative fallbacks when detection confidence is low.

### 6.5 Candidate discovery

Find potentially engaging, self-contained moments using combined evidence:
- Interesting or surprising statements.
- Humor and jokes.
- Strong opinions or debate.
- Emotional storytelling.
- Unexpected revelations.
- Audience reactions.
- Useful explanations or facts.
- Curiosity hooks and questions.
- Strong narrative setup and payoff.
- Audio events and changes in delivery.
- Visual activity or reactions.

Audio/visual events are supporting signals; laughter alone must not automatically create a clip. A candidate should make sense in context.

## 7. Clip boundary refinement

For every candidate:
- Select a start and end time.
- Include enough setup and payoff to understand the moment.
- Avoid cutting words, sentences, or meaningful reactions.
- Respect configurable minimum and maximum durations.
- Avoid duplicate and excessively overlapping candidates.
- Prefer natural speech boundaries.
- Let users adjust start and end timestamps before export.

Do not guarantee virality. Describe scores as estimates of potential engagement, not predictions of actual views or performance.

## 8. Results and review

Display candidate clips with:
- Preview.
- Start/end timestamps and duration.
- Engagement-potential score.
- Short title/description.
- Transcript excerpt.
- Speaker IDs, if available.
- Detected audio/visual events, if available.
- Explanation of why the candidate was selected.
- Confidence or evidence quality where meaningful.

Users can:
- Preview and compare candidates.
- Edit clip boundaries.
- Correct transcript and subtitles.
- Change crop and positioning.
- Change subtitle preset.
- Re-render one clip.
- Export selected clips or all clips.
- Remove unwanted candidates.

All generated clips remain editable until export.

## 9. Progress and job queue

Show:
- Current job and current stage.
- Overall progress when it can be calculated honestly.
- Stage-level progress when available.
- Completed, pending, failed, paused, and cancelled jobs.
- Useful errors and retry actions.

Allow users to add videos while another is processing. Queue requirements:
- Persist job metadata and source paths.
- Remove pending jobs.
- Cancel active jobs safely.
- Reorder pending jobs.
- Resume/recover after application restart where safe.
- Revalidate source files and model availability on restart.
- Avoid concurrent GPU-heavy inference by default.
- Make concurrency configurable only when resource limits are understood.

Progress must reflect actual work. Do not use fake timers or arbitrary percentage increments. If a stage cannot report percentage, show an indeterminate progress state and stage status.

## 10. Storage and privacy

Keep separate configurable locations for:
- Application configuration/database.
- Downloaded models.
- Temporary cache and intermediate files.
- Exported clips.

Temporary files may include extracted audio, thumbnails, sampled frames, analysis artifacts, and render intermediates. Clean them when safe, and offer a cache-management screen.

Generated outputs must never overwrite originals. Ask before overwriting an existing generated output.

No media upload or telemetry containing media content by default. Clearly disclose any optional external service or network operation, including YouTube retrieval and model downloads.

## 11. Settings

Include:
- Installed models and model versions.
- Model download/update/remove controls.
- Hardware/system report.
- CPU/GPU backend preferences.
- Cache and model storage locations.
- Output directory.
- Default aspect ratio and resolution.
- Default clip duration limits.
- Subtitle presets.
- Audio/visual analysis toggles.
- Queue and concurrency preferences.
- Logs and diagnostics.
- Privacy/network settings.

## 12. Engineering requirements

- Separate UI, orchestration, media processing, inference adapters, model management, storage, and rendering.
- Use background workers for long-running tasks.
- Keep the UI responsive.
- Use a common timestamped result schema for all analyzers.
- Make stages independently testable and cacheable.
- Support cancellation and safe cleanup.
- Avoid loading every model into VRAM simultaneously.
- Detect actual runtime backend capability.
- Support CPU fallback where available.
- Handle missing models and unsupported formats gracefully.
- Keep logs actionable and avoid logging sensitive media content unnecessarily.
- Pin and document dependencies.
- Document model licenses and redistribution constraints.
- Add automated tests for core logic and pipeline state transitions.

## 13. Non-goals and constraints

- Do not promise that a clip will go viral.
- Do not require cloud processing.
- Do not copy original videos into the app folder.
- Do not assume every YouTube URL is downloadable.
- Do not make optional models mandatory.
- Do not implement fake AI output or fake progress.
- Do not claim emotion or identity detection is objectively reliable.

## 14. Initial delivery

The first useful release should support:
1. Local video import by reference to original path.
2. Hardware check.
3. Model management for a minimal transcription + text-analysis setup.
4. Timestamped transcription.
5. Basic candidate moment discovery.
6. Candidate review and boundary editing.
7. Subtitle generation and clip rendering.
8. Queue visibility and safe job state handling.

Audio event detection, diarization, and visual analysis can follow as modular enhancements.
