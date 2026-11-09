# AI Models and Capability Strategy

## 1. General strategy

Do not choose models solely by popularity. Evaluate accuracy, speed, memory use, supported languages, license, runtime support, maintenance, and ease of local installation.

Keep model integrations replaceable through adapters. The application should not depend on one model vendor or one inference runtime.

## 2. Capability categories

### Speech transcription
Produces timestamped words or segments. Evaluate language coverage, word timing quality, speed, CPU/GPU support, and memory use.

### Voice activity detection
Detects speech regions. It is not speaker identification and does not classify laughter or applause by itself.

### Speaker diarization
Groups speech turns by speaker within a recording. It does not establish a person's real-world identity. Overlapping speech and short turns can reduce reliability.

### Audio event detection
Classifies non-speech or environmental events such as laughter, applause, cheering, crying, and shouting. Verify the model's actual label taxonomy; do not promise labels it does not support.

### Pitch and vocal delivery analysis
Pitch/F0 is an acoustic measurement, not an emotion detector. It can help identify changes in vocal delivery but should be interpreted with context. Loudness, pitch, speech rate, pauses, and overlap are distinct signals.

### Emotion analysis
Emotion labels are probabilistic inferences and can be culturally, linguistically, and contextually unreliable. Make this optional and avoid presenting it as fact.

### Visual analysis
Scene detection can be relatively lightweight. Face/person detection, tracking, and visual-language models have different resource and privacy implications. Do not load a large visual model unless the user enables it.

### LLM reasoning
Use an LLM to reason over transcript excerpts and structured evidence, not necessarily raw full-length video. Chunk long transcripts, preserve timestamps, and provide surrounding context to avoid clips without setup or payoff.

## 3. Model catalog metadata

Every model entry should include:
- Stable model ID.
- Display name and provider.
- Capability tags.
- Version/revision.
- Download source.
- Download size.
- License and attribution requirements.
- Supported languages.
- Supported hardware backends.
- Estimated RAM/VRAM requirements.
- Quantization variants, if applicable.
- Input/output formats.
- Known limitations.
- Checksum/signature when published.
- Model card or documentation reference.

## 4. Hardware recommendations

Recommendations must be computed from detected system capabilities and model metadata. Consider:
- Available VRAM, not only total VRAM.
- System RAM.
- CPU capabilities.
- Backend and driver compatibility.
- Model precision/quantization.
- Concurrent model memory requirements.
- Disk space.

Show estimates as estimates. A successful runtime probe is stronger evidence than a GPU name lookup.

## 5. Installation lifecycle

Model states:
- Not installed.
- Queued for download.
- Downloading.
- Verifying.
- Installing.
- Validating.
- Installed.
- Update available.
- Failed.
- In use.

Downloads must be cancellable and retriable. Verify integrity where possible. Never load a partially downloaded model.

## 6. Runtime management

- Load models lazily.
- Avoid simultaneous loading of all selected models.
- Provide a memory-aware scheduler.
- Unload models when no longer needed, subject to performance trade-offs.
- Handle out-of-memory failures.
- Allow CPU fallback only when supported.
- Record model/runtime versions with analysis results for reproducibility.

## 7. Licensing and supply chain

Before adding a model:
- Review model and code licenses separately.
- Check commercial-use and redistribution conditions.
- Preserve required attribution.
- Use official or trusted download sources.
- Pin revisions where possible.
- Avoid downloading executable code from untrusted sources.
- Document model provenance and known limitations.

## 8. Initial model strategy

Start with one reliable transcription integration and one local text-reasoning option. Add VAD, diarization, audio event detection, and visual analysis as independent optional capabilities after the end-to-end MVP works.

Do not hardcode a fixed model list into UI logic. Use a model catalog/registry so models can be added or replaced without redesigning onboarding.
