# Contributing to Siftora

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

Open an [issue](../../issues/new/choose) and pick the matching form. For a bug, say what you did, what happened, your Windows version and graphics card, and attach the log if you can: **Settings → About** shows where your data folder is, and the log is in its `logs` folder. Please remove anything private from it first; it can contain the names of your video files.

To report a security problem, don't open an issue: see [SECURITY.md](SECURITY.md).

## Making a change

1. For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.
2. Fork the repository and create a branch from `main`.
3. Set it up and run it: see [Building from source](README.md#building-from-source).
4. Keep the change focused on one thing, and match the style of the code around it.
5. Before opening the pull request, make sure `npm run typecheck` and `npm run build` pass. The same checks run automatically on every pull request. If you change how moments are found, bump `FINDER_VERSION` and compare with `npm run eval` (see [Measuring the picks](README.md#measuring-the-picks)).
6. Open the pull request and fill in the form: what changed, why, and how you tested it. Screenshots help for anything visible.

Every pull request is reviewed by the maintainer before it is merged. Releases are made by the maintainer only.

## A few principles

- **Local first.** Videos, transcripts and clips never leave the user's computer. Changes that send user data anywhere will not be accepted.
- **Honest.** No fake progress, placeholder results or scores presented as guarantees.
- **Light.** Explain why a new dependency is needed; prefer what the platform already provides.

## License

Siftora is licensed under the [GNU GPL v3](LICENSE). By submitting a pull request, you agree that your contribution is licensed under the same terms.

Siftora also has a paid edition, Siftora Pro, built on this code. By submitting a pull request, you also grant the project owner (GitHub: Mohamedkrs) a perpetual, worldwide, royalty-free license to use, change and distribute your contribution under other terms, including in Siftora Pro. You keep the copyright to your contribution.
