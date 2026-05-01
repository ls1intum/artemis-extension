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

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), recordingsApiPlugin()],
})
