# Viral Moment Discovery and Scoring

## 1. Purpose

Rank candidate moments by estimated short-form engagement potential. Scores are heuristics for prioritization, not predictions of views, virality, or audience response.

## 2. Candidate categories

Allow users to select one or more discovery modes:
- Funny.
- Educational.
- Controversial/debate.
- Emotional/storytelling.
- Surprising/revelation.
- Interesting conversation.
- All moments.

Category labels should be based on transcript and available evidence, not assumed from audio tone alone.

## 3. Evidence signals

### Transcript/context
- Clear hook or curiosity.
- Interesting claim or insight.
- Strong opinion or disagreement.
- Joke or humorous setup/payoff.
- Story progression and reveal.
- Standalone comprehensibility.
- Useful information density.

### Audio
- Laughter or audience reaction.
- Applause/cheering.
- Shouting or vocal intensity change.
- Pitch movement.
- Pause before/after a reveal.
- Overlapping speech or interruption.

### Visual
- Scene change.
- Visible reaction.
- Strong movement/activity.
- Framing/subject quality.

Audio and visual events are supporting evidence. A laugh, loud sound, pitch rise, or face detection alone must not automatically produce a high score.

## 4. Example scoring dimensions

A configurable scoring model may use:
- Hook strength.
- Emotional/entertainment signal.
- Information or story value.
- Context completeness.
- Payoff strength.
- Audio evidence quality.
- Visual evidence quality.
- Clip boundary quality.

Weights should vary by selected discovery mode. Missing modalities must not be treated as negative evidence; normalize scores over available signals and show which signals were unavailable.

## 5. Explainability

For every candidate, provide:
- Overall score.
- Dimension breakdown.
- Evidence intervals.
- Short human-readable rationale.
- Missing/uncertain evidence notes.

Do not display arbitrary precision. A score such as 82/100 is a prioritization indicator, not a scientifically calibrated probability.

## 6. Context and boundaries

- Include setup before the key moment.
- Include payoff or reaction after it.
- Avoid mid-word and mid-sentence cuts.
- Prefer natural pauses and sentence boundaries.
- Enforce user duration limits.
- Deduplicate substantially overlapping candidates.
- Preserve enough context for a viewer unfamiliar with the full video.

## 7. User feedback

Allow users to mark candidates as:
- Useful.
- Not useful.
- Wrong category.
- Bad boundary.
- Duplicate.

Use feedback to improve local ranking preferences only if the product implements a transparent, controllable learning mechanism. Do not silently upload feedback or media.

## 8. Evaluation

Build a small manually reviewed evaluation set. Track:
- Candidate relevance.
- Boundary quality.
- Context completeness.
- Duplicate rate.
- False positives from isolated audio events.
- Runtime and memory usage.

Do not optimize solely for model confidence. Human usefulness is the target.
