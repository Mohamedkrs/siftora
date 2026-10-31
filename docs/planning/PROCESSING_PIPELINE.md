# Processing Pipeline

## 1. User-facing workflow

The user imports a video, selects output preferences, and clicks **Analyze Video**. The application runs a staged pipeline in the background and reports progress.

Transcription and viral-moment discovery are one user workflow, but remain separate internal stages for retry, caching, and review.

## 2. Pipeline stages

### Stage 0 — Validate source
- Confirm path exists and is readable.
- Probe metadata and supported streams.
- Check disk space and output permissions.
- Confirm required models are installed.
- Detect source changes against previously cached identity metadata.

### Stage 1 — Prepare media
- Decode/probe with a media backend.
- Extract or stream audio as needed.
- Sample frames only when needed.
- Use temporary cache paths, never the application install directory for source copies.
- Preserve a mapping to original source timestamps.

### Stage 2 — Transcribe
- Generate timestamped transcript.
- Preserve model confidence and word timings when available.
- Store transcript and model provenance.

### Stage 3 — Optional speech/speaker analysis
- Run VAD if needed.
- Run diarization if enabled.
- Associate speaker IDs with transcript intervals where possible.

### Stage 4 — Optional audio intelligence
- Detect supported audio events.
- Calculate acoustic features such as pitch, loudness, speech rate, pauses, and overlap where appropriate.
- Return time intervals and confidence/provenance.

### Stage 5 — Optional visual intelligence
- Detect scene boundaries.
- Analyze people/reactions only if enabled.
- Return timestamped events and confidence.

### Stage 6 — Evidence aggregation
- Normalize all timestamps to source-relative milliseconds.
- Merge nearby events when appropriate.
- Preserve original evidence and provenance.
- Handle overlapping events.

### Stage 7 — Candidate discovery
- Identify promising transcript spans and event combinations.
- Include enough context around each moment.
- Produce a candidate summary and evidence references.

### Stage 8 — Scoring and boundary refinement
- Calculate score breakdown.
- Deduplicate candidates.
- Refine start/end to natural boundaries.
- Enforce configured duration limits.

### Stage 9 — Review
- Present candidates for user inspection.
- Allow edits before rendering.

### Stage 10 — Render
- Apply aspect ratio and crop.
- Apply subtitles and style.
- Render to configured output directory.
- Never overwrite source media.

## 3. Stage contract

Each stage should define:
- Stable stage key.
- Required inputs.
- Optional inputs.
- Required capabilities/models.
- Output schema.
- Progress reporting capability.
- Cancellation behavior.
- Retry behavior.
- Cache key/version.
- Resource estimate.

A stage may report numeric progress only when it can measure it. Otherwise show an indeterminate state.

## 4. Job states

Suggested job states:
- `queued`
- `validating`
- `running`
- `waiting_for_resource`
- `paused`
- `completed`
- `failed`
- `cancel_requested`
- `cancelled`
- `source_unavailable`

Persist state transitions. On restart, reconcile incomplete jobs rather than assuming a process continued.

## 5. Failure and retry behavior

- Record which stage failed and why.
- Preserve successful stage outputs.
- Retry only failed or invalidated stages when safe.
- Revalidate source and model availability before retry.
- Clean partial outputs after cancellation/failure where safe.
- Do not delete cached artifacts still referenced by another job.

## 6. Queue and resource scheduling

Default to one GPU-heavy inference stage at a time. The scheduler may allow CPU tasks or lightweight work concurrently if safe.

The queue should support adding new jobs while another runs. Pending jobs can be reordered or removed. Active jobs can be cancelled cooperatively.

## 7. Timestamp rules

Use one canonical internal unit, preferably integer milliseconds, relative to the original media timeline. Convert to/from backend time formats at adapter boundaries. Account for stream offsets and variable frame rates where relevant.

Never fabricate precise word timing from segment-only transcription output.
