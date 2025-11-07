// Configuration constants
export const CONFIG = {
    ARTEMIS_SERVER_URL_DEFAULT: 'https://artemis.tum.de',
    AUTH_COOKIE_NAME: 'jwt',
    SECRET_KEYS: {
        AUTH_COOKIE: 'artemis-auth-cookie',
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
            ACCOUNT: '/api/core/public/account',
            COURSES: '/api/core/courses',
            EXERCISES: '/api/core/courses/{courseId}/exercises',
            PARTICIPATIONS: '/api/core/participations',
            RESULTS: '/api/core/participations/{participationId}/results',
            VCS_TOKEN: '/api/core/account/participation-vcs-access-token',
            START_PARTICIPATION: '/api/exercise/exercises/{exerciseId}/participations',
        },
        USER_AGENT: 'VS Code Extension',
    },
} as const;

// VS Code Configuration keys
export const VSCODE_CONFIG = {
    ARTEMIS_SECTION: 'artemis',
    SERVER_URL_KEY: 'serverUrl',
    THEME_KEY: 'theme',
    SHOW_IRIS_EXPLANATION_KEY: 'showIrisExplanation',
    DEFAULT_COMMIT_MESSAGE_KEY: 'defaultCommitMessage',
} as const;

// File processing constants
export const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB - Maximum file size for content inclusion
