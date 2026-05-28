# Recording Viewer

A React + Vite + TypeScript app for viewing recorded Artemis Extension sessions
(events, replay-EQ, annotations, video) and for observing live sessions over the
LAN.

## Live mode (researcher remote observation)

The viewer can stream a currently-recording session over the LAN to a second
laptop running only a browser, intended for user-study observation.

### Start (recording laptop)

```bash
export RECORDING_VIEWER_TOKEN=$(openssl rand -hex 24)
echo "Token: $RECORDING_VIEWER_TOKEN"
cd artemis-extension/recording-viewer
npm run dev:live
```

#### Quick local testing

For fast iteration on the same network without picking a token, use the
convenience script with a baked-in token:

```bash
npm run dev:live:token   # token = dev-only-do-not-use-in-prod
```

Do NOT use this in a real study or on a shared/public network. The token is in
the repo, so anyone with source access knows it. Use `dev:live` with a real
random token for anything that matters.

### Connect (observer laptop)

Open `http://<recording-laptop-IP>:5173` in any browser. Enter the token.
Active sessions show a red **LIVE** badge.

### Hotkeys (when viewing a live session)

- `1`-`5`: Struggle level (confident, light, medium, high, blocked)
- `q`/`w`/`e`/`r`/`t`/`i`/`u`: Context marker (idle, trial-error, reading, off-task, using-ai, iris-moment, reading-test-results)
- The reaction-delay slider (0-1000ms) tunes the offset added to the last
  observed event timestamp before the annotation is stamped (default 300ms).

### Multi-rater study setup

For Inter-Rater-Reliability studies, configure both a rater and a researcher
token so multiple coders can annotate independently while the researcher
reviews all lanes.

```bash
export RECORDING_VIEWER_TOKEN=$(openssl rand -hex 24)            # rater token (shared by all raters)
export RECORDING_VIEWER_RESEARCHER_TOKEN=$(openssl rand -hex 24) # researcher token (single role-holder)
export RECORDING_VIEWER_SESSION_SECRET=$(openssl rand -hex 32)   # signs the auth cookie; set this for persistent sessions
cd artemis-extension/recording-viewer
npm run dev:live
```

If `RECORDING_VIEWER_SESSION_SECRET` is unset, the server generates an
ephemeral one and prints a warning; logins won't survive a server restart.
Set it explicitly for real study runs.

Raters log in with the rater token and a chosen display name. Each rater
sees only their own marks. The researcher logs in with the researcher token
(no name required) and sees all rater lanes side-by-side, read-only.

For post-study Cohen's/Fleiss' κ analysis:

```bash
npm run merge-annotations -- <session-dir> --format=long --out=marks.csv
npm run merge-annotations -- <session-dir> --format=irr-matrix --bin-ms=1000 --label-set=struggle --conflict=error --out=matrix.csv
```

The wide-format matrix CSV feeds directly into R's `irr` package and
Python's `statsmodels.stats.inter_rater`.

### Security

- `RECORDING_VIEWER_TOKEN` and/or `RECORDING_VIEWER_RESEARCHER_TOKEN` must
  be set when binding to a non-local interface. With neither set, the
  server only listens on `127.0.0.1`.
- The two tokens must differ. Startup fails fast if both are set and equal.
- `RECORDING_VIEWER_SESSION_SECRET` should be set for production runs
  (32-byte hex). Auto-generated otherwise.
- Mutating endpoints (delete/rename/upload) are blocked in live mode. Set
  `RECORDING_VIEWER_ALLOW_WRITE=1` to opt in.
- Pin to a specific LAN interface: `RECORDING_VIEWER_BIND=192.168.1.42 npm run dev:live`.
- Cookies are HttpOnly + SameSite=Strict + signed HMAC, valid for 7 days.
  The `Secure` attribute is added when the request comes through an HTTPS
  reverse proxy (`X-Forwarded-Proto: https`).
