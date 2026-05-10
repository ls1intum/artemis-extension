# Project: Artemis VS Code Extension

## Branching

- **All PRs branch off `dev`** and merge back into `dev`.
- **Only `dev` gets merged into `main`** — never push or merge feature branches directly into main.

## Dependency Management

- **No carets (`^`) or tildes (`~`) in package.json** — all dependencies must be pinned to exact versions. Renovate handles updates via PRs. The only exception is `engines.vscode` which requires `^`.

## Authentication Architecture

- **Desktop (VS Code) MUST use Cookie auth.** The JWT is stored as cookie string (`jwt=<token>`) and sent as `Cookie: jwt=<token>` header. Do NOT change this to Bearer.
- **Theia/EduIDE uses Bearer auth.** The raw JWT from `ARTEMIS_TOKEN` env var is sent as `Authorization: Bearer <token>` header.
- The `AuthManager._useBearerAuth` flag switches between these modes. `enableBearerAuth()` is called only in `theiaAuthProvider.ts` during Theia activation.
- Never unify these two auth paths — Artemis requires Cookie auth for desktop login flow.
