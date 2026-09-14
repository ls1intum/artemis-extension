# ADR 003: Telemetry / Struggle-Detection Build Seam for Open VSX

**Date:** 2026-06-20
**Status:** Accepted (implementation pending)

---

## Context

The extension ships two build variants (`esbuild.js`, `scripts/package-openvsx.js`):

- **`full`** — VS Code Marketplace / Desktop. Bundles the recorder/consent/replay subtree (runtime-consent-gated) and the struggle-detection (telemetry) engine.
- **`openvsx`** — the "clean" variant published to Open-VSX and bundled into the managed Theia (`EduIDE/eduide`). It already excludes the recorder via the `@dataCollection` alias (`noop.ts`) and tree-shakes recording (`__IRIS_RECORDING__=false`).

In the cloud / Theia deployment, **data protection is the dominant constraint: no behavioural tracking may run.** Today the struggle-detection engine (`TelemetryManager` + EQ engine, boundary triggers, intervention logic) is still **bundled** in the clean build and is only disabled by a runtime setting (`artemis.struggleDetection.enabled`, defaulted `false` in the clean manifest per ADR 002). A setting default is not an exclusion: the engine code ships, and a behavioural struggle context can in principle reach the server via the Iris chat message path.

ADR 002 changed the *default*; this ADR removes the *code*.

## Decision

Introduce a build-time **`@telemetry` seam** that mirrors the proven `@dataCollection` seam: an esbuild alias resolving to the real `TelemetryManager` factory in the `full` build and a runtime-pure no-op factory in the `openvsx` build. Consumers depend on an `ITelemetryManager` contract (a `Pick` of the class's public surface) rather than the concrete class, so the clean build references no engine value and esbuild tree-shakes the entire engine subtree out. A `__IRIS_TELEMETRY__` define gates the webview struggle UI exactly as `__IRIS_RECORDING__` gates recording. `verify-clean-bundle.js` is extended to fail the build if any engine input reappears.

### Why a seam (not just the runtime default)

- **Defence in depth / provable absence:** the cloud artifact contains no tracking engine at all — verifiable from the bundle metafile (fail-closed in CI), not merely "off by config".
- **Consistent with the established pattern:** same shape as `@dataCollection`; one reversible build switch.
- **Trivially reversible:** when the server-side intervention pipeline (Pyris/Artemis) goes live in the cloud, flip the `@telemetry` alias back to the real factory.

### Scope boundaries

- The `full` build is unchanged: real `TelemetryManager` and all wiring intact.
- Build-time presence (variant) is the seam's job; runtime user preference stays the `artemis.struggleDetection.*` setting. The two axes are kept separate. (Superseded by #352: the `artemis.struggleDetection.*` settings were removed; the runtime preference is now the proactive-egress consent plus the Off/Less/More level.)
- The `@dataCollection` seam is left untouched (recorder and struggle engine are siblings; two thin parallel seams, not one merged one).

## Consequences

- The managed Theia / cloud build ships **no** struggle-detection engine; local VS Code (Marketplace) behaviour is unchanged.
- `verify-clean-bundle.js` now also forbids the engine entry points — a future accidental value-import of the engine fails the clean build loudly.
- The dead `artemis.showStruggleScore` palette command is stripped from the clean manifest.
- **Revisit when the cloud intervention pipeline goes live:** flip the `@telemetry` alias back (and reconsider the ADR 002 `struggleDetection.*` setting defaults). (Superseded by #352: the `struggleDetection.*` settings no longer exist, so there is nothing left to reconsider on that axis.)
- Residual (cosmetic): the `artemis.struggleDetection.*` settings still appear in the clean manifest but are inert; left in place to avoid re-opening ADR 002. (Superseded by #352: the settings were removed entirely, so this residual no longer applies.)

## Alternatives considered

- **Runtime default only (ADR 002):** engine still ships; insufficient for "no tracking code in the cloud artifact".
- **Hard-delete struggle code for the clean build:** not reversible, diverges the source trees.
- **`as`-cast a no-op into the concrete type:** breaks type safety; rejected in favour of the `ITelemetryManager` contract.
- **Merge into the `@dataCollection` seam:** couples two independent features; rejected for two thin parallel seams.
