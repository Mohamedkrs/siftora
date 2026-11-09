# Development Plan

## Working method

Implement in small, reviewable milestones. At the start of each milestone:
1. Inspect the current repository and relevant tests.
2. Confirm scope and dependencies.
3. Explain design choices and trade-offs.
4. Implement only the approved milestone.
5. Run tests and provide a concise change summary.
6. Update documentation.

Do not build the entire product in one pass.

## Phase 0 — Repository and architecture assessment

- Inspect repository, language, framework, build system, and existing conventions.
- Identify desktop packaging options compatible with the current stack.
- Identify media-processing and inference integration constraints.
- Propose module boundaries, data flow, storage strategy, and test strategy.
- Produce architecture decision records for major choices.

**Acceptance:** architecture and milestone plan reviewed and approved before feature implementation.

## Phase 1 — Desktop shell and navigation

- Create application shell and navigation.
- Add onboarding flow and settings placeholders only where clearly marked as unfinished.
- Add theme, error boundary, logging foundation, and app configuration.
- Keep UI responsive.

**Acceptance:** app launches, navigation works, configuration persists, no fake completed features.

## Phase 2 — Hardware diagnostics

- Detect CPU, RAM, GPU, disk space, FFmpeg, and inference backends.
- Verify usable GPU execution with a safe runtime test.
- Report limitations and CPU fallback.
- Add automated tests around capability parsing.

**Acceptance:** diagnostic report distinguishes GPU presence from usable acceleration.

## Phase 3 — Model registry and downloads

- Define model metadata schema.
- Implement model catalog, license/source/version metadata.
- Implement download, progress, retry, cancellation, checksum verification where available.
- Add storage location configuration and model lifecycle controls.

**Acceptance:** models are not marked installed until verified and runtime validation succeeds.

## Phase 4 — Media import and storage

- Add drag/drop and file picker.
- Read media metadata and create thumbnails.
- Store original absolute path references only.
- Add source availability checks and relinking.
- Implement separate cache and output directories.

**Acceptance:** importing a file does not copy or modify the original. Tests verify path persistence and missing-source handling.

## Phase 5 — Job queue and pipeline orchestration

- Define job states and stage states.
- Add persistent queue.
- Implement background execution, cancellation, retries, and recovery.
- Add resource-aware scheduling.

**Acceptance:** jobs survive restart as metadata; source/model validation occurs before resuming.

## Phase 6 — Transcription

- Integrate one selected transcription backend through an adapter.
- Produce timestamped transcript.
- Persist results and show transcript in UI.
- Add transcript editing and invalidation rules.

**Acceptance:** transcript timestamps map to source media timeline; no invented word timestamps.

## Phase 7 — Candidate discovery and review

- Build transcript chunking/context logic.
- Integrate local LLM or deterministic baseline.
- Produce candidate timestamps, rationale, and evidence.
- Add review list and preview.
- Add boundary editing and duplicate suppression.

**Acceptance:** user can inspect why a moment was selected and adjust boundaries.

## Phase 8 — Subtitle and clip rendering

- Implement subtitle styling and presets.
- Implement 9:16, 16:9, and 1:1 output.
- Add blurred background and manual crop.
- Render clips to a separate output directory.

**Acceptance:** output is playable, subtitles are synchronized, originals are unchanged.

## Phase 9 — Audio intelligence

- Add VAD and optional diarization.
- Add sound-event detection for laughter, applause, cheering, shouting, crying, etc.
- Add optional pitch and vocal-intensity features.
- Normalize analyzer outputs into common timestamped events.

**Acceptance:** audio events are visible as evidence and influence scoring only according to configured weights.

## Phase 10 — Visual intelligence

- Add scene detection.
- Add optional person/face and reaction analysis.
- Add subject-aware reframing only when the relevant model is installed and confidence is sufficient.

**Acceptance:** graceful fallback to manual/center crop when tracking is unavailable.

## Phase 11 — Hardening and release

- Test long videos, corrupt files, removable drives, insufficient disk, model download failure, and GPU memory pressure.
- Add diagnostics/exportable logs.
- Review model licenses and third-party notices.
- Test packaging and clean installation.
- Document privacy behavior and supported platforms.

**Acceptance:** clean install works without preinstalled model weights; optional models can be installed later.
