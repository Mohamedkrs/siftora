# Video File Management and Storage

## 1. Original media: reference, do not copy

Imported local videos must be processed directly from their original file locations.

- Do not copy imported videos into the application's installation folder.
- Do not duplicate source videos as part of import or queueing.
- Store the original absolute path as a reference.
- Do not modify, rename, move, or overwrite original media.
- Read/process directly from the original path where the media backend permits.
- Do not silently create a hidden source-media copy.

The application may create derived temporary artifacts (for example, extracted audio, thumbnails, sampled frames, proxies, or render intermediates) in its cache directory. These are not copies of the original source file and should be documented and managed separately.

## 2. Source availability

A stored path may become invalid if a file is moved, renamed, deleted, or stored on a disconnected drive.

Before processing or resuming:
- Verify the source exists and is readable.
- Check whether the file appears to have changed.
- Mark unavailable sources clearly.
- Offer a **Relink source** action so the user can select the moved file.
- Do not silently substitute another file with the same filename.

For removable drives and network paths, handle disconnection gracefully. Pause or fail the affected job with a clear `source_unavailable` state rather than silently continuing.

## 3. Source identity

Store useful metadata:
- Absolute path.
- File size.
- Modification timestamp.
- Duration and stream metadata.
- Optional lightweight fingerprint.

If stronger identity verification is required, compute hashes asynchronously and avoid blocking the UI. A path alone is not proof that the file contents are unchanged.

## 4. Separate storage locations

Keep these locations separate and configurable:

### Application data
Settings, database, job metadata, logs, and preferences.

### Model storage
Downloaded model weights and model metadata. Users may choose another drive.

### Cache
Temporary and reproducible artifacts:
- Extracted audio.
- Thumbnails.
- Sampled frames.
- Intermediate analysis files.
- Temporary render files.

### Output
Final generated clips, subtitle files, and user-requested exports.

Do not use the installation directory as a default location for large model weights, cache, or generated media.

## 5. Cache management

- Clean up temporary files when no longer needed.
- Do not delete artifacts used by active jobs.
- Offer a cache size view and clear-cache action.
- Allow users to choose cache location.
- Explain that clearing cache may require reprocessing.
- Recover or clean abandoned temporary files after an unexpected shutdown.

## 6. Generated output

- Save generated clips separately from source videos.
- Allow a default output directory and per-job override.
- Never overwrite an original source.
- If a generated output filename already exists, ask whether to choose another name or explicitly overwrite that generated output.
- Preserve source media metadata and timestamps in project records.

## 7. Queue persistence

Persist source paths and job configuration, not copies of original media.

On restart:
- Revalidate each source path.
- Revalidate required model installations.
- Mark unavailable items.
- Allow users to relink sources.
- Resume only stages whose inputs and cached outputs are still valid.

## 8. YouTube URLs

A YouTube URL is a remote source, not a local original path. Treat it as a separate import type and explain that retrieval may be limited by platform terms, availability, authentication, region, or tool support.

If the user chooses to download a video for local processing, store that downloaded media in a clearly identified managed source location and disclose the disk usage. Do not pretend the original YouTube URL is a local file path.
