# Recording Viewer

A React + Vite + TypeScript app for viewing recorded Artemis Extension sessions
(events, replay-EQ, annotations, video) and for observing live sessions over the
LAN.

## Live mode (researcher remote observation)

The viewer can stream a currently-recording session over the LAN to a second
laptop running only a browser, intended for user-study observation.

### Start (recording laptop)

```bash
export IRIS_LIVE_TOKEN=$(openssl rand -hex 24)
echo "Token: $IRIS_LIVE_TOKEN"
cd artemis-extension/recording-viewer
npm run dev:live
```

### Connect (observer laptop)

Open `http://<recording-laptop-IP>:5173` in any browser. Enter the token.
Active sessions show a red **LIVE** badge.

### Hotkeys (when viewing a live session)

- `1`-`5`: Struggle level (confident, light, medium, high, blocked)
- `q`-`t`: Context marker (idle, trial-error, reading, off-task, using-ai)
- The reaction-delay slider (0-1000ms) tunes the offset added to the last
  observed event timestamp before the annotation is stamped (default 300ms).

### Security

- `IRIS_LIVE_TOKEN` must be set when binding to a non-local interface.
  Without it the server only listens on `127.0.0.1`.
- Mutating endpoints (delete/rename/upload) are blocked in live mode. Set
  `IRIS_LIVE_ALLOW_WRITE=1` to opt in.
- Pin to a specific LAN interface: `IRIS_LIVE_BIND=192.168.1.42 npm run dev:live`.
- Cookies are HttpOnly + SameSite=Strict, valid for 7 days.
