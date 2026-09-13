# WebSocket Status Bar Button Redesign

**Issue:** #320 — Re-evaluate: does the WebSocket status-bar item need the `artemis.showWebSocketStatusBar` setting?
**Date:** 2026-06-24
**Branch:** `worktree-ws-statusbar-dev-hover` (off `dev`)
**Status:** Approved design, pending implementation plan

## Context

The WebSocket connection-status item in the status bar
(`extension/src/extension/services/websocket/websocketStatusBar.ts`,
`WebSocketStatusBarService`) is currently gated by a user setting
`artemis.showWebSocketStatusBar` (boolean, default `false`).

Today's behavior:
- On disconnect / reconnecting → item is **always shown** (red/yellow), setting ignored.
- During connected operation → shown **only** when `showWebSocketStatusBar` is `true`.
- Logged out → hidden unless the setting is `true`.
- After reconnection with the setting off → 2s flash, then hidden.
- Tooltip: a plain one-line string. Click: reset + reconnect (no-op while connecting/reconnecting).

A previous, richer version (commit `ec5f6d0d`, before a 588→165 line simplification)
had a Markdown hover tooltip with full debug info and a QuickPick action menu. That
was stripped out. This redesign brings back a focused, audience-aware version of the
hover info and resolves #320.

#320 asks whether the dedicated setting earns its place. The genuinely useful signal
(a connection problem) already surfaces automatically, independent of the setting. The
only thing the setting adds is a permanent "connected" indicator during normal
operation — niche, defaults off, and arguably clutter for students.

## Goals

- Remove the `artemis.showWebSocketStatusBar` configuration knob (resolves #320 as "remove").
- Fold "always show the item" into the existing `artemis.developerMode` setting, which
  already governs status-bar diagnostics (e.g. the live struggle-detection score).
- Give students a clear, plain-language explanation when the connection fails (the only
  moment a non-developer sees the item).
- Give developers full WebSocket diagnostics on hover.

## Non-Goals

- No change to the click action (stays reset + reconnect).
- No QuickPick / action-menu (Disconnect / Reset / Copy debug) — low value for a niche
  diagnostic, not worth the surface. Reconnect is the one in-context action and is the click.
- No auth diagnostics (Cookie / JWT presence) in the dev hover — `getDiagnostics()` does
  not expose them today and they are not needed now (YAGNI). Can be added later if a
  real debugging need arises.

## Design

### 1. Visibility

`developerMode` replaces `showWebSocketStatusBar` 1:1 in the visibility logic:

- **developerMode ON** → item always visible (including the connected steady state, and
  while logged out — diagnostics).
- **developerMode OFF** → visible only on problems (`disconnected` / `reconnecting`),
  plus the existing 2s flash after a successful reconnect; otherwise hidden. Logged out → hidden.

The "always show on problems" override and the logged-out gate are unchanged in shape;
only the gating field switches from `_showStatusBar` to a developer-mode flag.

### 2. Button text (mode-dependent)

| State | Normal (student) | Developer |
|-------|------------------|-----------|
| connected | `$(plug) Artemis: connected` | `$(plug) WS Connected` |
| connecting | `$(sync~spin) Artemis: connecting…` | `$(sync~spin) WS Connecting…` |
| reconnecting | `$(sync~spin) Artemis: reconnecting (3/20)…` | `$(sync~spin) WS Reconnecting (3/20)…` |
| disconnected | `$(debug-disconnect) Artemis: offline` | `$(debug-disconnect) WS Disconnected` |

Background colors unchanged: error (red) when disconnected, warning (yellow) when reconnecting.

### 3. Hover (tooltip) — three tiers

- **Normal + connected:** simple one-liner (e.g. "Connected to Artemis. Click to reconnect.").
  Rarely seen, since the item is hidden when connected in normal mode.
- **Normal + reconnecting:**
  > **Reconnecting to Artemis… (3/20)**
  > Live updates are paused and will resume automatically.
- **Normal + disconnected:**
  > **Connection to Artemis lost**
  > Live updates (build results, submission status, Iris) are paused.
  > Click to reconnect. If it keeps failing, check your internet connection or sign in again.
- **Developer (all states):** rich `MarkdownString` built from
  `ArtemisWebsocketService.getDiagnostics()`:
  status, `clientConnected` / `clientActive`, reconnect `(attempts/max)`,
  `subscriptionCount` + subscription topics, `sessionId`, `serverUrl`, `websocketUrl`.

### 4. Click action

Unchanged: `resetConnectionState()` + `connect()`, no-op while `connecting` / `reconnecting`.
Same in both modes.

### 5. Setting removal (#320)

Remove `artemis.showWebSocketStatusBar` everywhere:
- `extension/package.json` — `contributes.configuration` entry (~line 179).
- `extension/src/extension/utils/constants.ts` — `SHOW_WEBSOCKET_STATUS_BAR_KEY` (line 37).
- `README.md` — the bullet listing the setting (line 106).
- `websocketStatusBar.ts` — `_showStatusBar`, `_updateVisibilitySetting`, and the
  config-change listener; switch the listener to watch `DEVELOPER_MODE_KEY`.
- `CHANGELOG.md` — new entry under `## [Unreleased]` (do not rename that heading).

CHANGELOG history (lines mentioning the setting in past releases) is left untouched.

## Affected Files

| File | Change |
|------|--------|
| `extension/src/extension/services/websocket/websocketStatusBar.ts` | Swap setting→developerMode; mode-dependent text; three-tier tooltip incl. dev diagnostics |
| `extension/src/extension/utils/constants.ts` | Remove `SHOW_WEBSOCKET_STATUS_BAR_KEY` |
| `extension/package.json` | Remove `artemis.showWebSocketStatusBar` config contribution |
| `README.md` | Remove the setting's documentation bullet |
| `CHANGELOG.md` | Add `[Unreleased]` entry |
| `extension/test/unit/services/websocketStatusBar.test.ts` | Re-point setting tests to `developerMode`; add new tests |

No change required to `ArtemisWebsocketService` — `getDiagnostics()` already provides the
data for the dev hover.

## Testing

`extension/test/unit/services/websocketStatusBar.test.ts` (mocha/vscode-test):

- Re-point existing `showWebSocketStatusBar`-based visibility tests to `developerMode`.
- Keep: always-shown-on-problem, 2s reconnect flash, auth-gate, dispose tests.
- Add:
  - developerMode ON → item visible while connected (and while logged out).
  - Dev hover tooltip contains diagnostics (e.g. `serverUrl`, subscription count).
  - Normal-mode button text uses plain-language labels ("Artemis: offline", etc.).
  - Normal-mode disconnected/reconnecting tooltip contains the friendly explanation.

All `extension/` checks must pass before completion: `npm test`, `npm run lint`,
`npm run check-types` (tsc --noEmit catches unused locals that lint misses).

## Open Decisions

- **Auth diagnostics in dev hover:** OUT (YAGNI). Revisit only on a concrete need.

## Out of Scope / Future

- QuickPick action menu (Disconnect / Reset / Copy debug / Show debug doc).
- Clickable command links inside the hover tooltip.
- Exposing auth (Cookie/JWT) state via `getDiagnostics()`.
