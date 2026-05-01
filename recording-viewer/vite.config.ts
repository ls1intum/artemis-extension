import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'os'
import { createRecordingsApi } from './server/recordingsApi'
import type { AppConfig, IncomingRequest, ServerResponse } from './server/types'

const RECORDINGS_DIR = path.join(
    os.homedir(),
    'Library/Application Support/Code/User/globalStorage/aet-tum.iris-thaumantias/recordings',
)

const liveToken = process.env.IRIS_LIVE_TOKEN
const allowWrite = process.env.IRIS_LIVE_ALLOW_WRITE === '1' || !liveToken

function recordingsApiPlugin() {
    const config: AppConfig = { recordingsDir: RECORDINGS_DIR, liveToken, allowWrite }
    const handler = createRecordingsApi(config)
    return {
        name: 'recordings-api',
        configureServer(server: { middlewares: { use: (fn: (req: IncomingRequest, res: ServerResponse, next: () => void) => void) => void } }) {
            server.middlewares.use(handler)
        },
    }
}

function resolveBindHost(): string {
    const explicit = process.env.IRIS_LIVE_BIND;
    const hasToken = Boolean(liveToken);
    if (explicit) {
        const isLocal = explicit === '127.0.0.1' || explicit === 'localhost' || explicit === '::1';
        if (!hasToken && !isLocal) {
            throw new Error(
                'IRIS_LIVE_BIND set to non-local interface but IRIS_LIVE_TOKEN is missing. ' +
                'Refusing to expose recordings without authentication.',
            );
        }
        return explicit;
    }
    return hasToken ? '0.0.0.0' : '127.0.0.1';
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), recordingsApiPlugin()],
    server: { host: resolveBindHost() },
})
