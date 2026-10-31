# Local AI Viral Clip Finder — Documentation

A local-first desktop application that analyzes long-form videos and identifies promising short-form clips for TikTok, Instagram Reels, and YouTube Shorts.

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
