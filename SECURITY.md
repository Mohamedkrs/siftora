# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: open the repository's **Security** tab and choose **Report a vulnerability**. Include what is affected, how to reproduce it, and what an attacker could do with it.

You will get a reply within a week. Once a fix is released, you are credited in the release notes unless you prefer otherwise.

## What is in scope

Siftora runs on the user's computer and downloads engines and AI models. Problems worth reporting include:

- a way to make Siftora download or run something other than the files it lists (it checks every download against a SHA-256 checksum)
- a way for a video file, YouTube link or model file to run code or read files it should not
- anything that sends a user's videos, transcripts or file names off their computer

## Supported versions

Only the newest release receives security fixes.
