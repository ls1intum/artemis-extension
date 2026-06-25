// Configuration constants
export const CONFIG = {
    ARTEMIS_SERVER_URL_DEFAULT: 'https://artemis.tum.de',
    AUTH_COOKIE_NAME: 'jwt',
    // Web app path that bridges a browser login back to the extension (browser-delegated login).
    EXTERNAL_LOGIN_PATH: '/external-login',
    SECRET_KEYS: {
        ARTEMIS_TOKEN: 'artemis-auth-token',
        ARTEMIS_SERVER_URL: 'artemis-server-url',
        PENDING_EXTERNAL_LOGIN: 'artemis-pending-external-login',
    },
    WEBVIEW: {
        VIEW_TYPE: 'artemis.loginView',
        TITLE: 'Artemis Login',
    },
    API: {
        ENDPOINTS: {
            AUTHENTICATE: '/api/core/public/authenticate',
            LOGOUT: '/api/core/public/logout',
            RENDER_PROBLEM_STATEMENT: '/api/exercise/problem-statement/render',
            EXTERNAL_LOGIN_TOKEN: '/api/core/public/external-login/token',
        },
        // Backstop against a server that accepts the connection but never responds.
        // Generous on purpose so slow networks are not falsely aborted; this only
        // prevents indefinite hangs on login/chat/API calls.
        REQUEST_TIMEOUT_MS: 30000,
        // Server-side logout is best-effort and the logout flow awaits it before
        // clearing local state, so it gets a much shorter backstop than other calls.
        LOGOUT_TIMEOUT_MS: 5000,
    },
} as const;

// VS Code Configuration keys
export const VSCODE_CONFIG = {
    ARTEMIS_SECTION: 'artemis',
    SERVER_URL_KEY: 'serverUrl',
    DEFAULT_COMMIT_MESSAGE_KEY: 'defaultCommitMessage',
    DEFAULT_CLONE_PATH_KEY: 'defaultClonePath',
    SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY: 'showSetDefaultClonePathPrompt',
    DEVELOPER_MODE_KEY: 'developerMode',
    SHOW_WEBSOCKET_STATUS_BAR_KEY: 'showWebSocketStatusBar',
    START_PAGE_KEY: 'startPage',
    SHOW_START_PAGE_SUGGESTION_KEY: 'showStartPageSuggestion',
    DATA_COLLECTION_CONSENT_KEY: 'dataCollectionConsent',
    STRUGGLE_DETECTION: {
        SECTION: 'artemis.struggleDetection',
        ENABLED_KEY: 'enabled',
        SHOW_INTERVENTIONS_KEY: 'showInterventions',
    },
} as const;

// File processing constants
export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB - Maximum file size for content inclusion

// WebSocket topic paths for STOMP subscriptions
export const WEBSOCKET_TOPICS = {
    NEW_RESULTS: '/user/topic/newResults',
    NEW_SUBMISSIONS: '/user/topic/newSubmissions',
    SUBMISSION_PROCESSING: '/user/topic/submissionProcessing',
    irisSession: (sessionId: number) => `/user/topic/iris/${sessionId}`,
} as const;
