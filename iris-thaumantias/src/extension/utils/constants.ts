// Configuration constants
export const CONFIG = {
    ARTEMIS_SERVER_URL_DEFAULT: 'https://artemis.tum.de',
    AUTH_COOKIE_NAME: 'jwt',
    SECRET_KEYS: {
        ARTEMIS_TOKEN: 'artemis-auth-token',
        ARTEMIS_SERVER_URL: 'artemis-server-url',
    },
    WEBVIEW: {
        VIEW_TYPE: 'artemis.loginView',
        TITLE: 'Artemis Login',
    },
    API: {
        ENDPOINTS: {
            AUTHENTICATE: '/api/core/public/authenticate',
        },
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
