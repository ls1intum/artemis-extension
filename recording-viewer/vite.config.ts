import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import os from 'os'
import { createRecordingsApiPlugin } from './server/recordingsApiPlugin'
import type { AppConfig } from './server/types'
import { validateStartupConfig, resolveSessionSecret } from './server/startupValidation'

const RECORDINGS_DIR = path.join(
    os.homedir(),
    'Library/Application Support/Code/User/globalStorage/aet-tum.iris-thaumantias/recordings',
)

const liveToken = process.env.RECORDING_VIEWER_TOKEN
const researcherToken = process.env.RECORDING_VIEWER_RESEARCHER_TOKEN
validateStartupConfig({ liveToken, researcherToken })
const sessionSecret = resolveSessionSecret(process.env.RECORDING_VIEWER_SESSION_SECRET, console.warn)
const allowWrite = process.env.RECORDING_VIEWER_ALLOW_WRITE === '1' || !liveToken

const apiConfig: AppConfig = { recordingsDir: RECORDINGS_DIR, liveToken, researcherToken, sessionSecret, allowWrite }

function resolveBindHost(): string {
    const explicit = process.env.RECORDING_VIEWER_BIND;
    const hasToken = Boolean(liveToken);
    if (explicit) {
        const isLocal = explicit === '127.0.0.1' || explicit === 'localhost' || explicit === '::1';
        if (!hasToken && !isLocal) {
            throw new Error(
                'RECORDING_VIEWER_BIND set to non-local interface but RECORDING_VIEWER_TOKEN is missing. ' +
                'Refusing to expose recordings without authentication.',
            );
        }
        return explicit;
    }
    return hasToken ? '0.0.0.0' : '127.0.0.1';
}

const bindHost = resolveBindHost()

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), createRecordingsApiPlugin(apiConfig)],
    server: { host: bindHost },
    // Preview serves the production build, which is how a live study should run:
    // the production React build has no dev-mode `performance.measure` component
    // instrumentation, so the live-mode out-of-memory tab crash cannot occur.
    // Mirror the dev host and pin the port so raters reach the same LAN URL.
    preview: { host: bindHost, port: 5173, strictPort: true },
})
