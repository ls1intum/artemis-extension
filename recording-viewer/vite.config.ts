import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'

const RECORDINGS_DIR = path.join(
    os.homedir(),
    'Library/Application Support/Code/User/globalStorage/aet-tum.iris-thaumantias/recordings',
)

function recordingsApi() {
    return {
        name: 'recordings-api',
        configureServer(server: { middlewares: { use: (fn: Function) => void } }) {
            server.middlewares.use((req: { url?: string; method?: string }, res: { setHeader: Function; end: Function; writeHead: Function }, next: Function) => {
                if (!req.url?.startsWith('/api/recordings')) {
                    return next()
                }

                res.setHeader('Content-Type', 'application/json')
                const method = req.method?.toUpperCase() ?? 'GET'

                // POST /api/recordings/open-folder → open recordings dir in Finder/Explorer
                if (req.url === '/api/recordings/open-folder' && method === 'POST') {
                    try {
                        const dir = fs.existsSync(RECORDINGS_DIR) ? RECORDINGS_DIR : path.dirname(RECORDINGS_DIR)
                        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
                        exec(`${cmd} "${dir}"`)
                        res.end(JSON.stringify({ ok: true }))
                    } catch (err) {
                        res.writeHead(500)
                        res.end(JSON.stringify({ error: String(err) }))
                    }
                    return
                }

                // POST /api/recordings/:sessionId/open → open session folder in Finder/Explorer
                const openMatch = req.url.match(/^\/api\/recordings\/([^/]+)\/open$/)
                if (openMatch && method === 'POST') {
                    const sessionId = openMatch[1]
                    const sessionDir = path.join(RECORDINGS_DIR, sessionId)
                    try {
                        if (!fs.existsSync(sessionDir)) {
                            res.writeHead(404)
                            res.end(JSON.stringify({ error: 'Session not found' }))
                            return
                        }
                        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
                        exec(`${cmd} "${sessionDir}"`)
                        res.end(JSON.stringify({ ok: true }))
                    } catch (err) {
                        res.writeHead(500)
                        res.end(JSON.stringify({ error: String(err) }))
                    }
                    return
                }

                // DELETE /api/recordings/:sessionId → delete session folder
                const deleteMatch = req.url.match(/^\/api\/recordings\/([^/]+)$/)
                if (deleteMatch && method === 'DELETE') {
                    const sessionId = deleteMatch[1]
                    const sessionDir = path.join(RECORDINGS_DIR, sessionId)
                    try {
                        if (!fs.existsSync(sessionDir)) {
                            res.writeHead(404)
                            res.end(JSON.stringify({ error: 'Session not found' }))
                            return
                        }
                        fs.rmSync(sessionDir, { recursive: true, force: true })
                        res.end(JSON.stringify({ ok: true, deleted: sessionId }))
                    } catch (err) {
                        res.writeHead(500)
                        res.end(JSON.stringify({ error: String(err) }))
                    }
                    return
                }

                // GET /api/recordings → list sessions
                if (req.url === '/api/recordings' && method === 'GET') {
                    try {
                        if (!fs.existsSync(RECORDINGS_DIR)) {
                            res.end(JSON.stringify({ sessions: [], recordingsDir: RECORDINGS_DIR }))
                            return
                        }
                        const entries = fs.readdirSync(RECORDINGS_DIR, { withFileTypes: true })
                        const sessions = entries
                            .filter(e => e.isDirectory())
                            .map(e => {
                                const metaPath = path.join(RECORDINGS_DIR, e.name, 'metadata.json')
                                let metadata = null
                                if (fs.existsSync(metaPath)) {
                                    metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
                                }
                                return { id: e.name, metadata }
                            })
                            .sort((a, b) => {
                                const tA = a.metadata?.startTime ?? 0
                                const tB = b.metadata?.startTime ?? 0
                                return tB - tA // newest first
                            })
                        res.end(JSON.stringify({ sessions, recordingsDir: RECORDINGS_DIR }))
                    } catch (err) {
                        res.writeHead(500)
                        res.end(JSON.stringify({ error: String(err) }))
                    }
                    return
                }

                // GET /api/recordings/:sessionId/events → stream events.jsonl as JSON array
                const eventsMatch = req.url.match(/^\/api\/recordings\/([^/]+)\/events$/)
                if (eventsMatch) {
                    const sessionId = eventsMatch[1]
                    const eventsPath = path.join(RECORDINGS_DIR, sessionId, 'events.jsonl')
                    try {
                        if (!fs.existsSync(eventsPath)) {
                            res.writeHead(404)
                            res.end(JSON.stringify({ error: 'events.jsonl not found' }))
                            return
                        }
                        const lines = fs.readFileSync(eventsPath, 'utf-8')
                            .split('\n')
                            .filter(l => l.trim().length > 0)
                        const events = lines.map(l => JSON.parse(l))
                        res.end(JSON.stringify(events))
                    } catch (err) {
                        res.writeHead(500)
                        res.end(JSON.stringify({ error: String(err) }))
                    }
                    return
                }

                // GET /api/recordings/:sessionId/metadata
                const metaMatch = req.url.match(/^\/api\/recordings\/([^/]+)\/metadata$/)
                if (metaMatch) {
                    const sessionId = metaMatch[1]
                    const metaPath = path.join(RECORDINGS_DIR, sessionId, 'metadata.json')
                    try {
                        if (!fs.existsSync(metaPath)) {
                            res.writeHead(404)
                            res.end(JSON.stringify({ error: 'metadata.json not found' }))
                            return
                        }
                        const metadata = fs.readFileSync(metaPath, 'utf-8')
                        res.end(metadata)
                    } catch (err) {
                        res.writeHead(500)
                        res.end(JSON.stringify({ error: String(err) }))
                    }
                    return
                }

                next()
            })
        },
    }
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), recordingsApi()],
})
