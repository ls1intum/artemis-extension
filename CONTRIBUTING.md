# Contributing to the Artemis VS Code Extension

Thanks for your interest in contributing! This guide covers the workflow and conventions. For build details and architecture, see **[DEVELOPER.md](DEVELOPER.md)**; for the deep webview/architecture walkthrough, see **[extension/docs/DEVELOPER-GUIDE.md](extension/docs/DEVELOPER-GUIDE.md)**.

## Quick Start

```bash
git clone https://github.com/ls1intum/artemis-extension.git
cd artemis-extension/extension
npm install
```

Then open the repository in VS Code and press `F5` to launch the Extension Development Host with watch mode. Test your changes in the new window.

## Development Workflow

1. **Branch** off `dev`: `git checkout -b feature/your-feature-name`.
2. **Make changes** in `extension/src/` (extension host, React webview, or shared contracts; see [DEVELOPER.md](DEVELOPER.md#repository-layout)).
3. **Run it** with `F5` and verify in the Extension Development Host.
4. **Verify quality** before committing:
   ```bash
   npm run check-types   # type-check
   npm run lint          # ESLint
   npm run test:all      # extension host + React tests
   ```

   `test:all` does not build first. Run `npm run compile-tests` and
   `node esbuild.js` beforehand, or use `npm run pretest` to do both plus lint.
5. **Open a Pull Request** against `dev` with a clear description.

All commands run from the `extension/` directory.

## Code Guidelines

- **TypeScript**: use strict-mode features, define proper types (avoid `any`), and add JSDoc for public APIs.
- **Styling**: use CSS Modules scoped to components and VS Code theme tokens (CSS variables); test in both light and dark themes.
- **Naming**: meaningful, consistent with the surrounding code.
- **Match the existing style** - it is enforced by ESLint.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add WebSocket reconnection logic`
- `fix: resolve authentication token refresh issue`
- `docs: update installation instructions`
- `refactor: simplify view routing logic`

## Testing

- `npm run test:unit` - extension host tests (vscode-test).
- `npm run test:react` - React component tests (vitest).
- `npm run test:all` - both.

Add tests for new behavior and fixes. Do not skip or disable failing tests.

## Documentation

Keep the docs in sync with your change:

- **User-facing change** (feature, command, setting, behavior) → update **[README.md](README.md)** (this is also the store listing).
- **Build, scripts, architecture, or workflow change** → update **[DEVELOPER.md](DEVELOPER.md)**.

`extension/README.md` and `extension/CHANGELOG.md` are **generated** from the repo-root copies at package time - never edit them by hand.

## Getting Help

- 📖 [Artemis documentation](https://docs.artemis.cit.tum.de)
- 🐛 [Open an issue](https://github.com/ls1intum/artemis-extension/issues)

## Code of Conduct

- Use your real name and an authentic profile.
- Be respectful and inclusive.
- Follow [GitHub's Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) and the [Open Source Guides](https://opensource.guide/).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
