# Contributing to the Artemis Extension

Thanks for helping out. This file covers how a change gets from your branch into a release. Setup, architecture, code conventions and the release process are in [DEVELOPER.md](DEVELOPER.md).

## Workflow

1. Set up the project as described in [DEVELOPER.md](DEVELOPER.md#setup) and branch off `dev`.
2. Make the change and try it in the Extension Development Host (`F5`).
3. Run the checks CI runs, from `extension/`:

   ```bash
   npm run check-types
   npm run lint
   npx vitest run          # test/react and test/logic
   npm run compile-tests && node esbuild.js && npm run test:vscode
   npm run knip
   ```

   The extension host suite reads compiled tests from `out/` and activates the real extension from `dist/`, so it fails with confusing errors unless both builds ran first. `npm run pretest` does both and lints as well.
4. Open the pull request against `dev`. Pull requests are squash-merged, so the PR title becomes the commit on `dev`. Write it as a plain imperative sentence that says what changes, for example "Name the Artemis server on the login page".

## Tests

Add tests for new behavior and for every fix. A failing test gets fixed, never skipped or disabled. Which suite a test belongs in is listed under [Repository layout](DEVELOPER.md#repository-layout).

## Documentation

Update the documentation in the same pull request. A change users can see (feature, command, setting, behavior) goes into [README.md](README.md), which is also the store listing. A change to the build, scripts, architecture or workflow goes into [DEVELOPER.md](DEVELOPER.md).

`extension/README.md` and `extension/CHANGELOG.md` are generated from the repo-root copies at package time. Do not edit them by hand.

## Getting help

- [Artemis documentation](https://docs.artemis.cit.tum.de)
- [Open an issue](https://github.com/ls1intum/artemis-extension/issues)

## Code of conduct

- Use your real name and an authentic profile.
- Be respectful and inclusive.
- Follow [GitHub's Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) and the [Open Source Guides](https://opensource.guide/).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
