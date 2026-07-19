# ADR 002: Theia / Open-VSX Setting-Default Overrides

**Date:** 2026-06-20
**Status:** Accepted (implementation pending)

---

## Context

The extension ships in two build variants (see `esbuild.js`, `scripts/package-openvsx.js`):

- **`full`** — published to the VS Code Marketplace, used by local VS Code Desktop installs. Bundles the recorder / data-collection / replay subtree (runtime-consent-gated).
- **`openvsx`** — the "clean" variant published to Open-VSX. `EduIDE/eduide` bundles it into the managed Theia (`images/base-ide/package.json.patch`, e.g. `aet-tum/iris-thaumantias/<ver>`). The clean variant aliases `@dataCollection` to `noop.ts` and tree-shakes recording (`__IRIS_RECORDING__=false`); `scripts/generate-clean-manifest.js` additionally strips the consent setting, the recording commands, and the prepublish hook from the manifest.

In the managed Theia (cloud) the desired out-of-the-box behaviour differs from a local VS Code install:

- The workspace **is** a single exercise (auto-cloned by scorpio via `GIT_URI`), opened through Artemis "Open in Online IDE". So the post-login page should be the exercise itself, not the dashboard, and prompts that assume manual setup (clone folder, start-page suggestion) are noise.
- Struggle detection must stay **off** in the cloud until the server-side intervention (Pyris/Artemis) pipeline is live there; otherwise it would surface half-working behaviour to students.

Crucially, the **`full` (Marketplace/Desktop) defaults must not change** — only the cloud variant should prefill differently. The lever is the per-key `default` in `contributes.configuration`, which the IDE uses as the setting's default when the user has not set it (it remains a default — user/workspace settings still win at runtime).

## Decision

Override a small set of the extension's **own** `artemis.*` configuration defaults **only in the `openvsx` clean variant**, by patching `contributes.configuration.properties[<key>].default` in the generated clean manifest. This reuses the existing clean-variant seam (`scripts/generate-clean-manifest.js`) — the same place that already removes consent/recording for the clean build — and never mutates the source `package.json`. The `full` build is untouched.

### Override list

> Superseded in part by #352 (2026-07-19): the `artemis.struggleDetection.*` settings were removed entirely; the row below is historical.

| Setting | `full` default | `openvsx` default | Reason |
|---------|----------------|-------------------|--------|
| `artemis.startPage` | `dashboard` | `workspace-exercise` | Workspace is the exercise; auto-open it after login instead of the dashboard. |
| `artemis.showStartPageSuggestion` | `true` | `false` | Start page is now fixed → the "configure start page?" prompt is redundant. |
| `artemis.struggleDetection.enabled` | `true` | `false` | Cloud intervention pipeline not yet live; keep detection off until it ships. |
| `artemis.struggleDetection.showInterventions` | `true` | `false` | Inert while detection is off; pinned `false` so interventions can't surface if detection is later toggled on without review. |
| `artemis.showSetDefaultClonePathPrompt` | `true` | `false` | Cloud auto-clones; the clone-folder prompt never applies. |

All other `artemis.*` settings keep their source defaults. `artemis.dataCollectionConsent` is already removed from the clean manifest, so it is intentionally absent here.

## Implementation

Single change, in `scripts/generate-clean-manifest.js`. Add the override map as a top-level const, then apply it **after** the existing `const props = …` / `delete props['artemis.dataCollectionConsent']` block (do not re-declare `props`):

```js
// Cloud/Theia-tailored setting defaults (clean variant only). See ADR 002.
const OPENVSX_SETTING_DEFAULTS = {
    'artemis.startPage': 'workspace-exercise',
    'artemis.showStartPageSuggestion': false,
    'artemis.struggleDetection.enabled': false,
    'artemis.struggleDetection.showInterventions': false,
    'artemis.showSetDefaultClonePathPrompt': false,
};
```

```js
// ... after the existing `const props = m.contributes?.configuration?.properties;`
//     and `if (props) { delete props['artemis.dataCollectionConsent']; }`:
for (const [key, value] of Object.entries(OPENVSX_SETTING_DEFAULTS)) {
    if (!props || !props[key]) {
        throw new Error(`generate-clean-manifest: cannot override unknown setting '${key}'`);
    }
    props[key].default = value;
}
```

The missing-key guard makes a renamed/removed setting fail the clean build loudly instead of silently shipping the upstream default.

No changes to `esbuild.js`, `package-openvsx.js`, the source `package.json`, or the `full` build.

## Testing

- Extend the clean-manifest check (or add one if none exists) to assert that the generated manifest has each overridden `default` set to the expected value, that `artemis.dataCollectionConsent` is absent, and that an unknown override key throws.
- Manual verification: run `node scripts/package-openvsx.js`, inspect `build/openvsx-pkg/package.json` for the five overridden defaults; confirm the source `extension/package.json` is unchanged.

## Consequences

- The managed Theia/cloud build gets the tailored defaults; local VS Code (Marketplace) behaviour is unchanged.
- These are defaults, not forced values — a user or workspace setting still overrides them at runtime.
- **Revisit when the cloud intervention pipeline goes live:** remove the two `struggleDetection.*` overrides so cloud detection turns back on. (Superseded by #352, 2026-07-19: the settings and their overrides were removed entirely; nothing to revisit.)
- Adding/removing future cloud-specific defaults is a one-line edit to `OPENVSX_SETTING_DEFAULTS`.

## Alternatives considered

- **Bake defaults into the EduIDE app** (`applications/browser` `theia.frontend.config.preferences`): required for generic Theia settings, but heavier (eduide image rebuild) and unnecessary here since only `artemis.*` settings are in scope.
- **Change the source defaults in the extension manifest:** would also change Marketplace/Desktop behaviour — rejected; the goal is cloud-only.
- **Per-deployment workspace/user settings injection (Helm):** per-environment flexibility, but settings live outside the artifact, are user-overwritable, and add deployment fragility — rejected.
