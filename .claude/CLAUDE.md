# Project: Artemis VS Code Extension

## Branching

- **All PRs branch off `dev`** and merge back into `dev`.
- **Only `dev` gets merged into `main`** — never push or merge feature branches directly into main.

## Dependency Management

- **No carets (`^`) or tildes (`~`) in package.json** — all dependencies must be pinned to exact versions. Renovate handles updates via PRs. The only exception is `engines.vscode` which requires `^`.
