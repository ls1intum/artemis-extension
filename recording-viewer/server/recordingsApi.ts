import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import type { AppConfig, IncomingRequest, ServerResponse } from './types';
import { sendJson, parseCookies, readJsonBody } from './http';
import { isValidToken, buildSessionCookie, clearSessionCookie, readSessionFromCookies } from './auth';
import { normalizeRaterName, deriveRaterId } from './raterIdentity';
import type { ViewerSession } from './viewerSession';
import { LiveTailerRegistry } from './liveTailerRegistry';
import { readLastNLines, readLinesAfter } from './eventsReader';

const TAIL_LIMIT_MAX = 50_000;
const SSE_DEFAULT_TAIL = 5_000;

export type ApiHandler = (req: IncomingRequest, res: ServerResponse, next: () => void) => void;

export function createRecordingsApi(config: AppConfig): ApiHandler {
    const { recordingsDir } = config;

    function resolveSessionDir(sessionId: string): string | null {
        let decoded: string;
        try {
            decoded = decodeURIComponent(sessionId);
        } catch {
            return null;
        }
        const resolved = path.resolve(recordingsDir, decoded);
        if (!resolved.startsWith(recordingsDir + path.sep)) return null;
        return resolved;
    }

    // Live-tailer registry — shared across all SSE requests so multiple subscribers
    // to the same session reuse one underlying file poller.
    const tailerRegistry = new LiveTailerRegistry(recordingsDir);

    // Track concurrent video uploads per session
    const uploadInProgress = new Map<string, boolean>();

    // Track concurrent subtitle uploads per session (keyed by sessionId)
    const subtitleUploadInProgress = new Map<string, boolean>();

    const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024; // 5 MB

    // SRT timing line. Hours group is 1-2 digits; delimiter between seconds and ms is
    // comma (standard SRT) or period (some encoders). Anything after the end timestamp
    // (proprietary SRT positioning tokens like `X1:.. Y1:..`) is captured and dropped.
    const SRT_TIMING_LINE = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3}).*$/;

    // VTT cue timing line. Hour group is optional (VTT allows MM:SS.mmm). Anything after
    // the end timestamp is valid VTT cue settings (line:, position:, align:, size:, vertical:).
    const VTT_TIMING_LINE = /^(?:\d+:)?\d{1,2}:\d{2}\.\d{1,3}\s*-->\s*(?:\d+:)?\d{1,2}:\d{2}\.\d{1,3}(?:\s+.*)?$/;

    const LIVE_FRESHNESS_WINDOW_MS = 15 * 60_000;

    function padTimestamp(h: string, m: string, s: string, ms: string): string {
        const hh = h.padStart(2, '0');
        // Pad ms to exactly 3 digits.
        const mmm = (ms + '000').slice(0, 3);
        return `${hh}:${m}:${s}.${mmm}`;
    }

    function stripBom(s: string): string {
        return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
    }

    function looksLikeVtt(s: string): boolean {
        if (!/^WEBVTT(\s|$)/.test(s)) return false;
        return s.split(/\r?\n/).some(line => VTT_TIMING_LINE.test(line));
    }

    function looksLikeSrt(s: string): boolean {
        return s.split(/\r?\n/).some(line => SRT_TIMING_LINE.test(line));
    }

    function srtToVtt(srt: string): string {
        let s = stripBom(srt);
        s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = s.split('\n');
        const out: string[] = ['WEBVTT', ''];
        for (const line of lines) {
            const m = SRT_TIMING_LINE.exec(line);
            if (m) {
                const start = padTimestamp(m[1], m[2], m[3], m[4]);
                const end = padTimestamp(m[5], m[6], m[7], m[8]);
                out.push(`${start} --> ${end}`);
            } else {
                out.push(line);
            }
        }
        // Ensure final newline
        if (out[out.length - 1] !== '') out.push('');
        return out.join('\n');
    }

    return (req: IncomingRequest, res: ServerResponse, next: () => void) => {
        const method = req.method?.toUpperCase() ?? 'GET';
        const urlPath = (req.url ?? '').split('?')[0];

        // ─── Auth endpoints ───────────────────────────────────────────────
        if (urlPath === '/api/auth/login' && method === 'POST') {
            void (async () => {
                try {
                    const body = await readJsonBody(req, 4096) as { token?: unknown; raterName?: unknown };
                    const token = body.token;
                    if (typeof token !== 'string') {
                        sendJson(res, 400, { error: 'Token is required' });
                        return;
                    }

                    const now = Math.floor(Date.now() / 1000);
                    const isHttps = (req.headers?.['x-forwarded-proto'] === 'https') || false;

                    if (isValidToken(token, config.researcherToken)) {
                        const session: ViewerSession = { v: 1, role: 'researcher', iat: now, exp: now + 7 * 24 * 3600 };
                        res.setHeader('Set-Cookie', buildSessionCookie(session, config.sessionSecret, { isHttps }));
                        sendJson(res, 200, { ok: true });
                        return;
                    }

                    if (isValidToken(token, config.liveToken)) {
                        const raterName = body.raterName;
                        if (typeof raterName !== 'string') {
                            sendJson(res, 400, { error: 'Rater name is required' });
                            return;
                        }
                        let displayName: string;
                        try {
                            displayName = normalizeRaterName(raterName);
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : 'Invalid rater name';
                            sendJson(res, 400, { error: msg });
                            return;
                        }
                        const raterId = deriveRaterId(displayName);
                        const session: ViewerSession = { v: 1, role: 'rater', raterId, raterName: displayName, iat: now, exp: now + 7 * 24 * 3600 };
                        res.setHeader('Set-Cookie', buildSessionCookie(session, config.sessionSecret, { isHttps }));
                        sendJson(res, 200, { ok: true });
                        return;
                    }

                    sendJson(res, 401, { error: 'Invalid token' });
                } catch {
                    sendJson(res, 400, { error: 'Invalid request body' });
                }
            })();
            return;
        }

        if (urlPath === '/api/auth/logout' && method === 'POST') {
            res.setHeader('Set-Cookie', clearSessionCookie());
            sendJson(res, 200, { ok: true });
            return;
        }

        if (urlPath === '/api/auth/status' && method === 'GET') {
            const cookies = parseCookies(req);
            const session = readSessionFromCookies(cookies, config.sessionSecret, Math.floor(Date.now() / 1000));
            sendJson(res, 200, {
                authenticated: session !== null,
                authRequired: Boolean(config.liveToken || config.researcherToken),
                allowWrite: config.allowWrite,
                role: session?.role,
                raterName: session?.role === 'rater' ? session.raterName : undefined,
            });
            return;
        }

        // ─── Auth gate for /api/recordings and /api/live ──────────────────
        let session: ViewerSession | null = null;
        if (urlPath.startsWith('/api/recordings') || urlPath.startsWith('/api/live')) {
            const authRequired = Boolean(config.liveToken || config.researcherToken);
            if (authRequired) {
                const cookies = parseCookies(req);
                session = readSessionFromCookies(cookies, config.sessionSecret, Math.floor(Date.now() / 1000));
                if (!session) {
                    // Per spec §6: clear the cookie on bad-signature/expired/wrong-version
                    // so the browser re-authenticates cleanly on the next request.
                    res.setHeader('Set-Cookie', clearSessionCookie());
                    sendJson(res, 401, { error: 'Authentication required' });
                    return;
                }
            }

            // PUT /annotations is always 405 regardless of live-mode allowWrite.
            // This branch must run BEFORE the generic live-mode mutation gate, so the
            // response code is deterministic for clients that probe the endpoint.
            if (method === 'PUT' && /^\/api\/recordings\/[^/]+\/annotations$/.test(urlPath)) {
                sendJson(res, 405, { error: 'Bulk PUT is not supported; use POST/DELETE on annotations.' });
                return;
            }

            // Researcher role: read-only. No POST/DELETE/PUT.
            if (session?.role === 'researcher' && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
                sendJson(res, 403, { error: 'Researcher role cannot modify annotations.' });
                return;
            }

            // Mutating-endpoint gate for live mode (allowWrite=false). The carved-out
            // mutations are POST /annotations and DELETE /annotations/:id, which the
            // rater path needs.
            const isRaterAnnotationMutation =
                (method === 'POST' && /^\/api\/recordings\/[^/]+\/annotations$/.test(urlPath)) ||
                (method === 'DELETE' && /^\/api\/recordings\/[^/]+\/annotations\/[^/]+$/.test(urlPath));
            const isMutating = method === 'POST' || method === 'PUT' || method === 'DELETE';
            if (isMutating && !config.allowWrite && !isRaterAnnotationMutation) {
                sendJson(res, 403, { error: 'Write operation disabled in live mode (set RECORDING_VIEWER_ALLOW_WRITE=1 to enable)' });
                return;
            }
        }

        // GET /api/live/sessions: list "live" sessions based on events.jsonl mtime
        // and metadata.endTime heuristic. A session is live when:
        //   - events.jsonl exists AND mtime is within LIVE_FRESHNESS_WINDOW_MS
        //   - metadata.json is missing OR has endTime == null
        if (urlPath === '/api/live/sessions' && method === 'GET') {
            try {
                if (!fs.existsSync(recordingsDir)) {
                    sendJson(res, 200, { sessions: [] });
                    return;
                }
                const now = Date.now();
                const entries = fs.readdirSync(recordingsDir, { withFileTypes: true });
                const live: Array<{ id: string; metadata: unknown }> = [];
                for (const e of entries) {
                    if (!e.isDirectory()) continue;
                    const eventsPath = path.join(recordingsDir, e.name, 'events.jsonl');
                    if (!fs.existsSync(eventsPath)) continue;
                    let mtimeMs: number;
                    try { mtimeMs = fs.statSync(eventsPath).mtimeMs; } catch { continue; }
                    if (now - mtimeMs > LIVE_FRESHNESS_WINDOW_MS) continue;

                    const metaPath = path.join(recordingsDir, e.name, 'metadata.json');
                    let metadata: unknown = null;
                    if (fs.existsSync(metaPath)) {
                        try {
                            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                            if (meta && typeof meta === 'object' && 'endTime' in meta && meta.endTime != null) {
                                // session ended, not live
                                continue;
                            }
                            metadata = meta;
                        } catch { /* corrupt metadata: treat as missing */ }
                    }
                    live.push({ id: e.name, metadata });
                }
                sendJson(res, 200, { sessions: live });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        if (!req.url?.startsWith('/api/recordings')) {
            return next();
        }

        // POST /api/recordings/open-folder
        if (urlPath === '/api/recordings/open-folder' && method === 'POST') {
            try {
                const dir = fs.existsSync(recordingsDir) ? recordingsDir : path.dirname(recordingsDir);
                const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
                execFile(cmd, [dir]);
                sendJson(res, 200, { ok: true });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // POST /api/recordings/:sessionId/open
        const openMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/open$/);
        if (openMatch && method === 'POST') {
            const sessionDir = resolveSessionDir(openMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            try {
                if (!fs.existsSync(sessionDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }
                const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
                execFile(cmd, [sessionDir]);
                sendJson(res, 200, { ok: true });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // POST /api/recordings/:sessionId/rename
        const renameMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/rename$/);
        if (renameMatch && method === 'POST') {
            const oldDir = resolveSessionDir(renameMatch[1]);
            if (!oldDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            try {
                if (!fs.existsSync(oldDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }
                let body = '';
                req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const { name } = JSON.parse(body);
                        if (!name || typeof name !== 'string' || /[/\\]/.test(name)) {
                            sendJson(res, 400, { error: 'Invalid name' });
                            return;
                        }
                        const newDir = path.join(recordingsDir, name);
                        if (fs.existsSync(newDir)) { sendJson(res, 409, { error: 'Name already exists' }); return; }
                        fs.renameSync(oldDir, newDir);
                        sendJson(res, 200, { ok: true, newId: name });
                    } catch (err) {
                        sendJson(res, 400, { error: String(err) });
                    }
                });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // DELETE /api/recordings/:sessionId
        const deleteMatch = urlPath.match(/^\/api\/recordings\/([^/]+)$/);
        if (deleteMatch && method === 'DELETE') {
            const sessionDir = resolveSessionDir(deleteMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            try {
                if (!fs.existsSync(sessionDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }
                fs.rmSync(sessionDir, { recursive: true, force: true });
                sendJson(res, 200, { ok: true, deleted: deleteMatch[1] });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // GET /api/recordings
        if (urlPath === '/api/recordings' && method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            try {
                if (!fs.existsSync(recordingsDir)) {
                    res.end(JSON.stringify({ sessions: [], recordingsDir }));
                    return;
                }
                const entries = fs.readdirSync(recordingsDir, { withFileTypes: true });
                const sessions = entries
                    .filter(e => e.isDirectory())
                    .map(e => {
                        const metaPath = path.join(recordingsDir, e.name, 'metadata.json');
                        let metadata = null;
                        if (fs.existsSync(metaPath)) {
                            metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                        }
                        const hasReplay = fs.existsSync(path.join(recordingsDir, e.name, 'replay-eq.jsonl'));
                        const hasVideo = fs.existsSync(path.join(recordingsDir, e.name, 'video.mp4')) || fs.existsSync(path.join(recordingsDir, e.name, 'video.webm'));
                        const hasSubtitles = fs.existsSync(path.join(recordingsDir, e.name, 'video.vtt')) || fs.existsSync(path.join(recordingsDir, e.name, 'video.srt'));
                        return { id: e.name, metadata, hasReplay, hasVideo, hasSubtitles };
                    })
                    .sort((a, b) => {
                        const tA = a.metadata?.startTime ?? 0;
                        const tB = b.metadata?.startTime ?? 0;
                        return tB - tA;
                    });
                res.end(JSON.stringify({ sessions, recordingsDir }));
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // GET /api/recordings/:sessionId/events/stream — SSE live tail
        // MUST come before the /events route below so it doesn't get shadowed.
        //
        // Catch-up sequence on connect:
        //   1. Subscribe to shared tailer immediately; live emissions are
        //      buffered (not written to res) until handoff completes.
        //   2. Read historical lines from disk according to Last-Event-ID
        //      header (resume), ?tail=N param (override), or default tail.
        //   3. Send the catch-up batch as SSE frames.
        //   4. Read the "gap" — any lines that landed in the file between
        //      catch-up read and tailer's current lineNo — and send those.
        //   5. Drain the live buffer, deduping by lineNo (a line could have
        //      been emitted both by the gap read and by the buffered tailer
        //      callback if it landed during step 4).
        //   6. Switch the subscriber to direct res.write mode.
        const streamMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/events\/stream$/);
        if (streamMatch && method === 'GET') {
            const sessionIdRaw = streamMatch[1];
            const sessionDir = resolveSessionDir(sessionIdRaw);
            if (!sessionDir || !fs.existsSync(sessionDir)) {
                sendJson(res, 404, { error: 'Session not found' });
                return;
            }
            const sessionId = decodeURIComponent(sessionIdRaw);
            const eventsPath = path.join(sessionDir, 'events.jsonl');

            // Parse catch-up directives from request before any I/O so we can
            // 400 fast on bad input.
            const lastEventIdHeader = req.headers?.['last-event-id'];
            const lastEventIdStr = Array.isArray(lastEventIdHeader)
                ? lastEventIdHeader[0]
                : lastEventIdHeader;
            let lastEventId: number | null = null;
            if (typeof lastEventIdStr === 'string' && lastEventIdStr.length > 0) {
                const parsed = Number.parseInt(lastEventIdStr, 10);
                if (Number.isFinite(parsed) && parsed >= 0) {
                    lastEventId = parsed;
                }
            }

            const queryString = (req.url ?? '').split('?')[1] ?? '';
            const params = new URLSearchParams(queryString);
            const tailParamRaw = params.get('tail');
            let tailLimit: number | null = null;
            if (tailParamRaw !== null) {
                const parsed = Number.parseInt(tailParamRaw, 10);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    sendJson(res, 400, { error: 'tail must be a non-negative integer' });
                    return;
                }
                tailLimit = Math.min(parsed, TAIL_LIMIT_MAX);
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.writeHead(200);
            res.write?.(': stream open\n\n');

            let closed = false;
            let directMode = false;
            let sentMaxLineNo = 0;
            const liveBuffer: Array<{ line: string; lineNo: number }> = [];
            const handle = tailerRegistry.acquire(sessionId);

            // Subscribe BEFORE any async work so no live line is lost during
            // the catch-up phase. Until directMode flips, emissions are
            // buffered for later dedupe + drain. Direct-mode writes ALSO
            // dedupe via sentMaxLineNo so a tailer poll that fires after
            // catch-up sent the same line (because the seeded cursor was
            // behind it at gap-read time) doesn't re-emit it.
            const unsubscribe = handle.tailer.subscribe((line, lineNo) => {
                if (closed) return;
                if (directMode) {
                    if (lineNo <= sentMaxLineNo) return;
                    res.write?.(`id: ${lineNo}\ndata: ${line}\n\n`);
                    sentMaxLineNo = lineNo;
                } else {
                    liveBuffer.push({ line, lineNo });
                }
            });

            const heartbeat = setInterval(() => {
                if (closed) return;
                res.write?.(': heartbeat\n\n');
            }, 15_000);

            // Watch for the events file disappearing (session deleted while streaming).
            // Seen-then-gone semantics: don't fire session-gone if the file never appeared
            // (race window during initSession where the dir exists but events.jsonl hasn't
            // been written yet). Only fire if the file existed and then disappeared.
            let seenFile = fs.existsSync(eventsPath);
            const fileWatcher = setInterval(() => {
                if (closed) return;
                const exists = fs.existsSync(eventsPath);
                if (exists) {
                    seenFile = true;
                } else if (seenFile) {
                    res.write?.('event: session-gone\ndata: {}\n\n');
                    cleanup();
                }
            }, 5_000);

            function cleanup() {
                if (closed) return;
                closed = true;
                clearInterval(heartbeat);
                clearInterval(fileWatcher);
                unsubscribe();
                handle.release();
                try { res.end(); } catch { /* already ended */ }
            }

            req.on('close', cleanup);
            req.on('error', cleanup);

            // Async handoff: catch-up → gap → buffer drain → direct mode.
            void (async () => {
                try {
                    if (closed) return;

                    // Catch-up from disk. Skip if the file doesn't exist yet
                    // (live session that hasn't written its first batch).
                    if (fs.existsSync(eventsPath)) {
                        let catchUp: { lines: Array<{ lineNo: number; line: string }>; endLineNo: number };
                        if (lastEventId !== null) {
                            // Resume: only lines strictly after the client's last id.
                            const { lines, endLineNo } = await readLinesAfter(eventsPath, lastEventId);
                            catchUp = { lines, endLineNo };
                        } else {
                            const limit = tailLimit ?? SSE_DEFAULT_TAIL;
                            const { lines, endLineNo } = await readLastNLines(eventsPath, limit);
                            catchUp = { lines, endLineNo };
                        }

                        if (closed) return;
                        for (const { lineNo, line } of catchUp.lines) {
                            res.write?.(`id: ${lineNo}\ndata: ${line}\n\n`);
                            if (lineNo > sentMaxLineNo) sentMaxLineNo = lineNo;
                        }

                        // Gap read: between catch-up's endLineNo and whatever
                        // the shared tailer has advanced past. Covers lines
                        // that landed in the file while catch-up was running.
                        const tailerLineNo = handle.tailer.currentLineNo();
                        if (tailerLineNo > catchUp.endLineNo) {
                            const { lines: gap } = await readLinesAfter(
                                eventsPath,
                                catchUp.endLineNo,
                                tailerLineNo,
                            );
                            if (closed) return;
                            for (const { lineNo, line } of gap) {
                                if (lineNo <= sentMaxLineNo) continue;
                                res.write?.(`id: ${lineNo}\ndata: ${line}\n\n`);
                                sentMaxLineNo = lineNo;
                            }
                        }
                    }

                    // Drain whatever the subscriber buffered during catch-up,
                    // skipping duplicates already sent via disk reads.
                    if (closed) return;
                    for (const { lineNo, line } of liveBuffer) {
                        if (lineNo <= sentMaxLineNo) continue;
                        res.write?.(`id: ${lineNo}\ndata: ${line}\n\n`);
                        sentMaxLineNo = lineNo;
                    }
                    liveBuffer.length = 0;
                    directMode = true;
                } catch (err) {
                    if (!closed) {
                        // Catch-up failed; log via SSE comment and let the
                        // live broadcast continue from where the tailer is.
                        // Switching to direct mode means the client at least
                        // sees new events going forward.
                        res.write?.(`: catchup error: ${String(err).replace(/\n/g, ' ')}\n\n`);
                        for (const { lineNo, line } of liveBuffer) {
                            if (lineNo <= sentMaxLineNo) continue;
                            res.write?.(`id: ${lineNo}\ndata: ${line}\n\n`);
                            sentMaxLineNo = lineNo;
                        }
                        liveBuffer.length = 0;
                        directMode = true;
                    }
                }
            })();
            return;
        }

        // GET /api/recordings/:sessionId/events
        // Optional ?tail=N query: stream-read the file and return only the
        // last N events (memory O(N) regardless of file size). Without the
        // param, returns the full archive — same as before, contract intact.
        const eventsMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/events$/);
        if (eventsMatch) {
            const sessionDir = resolveSessionDir(eventsMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            const eventsPath = path.join(sessionDir, 'events.jsonl');

            const queryString = (req.url ?? '').split('?')[1] ?? '';
            const params = new URLSearchParams(queryString);
            const tailParamRaw = params.get('tail');
            let tailLimit: number | null = null;
            if (tailParamRaw !== null) {
                const parsed = Number.parseInt(tailParamRaw, 10);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    sendJson(res, 400, { error: 'tail must be a non-negative integer' });
                    return;
                }
                tailLimit = Math.min(parsed, TAIL_LIMIT_MAX);
            }

            void (async () => {
                try {
                    if (!fs.existsSync(eventsPath)) { sendJson(res, 404, { error: 'events.jsonl not found' }); return; }
                    res.setHeader('Content-Type', 'application/json');
                    if (tailLimit !== null) {
                        const { lines } = await readLastNLines(eventsPath, tailLimit);
                        const events = lines.map(({ line }) => JSON.parse(line));
                        res.end(JSON.stringify(events));
                    } else {
                        const lines = fs.readFileSync(eventsPath, 'utf-8')
                            .split('\n')
                            .filter(l => l.trim().length > 0);
                        const events = lines.map(l => JSON.parse(l));
                        res.end(JSON.stringify(events));
                    }
                } catch (err) {
                    sendJson(res, 500, { error: String(err) });
                }
            })();
            return;
        }

        // GET /api/recordings/:sessionId/replay-eq
        const replayMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/replay-eq$/);
        if (replayMatch && method === 'GET') {
            const sessionDir = resolveSessionDir(replayMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            const replayPath = path.join(sessionDir, 'replay-eq.jsonl');
            try {
                if (!fs.existsSync(replayPath)) { sendJson(res, 404, { error: 'replay-eq.jsonl not found' }); return; }
                res.setHeader('Content-Type', 'application/json');
                const lines = fs.readFileSync(replayPath, 'utf-8')
                    .split('\n')
                    .filter(l => l.trim().length > 0);
                const snapshots = lines.map(l => JSON.parse(l));
                res.end(JSON.stringify(snapshots));
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // GET /api/recordings/:sessionId/annotations
        const annotGetMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/annotations$/);
        if (annotGetMatch && method === 'GET') {
            const sessionDir = resolveSessionDir(annotGetMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            const annotPath = path.join(sessionDir, 'annotations.json');
            try {
                if (!fs.existsSync(annotPath)) {
                    sendJson(res, 200, []);
                    return;
                }
                res.setHeader('Content-Type', 'application/json');
                const data = fs.readFileSync(annotPath, 'utf-8');
                res.end(data);
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // POST /api/recordings/:sessionId/annotations — append a single
        // annotation. The timestamp is the server receive time unless the
        // client sends an explicit `timestamp` field (used by the redo path
        // to restore an annotation at its original moment).
        //
        // Legacy fields `referenceEventTimestamp` and `reactionDelayMs` are
        // accepted in the body for backwards compatibility but ignored.
        const VALID_LABELS = new Set([
            'confident', 'light-struggle', 'medium-struggle', 'high-struggle', 'blocked',
            'idle', 'trial-error', 'reading', 'off-task', 'using-ai', 'iris-moment', 'reading-test-results',
        ]);

        const annotPostMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/annotations$/);
        if (annotPostMatch && method === 'POST') {
            const sessionDir = resolveSessionDir(annotPostMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            if (!fs.existsSync(sessionDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }
            const annotPath = path.join(sessionDir, 'annotations.json');

            void (async () => {
                let parsed: { label?: unknown; text?: unknown; timestamp?: unknown };
                try {
                    parsed = await readJsonBody(req, 64_000) as typeof parsed;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    sendJson(res, 400, { error: msg });
                    return;
                }

                if (parsed.label !== undefined && (typeof parsed.label !== 'string' || !VALID_LABELS.has(parsed.label))) {
                    sendJson(res, 400, { error: 'Invalid label' });
                    return;
                }
                // No upper bound on `timestamp`: explicit timestamps are only used by
                // the redo path, which restores a value the server itself issued earlier.
                // Future-dated timestamps would be a client bug, not a security concern.
                if (parsed.timestamp !== undefined && (typeof parsed.timestamp !== 'number' || !Number.isFinite(parsed.timestamp) || parsed.timestamp < 0)) {
                    sendJson(res, 400, { error: 'Invalid timestamp' });
                    return;
                }
                const text = typeof parsed.text === 'string' ? parsed.text : '';
                const now = Date.now();
                const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : now;
                const annotation = {
                    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
                    timestamp,
                    text,
                    label: parsed.label,
                    createdAt: now,
                };

                let existing: unknown[] = [];
                if (fs.existsSync(annotPath)) {
                    try {
                        const raw = fs.readFileSync(annotPath, 'utf-8');
                        const arr = JSON.parse(raw);
                        if (!Array.isArray(arr)) {
                            sendJson(res, 409, { error: 'Existing annotations.json is not an array' });
                            return;
                        }
                        existing = arr;
                    } catch {
                        sendJson(res, 409, { error: 'Existing annotations.json is corrupt JSON; refusing to overwrite' });
                        return;
                    }
                }
                existing.push(annotation);

                try {
                    const tmp = annotPath + '.tmp';
                    fs.writeFileSync(tmp, JSON.stringify(existing, null, 2), 'utf-8');
                    fs.renameSync(tmp, annotPath);
                    sendJson(res, 200, { ok: true, annotation });
                } catch (err) {
                    sendJson(res, 500, { error: String(err) });
                }
            })();
            return;
        }

        // DELETE /api/recordings/:sessionId/annotations/:id — remove a single
        // annotation by id. Live-mode carve-out (alongside POST) lets the
        // viewer undo struggle-tagging hotkeys without enabling full write
        // access. Sync read-modify-write keeps it atomic against concurrent
        // POSTs on the same file (Node's single-threaded event loop guarantees
        // no other handler runs between the readFileSync and the renameSync).
        //
        // Annotation ids look like `${ms-timestamp}-${random-base36}`. We
        // restrict to that shape to prevent path traversal via the id segment.
        const annotDeleteMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/annotations\/([^/]+)$/);
        if (annotDeleteMatch && method === 'DELETE') {
            const sessionDir = resolveSessionDir(annotDeleteMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            let annotId: string;
            try {
                annotId = decodeURIComponent(annotDeleteMatch[2]);
            } catch {
                sendJson(res, 400, { error: 'Invalid annotation ID' });
                return;
            }
            if (!/^[A-Za-z0-9_-]+$/.test(annotId)) {
                sendJson(res, 400, { error: 'Invalid annotation ID' });
                return;
            }
            const annotPath = path.join(sessionDir, 'annotations.json');
            try {
                if (!fs.existsSync(annotPath)) { sendJson(res, 404, { error: 'No annotations to delete' }); return; }
                const raw = fs.readFileSync(annotPath, 'utf-8');
                let arr: unknown;
                try {
                    arr = JSON.parse(raw);
                } catch {
                    sendJson(res, 409, { error: 'Existing annotations.json is corrupt JSON; refusing to overwrite' });
                    return;
                }
                if (!Array.isArray(arr)) {
                    sendJson(res, 409, { error: 'Existing annotations.json is not an array' });
                    return;
                }
                const filtered = arr.filter(a => !(a && typeof a === 'object' && (a as { id?: unknown }).id === annotId));
                if (filtered.length === arr.length) {
                    sendJson(res, 404, { error: 'Annotation not found' });
                    return;
                }
                const tmp = annotPath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(filtered, null, 2), 'utf-8');
                fs.renameSync(tmp, annotPath);
                sendJson(res, 200, { ok: true, deletedId: annotId });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // PUT /api/recordings/:sessionId/annotations
        const annotPutMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/annotations$/);
        if (annotPutMatch && method === 'PUT') {
            const sessionDir = resolveSessionDir(annotPutMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            const annotPath = path.join(sessionDir, 'annotations.json');
            try {
                if (!fs.existsSync(sessionDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }
                let body = '';
                req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const annotations = JSON.parse(body);
                        fs.writeFileSync(annotPath, JSON.stringify(annotations, null, 2));
                        sendJson(res, 200, { ok: true });
                    } catch (err) {
                        sendJson(res, 400, { error: String(err) });
                    }
                });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // GET /api/recordings/:sessionId/metadata
        const metaMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/metadata$/);
        if (metaMatch) {
            const sessionDir = resolveSessionDir(metaMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            const metaPath = path.join(sessionDir, 'metadata.json');
            try {
                if (!fs.existsSync(metaPath)) { sendJson(res, 404, { error: 'metadata.json not found' }); return; }
                res.setHeader('Content-Type', 'application/json');
                const metadata = fs.readFileSync(metaPath, 'utf-8');
                res.end(metadata);
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // GET /api/recordings/:sessionId/video-sync
        const videoSyncGetMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/video-sync$/);
        if (videoSyncGetMatch && method === 'GET') {
            const sessionDir = resolveSessionDir(videoSyncGetMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            try {
                const syncPath = path.join(sessionDir, 'video-sync.json');
                if (fs.existsSync(syncPath)) {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(fs.readFileSync(syncPath, 'utf-8'));
                    return;
                }
                // Fallback: scan for video file
                for (const ext of ['mp4', 'webm'] as const) {
                    if (fs.existsSync(path.join(sessionDir, `video.${ext}`))) {
                        sendJson(res, 200, { videoTimeAtSessionStartSeconds: 0, videoExtension: ext });
                        return;
                    }
                }
                sendJson(res, 404, { error: 'No video found' });
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // PUT /api/recordings/:sessionId/video-sync
        const videoSyncPutMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/video-sync$/);
        if (videoSyncPutMatch && method === 'PUT') {
            const sessionDir = resolveSessionDir(videoSyncPutMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (!Number.isFinite(parsed.videoTimeAtSessionStartSeconds)) {
                        sendJson(res, 400, { error: 'videoTimeAtSessionStartSeconds must be a finite number' });
                        return;
                    }
                    if (parsed.videoExtension !== 'mp4' && parsed.videoExtension !== 'webm') {
                        sendJson(res, 400, { error: 'videoExtension must be mp4 or webm' });
                        return;
                    }
                    const syncPath = path.join(sessionDir, 'video-sync.json');
                    const tmpPath = syncPath + '.tmp';
                    fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2));
                    fs.renameSync(tmpPath, syncPath);
                    sendJson(res, 200, { ok: true });
                } catch (err) {
                    sendJson(res, 400, { error: String(err) });
                }
            });
            return;
        }

        // PUT /api/recordings/:sessionId/video — upload video file
        const videoUploadMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/video$/);
        if (videoUploadMatch && method === 'PUT') {
            const sessionId = videoUploadMatch[1];
            const sessionDir = resolveSessionDir(sessionId);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            if (!fs.existsSync(sessionDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }

            if (uploadInProgress.get(sessionId)) {
                sendJson(res, 409, { error: 'Upload already in progress' });
                return;
            }

            const contentType = (req.headers?.['content-type'] ?? '') as string;
            let ext: 'mp4' | 'webm';
            if (contentType.includes('video/mp4')) ext = 'mp4';
            else if (contentType.includes('video/webm')) ext = 'webm';
            else { sendJson(res, 400, { error: 'Content-Type must be video/mp4 or video/webm' }); return; }

            uploadInProgress.set(sessionId, true);
            const tmpPath = path.join(sessionDir, `video.${ext}.tmp`);
            const finalPath = path.join(sessionDir, `video.${ext}`);
            const ws = fs.createWriteStream(tmpPath);

            let headerBuffer = Buffer.alloc(0);
            let headerValidated = false;
            let rejected = false;
            let requestEnded = false;

            const cleanup = () => {
                ws.destroy();
                try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
                uploadInProgress.delete(sessionId);
            };

            req.on('data', (chunk: Buffer) => {
                if (rejected) return;

                if (!headerValidated) {
                    headerBuffer = Buffer.concat([headerBuffer, chunk]);
                    const needed = ext === 'mp4' ? 8 : 4;
                    if (headerBuffer.length < needed) return; // wait for more data

                    headerValidated = true;
                    let valid = true;
                    if (ext === 'mp4') {
                        valid = headerBuffer.toString('ascii', 4, 8) === 'ftyp';
                    } else {
                        valid = headerBuffer[0] === 0x1A && headerBuffer[1] === 0x45 && headerBuffer[2] === 0xDF && headerBuffer[3] === 0xA3;
                    }
                    if (!valid) {
                        rejected = true;
                        cleanup();
                        sendJson(res, 400, { error: `Invalid ${ext.toUpperCase()} file (bad magic bytes)` });
                        return;
                    }
                    // Write accumulated header buffer
                    ws.write(headerBuffer);
                    return;
                }
                ws.write(chunk);
            });

            req.on('end', () => {
                if (rejected) return;
                requestEnded = true;
                ws.end(() => {
                    try {
                        // Delete stale alternate extension
                        const altExt = ext === 'mp4' ? 'webm' : 'mp4';
                        const altPath = path.join(sessionDir, `video.${altExt}`);
                        if (fs.existsSync(altPath)) fs.unlinkSync(altPath);

                        // Rename tmp to final
                        fs.renameSync(tmpPath, finalPath);

                        // Write or preserve video-sync.json
                        const syncPath = path.join(sessionDir, 'video-sync.json');
                        if (fs.existsSync(syncPath)) {
                            // Preserve existing offset, update extension
                            try {
                                const existing = JSON.parse(fs.readFileSync(syncPath, 'utf-8'));
                                existing.videoExtension = ext;
                                const tmpSync = syncPath + '.tmp';
                                fs.writeFileSync(tmpSync, JSON.stringify(existing, null, 2));
                                fs.renameSync(tmpSync, syncPath);
                            } catch { /* leave as-is */ }
                        } else {
                            fs.writeFileSync(syncPath, JSON.stringify({
                                videoTimeAtSessionStartSeconds: 0,
                                videoExtension: ext,
                            }, null, 2));
                        }

                        uploadInProgress.delete(sessionId);
                        sendJson(res, 200, { ok: true, videoExtension: ext });
                    } catch (err) {
                        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
                        uploadInProgress.delete(sessionId);
                        sendJson(res, 500, { error: String(err) });
                    }
                });
            });

            req.on('error', () => {
                if (rejected) return;
                rejected = true;
                cleanup();
            });

            // Handle client disconnect/abort (close fires on ALL requests, not just aborts)
            req.on('close', () => {
                if (rejected || requestEnded) return;
                // Request closed before 'end' fired — this is a genuine abort
                rejected = true;
                cleanup();
            });

            return;
        }

        // GET /api/recordings/:sessionId/video — serve video with range support
        const videoServeMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/video$/);
        if (videoServeMatch && (method === 'GET' || method === 'HEAD')) {
            const sessionDir = resolveSessionDir(videoServeMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }

            try {
                // Find the video file
                let videoPath: string | null = null;
                let videoExt: 'mp4' | 'webm' = 'mp4';

                const syncPath = path.join(sessionDir, 'video-sync.json');
                if (fs.existsSync(syncPath)) {
                    try {
                        const sync = JSON.parse(fs.readFileSync(syncPath, 'utf-8'));
                        videoExt = sync.videoExtension === 'webm' ? 'webm' : 'mp4';
                        const candidate = path.join(sessionDir, `video.${videoExt}`);
                        if (fs.existsSync(candidate)) videoPath = candidate;
                    } catch { /* fallthrough to scan */ }
                }

                if (!videoPath) {
                    for (const ext of ['mp4', 'webm'] as const) {
                        const candidate = path.join(sessionDir, `video.${ext}`);
                        if (fs.existsSync(candidate)) {
                            videoPath = candidate;
                            videoExt = ext;
                            break;
                        }
                    }
                }

                if (!videoPath) { sendJson(res, 404, { error: 'No video file found' }); return; }

                const stat = fs.statSync(videoPath);
                const fileSize = stat.size;
                const mimeType = videoExt === 'webm' ? 'video/webm' : 'video/mp4';

                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Accept-Ranges', 'bytes');

                if (method === 'HEAD') {
                    res.setHeader('Content-Length', String(fileSize));
                    res.writeHead(200);
                    res.end();
                    return;
                }

                const rangeHeader = req.headers?.range as string | undefined;
                if (rangeHeader) {
                    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
                    if (!match) {
                        res.setHeader('Content-Range', `bytes */${fileSize}`);
                        res.writeHead(416);
                        res.end();
                        return;
                    }
                    const start = parseInt(match[1], 10);
                    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

                    if (start >= fileSize || end >= fileSize || start > end) {
                        res.setHeader('Content-Range', `bytes */${fileSize}`);
                        res.writeHead(416);
                        res.end();
                        return;
                    }

                    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                    res.setHeader('Content-Length', String(end - start + 1));
                    res.writeHead(206);
                    const stream = fs.createReadStream(videoPath, { start, end });
                    stream.pipe(res as unknown as NodeJS.WritableStream);
                } else {
                    res.setHeader('Content-Length', String(fileSize));
                    res.writeHead(200);
                    const stream = fs.createReadStream(videoPath);
                    stream.pipe(res as unknown as NodeJS.WritableStream);
                }
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // GET|HEAD /api/recordings/:sessionId/subtitles — serve WebVTT (convert SRT if needed)
        const subsGetMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/subtitles$/);
        if (subsGetMatch && (method === 'GET' || method === 'HEAD')) {
            const sessionDir = resolveSessionDir(subsGetMatch[1]);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            try {
                const vttPath = path.join(sessionDir, 'video.vtt');
                const srtPath = path.join(sessionDir, 'video.srt');

                let vtt: string | null = null;
                if (fs.existsSync(vttPath)) {
                    const raw = stripBom(fs.readFileSync(vttPath, 'utf-8'));
                    if (looksLikeVtt(raw)) vtt = raw;
                }
                if (vtt == null && fs.existsSync(srtPath)) {
                    const raw = stripBom(fs.readFileSync(srtPath, 'utf-8'));
                    if (looksLikeSrt(raw)) vtt = srtToVtt(raw);
                }
                if (vtt == null) { sendJson(res, 404, { error: 'No subtitles found' }); return; }

                res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                if (method === 'HEAD') { res.writeHead(200); res.end(); return; }
                res.end(vtt);
            } catch (err) {
                sendJson(res, 500, { error: String(err) });
            }
            return;
        }

        // PUT /api/recordings/:sessionId/subtitles — upload VTT or SRT, stored as video.vtt
        const subsPutMatch = urlPath.match(/^\/api\/recordings\/([^/]+)\/subtitles$/);
        if (subsPutMatch && method === 'PUT') {
            const sessionId = subsPutMatch[1];
            const sessionDir = resolveSessionDir(sessionId);
            if (!sessionDir) { sendJson(res, 400, { error: 'Invalid session ID' }); return; }
            if (!fs.existsSync(sessionDir)) { sendJson(res, 404, { error: 'Session not found' }); return; }

            if (subtitleUploadInProgress.get(sessionId)) {
                sendJson(res, 409, { error: 'Upload already in progress' });
                return;
            }

            const contentType = ((req.headers?.['content-type'] ?? '') as string).toLowerCase();
            const acceptedTypes = ['text/vtt', 'application/x-subrip', 'text/plain'];
            if (!acceptedTypes.some(t => contentType.includes(t))) {
                sendJson(res, 400, { error: 'Content-Type must be text/vtt, application/x-subrip, or text/plain' });
                return;
            }

            subtitleUploadInProgress.set(sessionId, true);
            const chunks: Buffer[] = [];
            let totalSize = 0;
            let rejected = false;
            let requestEnded = false;

            const cleanup = () => {
                subtitleUploadInProgress.delete(sessionId);
            };

            req.on('data', (chunk: Buffer) => {
                if (rejected) return;
                totalSize += chunk.length;
                if (totalSize > MAX_SUBTITLE_BYTES) {
                    rejected = true;
                    cleanup();
                    sendJson(res, 413, { error: 'Subtitle file too large (max 5 MB)' });
                    return;
                }
                chunks.push(chunk);
            });

            req.on('end', () => {
                if (rejected) return;
                requestEnded = true;
                try {
                    const raw = stripBom(Buffer.concat(chunks).toString('utf-8'));
                    let vtt: string;
                    if (looksLikeVtt(raw)) {
                        vtt = raw;
                    } else if (looksLikeSrt(raw)) {
                        vtt = srtToVtt(raw);
                    } else {
                        cleanup();
                        sendJson(res, 400, { error: 'Not a valid VTT or SRT file' });
                        return;
                    }

                    const finalPath = path.join(sessionDir, 'video.vtt');
                    const tmpPath = finalPath + '.tmp';
                    fs.writeFileSync(tmpPath, vtt, 'utf-8');
                    fs.renameSync(tmpPath, finalPath);

                    cleanup();
                    sendJson(res, 200, { ok: true });
                } catch (err) {
                    cleanup();
                    sendJson(res, 500, { error: String(err) });
                }
            });

            req.on('error', () => {
                if (rejected) return;
                rejected = true;
                cleanup();
            });

            req.on('close', () => {
                if (rejected || requestEnded) return;
                rejected = true;
                cleanup();
            });

            return;
        }

        next();
    };
}
