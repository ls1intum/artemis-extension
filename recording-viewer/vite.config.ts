import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'

const RECORDINGS_DIR = path.join(
    os.homedir(),
    'Library/Application Support/Code/User/globalStorage/aet-tum.iris-thaumantias/recordings',
)

function recordingsApi() {
    return {
        name: 'recordings-api',
        configureServer(server: { middlewares: { use: (fn: Function) => void } }) {
            server.middlewares.use((req: { url?: string }, res: { setHeader: Function; end: Function; writeHead: Function }, next: Function) => {
                if (!req.url?.startsWith('/api/recordings')) {
                    return next()
                }

                res.setHeader('Content-Type', 'application/json')

                // GET /api/recordings → list sessions
                if (req.url === '/api/recordings') {
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
