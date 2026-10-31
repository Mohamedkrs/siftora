# Proposed Architecture

This is a technology-neutral starting point. Inspect the repository before choosing or replacing frameworks.

## 1. Architectural principles

- UI must not run heavy inference or media processing synchronously.
- Pipeline stages communicate through explicit inputs, outputs, and status events.
- Model integrations are adapters behind stable interfaces.
- Original media is referenced, not copied.
- Intermediate artifacts are stored separately and can be invalidated/rebuilt.
- Every analyzer emits a common timestamped evidence format.
- GPU resources are scheduled; do not load every model at once.

## 2. Logical components

### Desktop UI
Responsibilities:
- Onboarding and hardware report.
- Model selection and download status.
- Media import.
- Output configuration.
- Queue and progress display.
- Candidate review and export.

### Application service layer
Responsibilities:
- Use-case orchestration.
- Validation and user-facing errors.
- Job creation, cancellation, retry, and recovery.
- Settings and preferences.

### Job scheduler
Responsibilities:
- Persistent job state.
- Stage dependency graph.
- Resource-aware concurrency.
- Retry policy.
- Cancellation and recovery.

### Media service
Responsibilities:
- Probe media metadata.
- Decode/extract audio and frames.
- Generate thumbnails.
- Maintain source timeline mapping.
- Invoke rendering.

### Model manager
Responsibilities:
- Model catalog and metadata.
- Download and integrity verification.
- Install/update/remove.
- Runtime compatibility validation.
- Model loading/unloading coordination.

### Inference adapters
Suggested interfaces:
- `TranscriptionAnalyzer`
- `VoiceActivityAnalyzer`
- `SpeakerDiarizationAnalyzer`
- `AudioEventAnalyzer`
- `PitchAnalyzer`
- `SceneAnalyzer`
- `VisualSubjectAnalyzer`
- `MomentReasoningAnalyzer`

Each adapter should declare capabilities, requirements, versions, and supported input/output formats.

### Candidate scoring service
Responsibilities:
- Merge transcript, audio, and visual evidence.
- Generate candidate moments.
- Score candidates.
- Explain evidence and uncertainty.
- Deduplicate and refine boundaries.

### Storage service
Responsibilities:
- Persist configuration, jobs, model registry, analysis results, and output metadata.
- Keep model, cache, and output paths configurable.
- Never store source media copies as an import side effect.

## 3. Suggested data entities

### MediaSource
- `id`
- `original_path`
- `display_name`
- `duration_ms`
- `file_size_bytes`
- `modified_at`
- `identity_fingerprint` (optional, computed asynchronously)
- `availability_status`
- `metadata`

### Job
- `id`
- `media_source_id`
- `status`
- `created_at`
- `updated_at`
- `settings_snapshot`
- `current_stage`
- `error`

### StageRun
- `id`
- `job_id`
- `stage_key`
- `status`
- `progress` (nullable)
- `started_at`
- `completed_at`
- `error`
- `input_version`
- `output_reference`

### ModelInstallation
- `model_id`
- `version`
- `install_path`
- `status`
- `checksum`
- `license`
- `runtime_validation`

### TranscriptSegment
- `start_ms`
- `end_ms`
- `text`
- `speaker_id` (nullable)
- `confidence` (nullable)
- `word_timings` (nullable)

### EvidenceEvent
- `start_ms`
- `end_ms`
- `kind`
- `source` (transcript/audio/visual)
- `label`
- `confidence` (nullable)
- `measurements`
- `model_id`
- `description`

### CandidateClip
- `id`
- `media_source_id`
- `start_ms`
- `end_ms`
- `title`
- `summary`
- `transcript_excerpt`
- `score`
- `score_breakdown`
- `evidence_event_ids`
- `review_status`

## 4. Common analyzer output

All analyzer results should use source-relative milliseconds and identify provenance.

Example conceptual object:

```json
{
  "start_ms": 12500,
  "end_ms": 16800,
  "kind": "laughter",
  "source": "audio",
  "label": "group_laughter",
  "confidence": 0.91,
  "model_id": "audio-event-model",
  "measurements": {}
}
```

This is an illustrative schema, not a commitment to a specific serialization library.

## 5. Pipeline dependencies

Typical dependency flow:

```text
Media validation
      |
Audio/video preparation
      |
  +---+-------------------+
  |                       |
Transcription          Visual analysis
  |                       |
Speaker analysis       Scene/reaction events
  |
Audio event analysis
  +-----------+-----------+
              |
       Evidence aggregation
              |
       Candidate discovery
              |
       Boundary refinement
              |
          Review UI
              |
       Subtitle + render
```

Stages should be skipped cleanly when optional capabilities are disabled or unavailable.

## 6. Cache and invalidation

Cache results using stable identifiers derived from:
- Source identity/version.
- Stage implementation version.
- Model ID and version.
- Relevant settings.

If the source file changes, invalidate dependent analysis. If subtitle styling changes, do not rerun transcription. If a scoring weight changes, recompute scoring without rerunning media inference.

## 7. Resource management

- Use a central inference/resource manager.
- Estimate model memory before loading.
- Load models on demand.
- Unload or offload models between stages when appropriate.
- Prefer one GPU-heavy stage at a time by default.
- Expose CPU fallback.
- Handle out-of-memory errors with a clear recovery path.
- Do not promise performance based on GPU model name alone.

## 8. Security and privacy

- Treat imported media and URLs as untrusted input.
- Avoid shell command construction from filenames or URLs.
- Use safe subprocess argument arrays.
- Validate paths and output destinations.
- Do not expose local file paths unnecessarily in logs or UI.
- Do not transmit media content without explicit user action and disclosure.
