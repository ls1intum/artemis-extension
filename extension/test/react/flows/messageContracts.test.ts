/**
 * Message contract drift detection tests.
 *
 * These tests verify that the type-safe postMessage contracts between webview
 * and extension host remain structurally sound. They catch contract drift when
 * someone modifies a message type without updating all consumers.
 *
 * Approach:
 * - TypeScript satisfies operator for compile-time shape verification
 * - Runtime shape assertions for key contracts
 * - Union membership checks to verify all required types exist
 *
 * Per CONTEXT.md: dedicated tests for type-safe contract verification.
 */
import { describe, expect, it } from 'vitest';

import type { ExtensionToWebviewMessage, ExtMsg, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { isExtensionMessage, isWebviewMessage } from '@shared/messageContracts';

// ============================================================================
// Extension → Webview message types exist and have correct shape
// ============================================================================

describe('Message contracts: ExtensionToWebviewMessage types', () => {
    it('LoginSuccessMessage has required type and payload fields', () => {
        const msg = {
            type: 'loginSuccess' as const,
            username: 'testuser',
        } satisfies ExtMsg<'loginSuccess'>;

        expect(msg.type).toBe('loginSuccess');
        expect(msg.username).toBe('testuser');
    });

    it('LoginErrorMessage has required type and error fields', () => {
        const msg = {
            type: 'loginError' as const,
            error: 'Invalid credentials',
        } satisfies ExtMsg<'loginError'>;

        expect(msg.type).toBe('loginError');
        expect(msg.error).toBe('Invalid credentials');
    });

    it('CourseListInitMessage has required payload.courses array', () => {
        const msg = {
            type: 'courseListInit' as const,
            courses: [
                { course: { id: 1, title: 'Test Course' } },
            ],
        } satisfies ExtMsg<'courseListInit'>;

        expect(msg.type).toBe('courseListInit');
        expect(Array.isArray(msg.courses)).toBe(true);
        expect(msg.courses[0].course.id).toBe(1);
    });

    it('UpdateWebSocketStatusMessage has correct type and status field', () => {
        const disconnected = {
            type: 'updateWebSocketStatus' as const,
            status: 'disconnected',
        } satisfies ExtMsg<'updateWebSocketStatus'>;

        const connected = {
            type: 'updateWebSocketStatus' as const,
            status: 'connected',
        } satisfies ExtMsg<'updateWebSocketStatus'>;

        expect(disconnected.type).toBe('updateWebSocketStatus');
        expect(disconnected.status).toBe('disconnected');
        expect(connected.status).toBe('connected');
    });

    it('HealthCheckResultsMessage has required payload.results record shape', () => {
        const msg = {
            type: 'healthCheckResults' as const,
            results: {
                artemisApi: {
                    status: 'online',
                    message: 'Connected',
                    endpoint: 'https://artemis.tum.de/api',
                    httpStatus: 200,
                    response: 'OK',
                },
            },
        } satisfies ExtMsg<'healthCheckResults'>;

        expect(msg.type).toBe('healthCheckResults');
        expect(msg.results['artemisApi'].status).toBe('online');
    });

    it('ServiceStatusInitMessage has optional payload.serverUrl field', () => {
        const withUrl = {
            type: 'serviceStatusInit' as const,
            serverUrl: 'https://artemis.tum.de',
        } satisfies ExtMsg<'serviceStatusInit'>;

        const withoutUrl = {
            type: 'serviceStatusInit' as const,
        } as ExtMsg<'serviceStatusInit'>;

        expect(withUrl.serverUrl).toBe('https://artemis.tum.de');
        expect(withoutUrl.serverUrl).toBeUndefined();
    });

    it('GitIdentityInfoMessage has name and email fields', () => {
        const msg = {
            type: 'gitIdentityInfo' as const,
            name: 'John Doe',
            email: 'john@tum.de',
        } satisfies ExtMsg<'gitIdentityInfo'>;

        expect(msg.name).toBe('John Doe');
        expect(msg.email).toBe('john@tum.de');
    });

    it('GitCredentialsResultMessage has status and message fields', () => {
        const success = {
            type: 'gitCredentialsResult' as const,
            status: 'success' as const,
            message: 'Git credentials saved successfully',
        } satisfies ExtMsg<'gitCredentialsResult'>;

        expect(success.status).toBe('success');
        expect(success.message).toBe('Git credentials saved successfully');
    });

    it('IrisChatAddMessage has correct message shape', () => {
        const msg = {
            type: 'addMessage' as const,
            localSessionId: 'session-local-1',
            message: {
                id: 1,
                role: 'assistant' as const,
                content: 'Hello, how can I help you?',
                timestamp: 1_700_000_000_000,
            },
        } satisfies ExtMsg<'addMessage'>;

        expect(msg.type).toBe('addMessage');
        expect(msg.message.role).toBe('assistant');
        expect(msg.message.content).toBe('Hello, how can I help you?');
    });

    it('WebSocketUpdateMessage discriminates on updateType for newResult', () => {
        const msg = {
            type: 'websocketUpdate' as const,
            updateType: 'newResult' as const,
            data: {
                id: 1,
                successful: true,
                completionDate: '2024-01-01T12:00:00Z',
            },
        } satisfies ExtMsg<'websocketUpdate'>;

        expect(msg.updateType).toBe('newResult');
    });

    it('UpdateIrisRunUiMessage has a well-formed run-UI projection', () => {
        const msg = {
            type: 'updateIrisRunUi' as const,
            projection: {
                localSessionId: 'session-local-1',
                revision: 3,
                draft: { runId: 'run-1', text: 'partial answer...' },
                activities: [],
                waiting: true,
                runState: 'RUNNING' as const,
            },
        } satisfies ExtMsg<'updateIrisRunUi'>;

        expect(msg.type).toBe('updateIrisRunUi');
        expect(msg.projection.localSessionId).toBe('session-local-1');
        expect(msg.projection.draft?.runId).toBe('run-1');
        expect(msg.projection.runState).toBe('RUNNING');
    });

    it('IrisChatAddMessage is valid without runUi (non-run bubble, e.g. provider error)', () => {
        const msg = {
            type: 'addMessage' as const,
            localSessionId: 'session-local-1',
            message: {
                role: 'assistant' as const,
                content: 'Error: something went wrong',
                timestamp: 1_700_000_000_000,
            },
        } satisfies ExtMsg<'addMessage'>;

        expect(msg.type).toBe('addMessage');
        expect('runUi' in msg).toBe(false);
    });
});

// ============================================================================
// Webview → Extension message types exist and have correct shape
// ============================================================================

describe('Message contracts: WebviewToExtensionMessage types', () => {
    it('ReadyMessage has type=ready', () => {
        const msg = {
            type: 'ready' as const,
        } satisfies Extract<WebviewToExtensionMessage, { type: 'ready' }>;

        expect(msg.type).toBe('ready');
    });

    it('LoginCommand has type=command, command=login, and payload fields', () => {
        const msg = {
            type: 'command' as const,
            command: 'login' as const,
            payload: {
                username: 'student1',
                password: 'secret',
                rememberMe: true,
            },
        } satisfies WebCmd<'login'>;

        expect(msg.command).toBe('login');
        expect(msg.payload.username).toBe('student1');
        expect(msg.payload.rememberMe).toBe(true);
    });

    it('LogoutCommand has type=command, command=logout (no payload)', () => {
        const msg = {
            type: 'command' as const,
            command: 'logout' as const,
        } satisfies WebCmd<'logout'>;

        expect(msg.command).toBe('logout');
        expect('payload' in msg).toBe(false);
    });

    it('ReloadCoursesCommand has type=command, command=reloadCourses', () => {
        const msg = {
            type: 'command' as const,
            command: 'reloadCourses' as const,
        } satisfies WebCmd<'reloadCourses'>;

        expect(msg.command).toBe('reloadCourses');
    });

    it('ViewCourseDetailsCommand has courseId payload', () => {
        const msg = {
            type: 'command' as const,
            command: 'viewCourseDetails' as const,
            payload: { courseId: 1 },
        } satisfies WebCmd<'viewCourseDetails'>;

        expect(msg.command).toBe('viewCourseDetails');
        expect(msg.payload.courseId).toBe(1);
    });

    it('SendMessageCommand has text + correlation IDs payload', () => {
        const msg = {
            type: 'command' as const,
            command: 'sendMessage' as const,
            payload: {
                text: 'What is a for loop?',
                localId: 'msg-local-1',
                localSessionId: 'session-local-1',
            },
        } satisfies WebCmd<'sendMessage'>;

        expect(msg.payload.text).toBe('What is a for loop?');
        expect(msg.payload.localId).toBe('msg-local-1');
        expect(msg.payload.localSessionId).toBe('session-local-1');
    });

    it('SelectChatContextCommand has context, itemId, and itemName payload', () => {
        const msg = {
            type: 'command' as const,
            command: 'selectChatContext' as const,
            payload: {
                context: 'exercise',
                itemId: 5,
                itemName: 'Hello World Exercise',
            },
        } satisfies WebCmd<'selectChatContext'>;

        expect(msg.payload.context).toBe('exercise');
        expect(msg.payload.itemId).toBe(5);
    });

    it('BackToDashboardCommand has type=command, command=backToDashboard', () => {
        const msg = {
            type: 'command' as const,
            command: 'backToDashboard' as const,
        } satisfies WebCmd<'backToDashboard'>;

        expect(msg.command).toBe('backToDashboard');
    });

    it('PerformHealthChecksCommand has serverUrl payload', () => {
        const msg = {
            type: 'command' as const,
            command: 'performHealthChecks' as const,
            payload: { serverUrl: 'https://artemis.tum.de' },
        } satisfies WebCmd<'performHealthChecks'>;

        expect(msg.payload.serverUrl).toBe('https://artemis.tum.de');
    });

    it('CloneRepositoryCommand has all required clone fields', () => {
        const msg = {
            type: 'command' as const,
            command: 'cloneRepository' as const,
            payload: {
                participationId: 123,
                repositoryUri: 'https://github.com/repo.git',
                exerciseTitle: 'Hello World',
            },
        } satisfies WebCmd<'cloneRepository'>;

        expect(msg.payload.participationId).toBe(123);
        expect(msg.payload.repositoryUri).toBe('https://github.com/repo.git');
        expect(msg.payload.exerciseTitle).toBe('Hello World');
    });

    it('SubmitExerciseCommand has participationId payload', () => {
        const msg = {
            type: 'command' as const,
            command: 'submitExercise' as const,
            payload: { participationId: 456 },
        } satisfies WebCmd<'submitExercise'>;

        expect(msg.payload.participationId).toBe(456);
    });

    it('ErrorMessage (webview→extension) has error payload with message field', () => {
        const msg = {
            type: 'error' as const,
            payload: {
                message: 'Uncaught error in component',
                stack: 'Error: ...',
                componentStack: '    at ComponentName',
            },
        } satisfies Extract<WebviewToExtensionMessage, { type: 'error' }>;

        expect(msg.type).toBe('error');
        expect(msg.payload.message).toBe('Uncaught error in component');
    });

    it('ReconnectWebSocketCommand has correct shape', () => {
        const msg = {
            type: 'command' as const,
            command: 'reconnectWebSocket' as const,
        } satisfies WebCmd<'reconnectWebSocket'>;

        expect(msg.command).toBe('reconnectWebSocket');
    });
});

// ============================================================================
// Type guards: isExtensionMessage and isWebviewMessage
// ============================================================================

describe('Message contracts: type guards', () => {
    it('isExtensionMessage accepts valid extension→webview message', () => {
        const msg = { type: 'loginSuccess', username: 'test' };
        expect(isExtensionMessage(msg)).toBe(true);
    });

    it('isExtensionMessage accepts courseListInit message', () => {
        const msg = { type: 'courseListInit', courses: [] };
        expect(isExtensionMessage(msg)).toBe(true);
    });

    it('isExtensionMessage accepts updateWebSocketStatus message', () => {
        const msg = { type: 'updateWebSocketStatus', status: 'disconnected' };
        expect(isExtensionMessage(msg)).toBe(true);
    });

    it('isExtensionMessage accepts updateIrisState message', () => {
        const msg = {
            type: 'updateIrisState',
            state: {
                context: null,
                activeSessionId: null,
                sessions: [],
                exercises: [],
                courses: [],
            },
        };
        expect(isExtensionMessage(msg)).toBe(true);
    });

    it('isExtensionMessage rejects null', () => {
        expect(isExtensionMessage(null)).toBe(false);
    });

    it('isExtensionMessage rejects undefined', () => {
        expect(isExtensionMessage(undefined)).toBe(false);
    });

    it('isExtensionMessage rejects unknown type string', () => {
        const msg = { type: 'unknownExtensionMessage' };
        expect(isExtensionMessage(msg)).toBe(false);
    });

    it('isExtensionMessage rejects message with no type field', () => {
        const msg = { command: 'login', payload: {} };
        expect(isExtensionMessage(msg)).toBe(false);
    });

    it('isWebviewMessage accepts valid webview→extension message (ready)', () => {
        const msg = { type: 'ready' };
        expect(isWebviewMessage(msg)).toBe(true);
    });

    it('isWebviewMessage accepts command type messages', () => {
        const msg = {
            type: 'command',
            command: 'login',
            payload: { username: 'test', password: 'pass', rememberMe: false },
        };
        expect(isWebviewMessage(msg)).toBe(true);
    });

    it('isWebviewMessage accepts error type messages', () => {
        const msg = { type: 'error', payload: { message: 'Test error' } };
        expect(isWebviewMessage(msg)).toBe(true);
    });

    it('isWebviewMessage rejects null', () => {
        expect(isWebviewMessage(null)).toBe(false);
    });

    it('isWebviewMessage rejects unknown type string', () => {
        const msg = { type: 'someWebviewMessage' };
        expect(isWebviewMessage(msg)).toBe(false);
    });

    it('isWebviewMessage rejects message with non-string type', () => {
        const msg = { type: 42 };
        expect(isWebviewMessage(msg)).toBe(false);
    });

    it('isWebviewMessage accepts problemStatementScroll command with payload', () => {
        const msg = {
            type: 'command', command: 'problemStatementScroll',
            payload: { scrollTop: 0, scrollHeight: 2000, viewportHeight: 800, statementTop: 900, statementHeight: 1000 },
        };
        expect(isWebviewMessage(msg)).toBe(true);
    });

    it('isWebviewMessage rejects problemStatementSelection command without payload', () => {
        const msg = { type: 'command', command: 'problemStatementSelection' };
        expect(isWebviewMessage(msg)).toBe(false);
    });
});

// ============================================================================
// Runtime shape validation: required fields present in key contracts
// ============================================================================

describe('Message contracts: runtime shape validation', () => {
    it('ExtensionToWebviewMessage union accepts all expected type discriminators', () => {
        // Spot-check that key types are assignable to the union
        const loginSuccess: ExtensionToWebviewMessage = {
            type: 'loginSuccess',
            username: 'test',
        };
        const courseList: ExtensionToWebviewMessage = {
            type: 'courseListInit',
            courses: [],
        };
        const wsStatus: ExtensionToWebviewMessage = {
            type: 'updateWebSocketStatus',
            status: 'disconnected',
        };
        const dashboardInit: ExtensionToWebviewMessage = {
            type: 'dashboardInit',
            courses: [],
        };

        expect(loginSuccess.type).toBe('loginSuccess');
        expect(courseList.type).toBe('courseListInit');
        expect(wsStatus.type).toBe('updateWebSocketStatus');
        expect(dashboardInit.type).toBe('dashboardInit');
    });

    it('WebviewToExtensionMessage union accepts all expected command types', () => {
        // Spot-check command messages are assignable to the union
        const ready: WebviewToExtensionMessage = { type: 'ready' };
        const login: WebviewToExtensionMessage = {
            type: 'command',
            command: 'login',
            payload: { username: 'u', password: 'p', rememberMe: false },
        };
        const reload: WebviewToExtensionMessage = {
            type: 'command',
            command: 'reloadCourses',
        };
        const errorMsg: WebviewToExtensionMessage = {
            type: 'error',
            payload: { message: 'Component crashed' },
        };

        expect(ready.type).toBe('ready');
        expect(login.type).toBe('command');
        expect(reload.type).toBe('command');
        expect(errorMsg.type).toBe('error');
    });

    it('postMessage payload shapes satisfy contract for login flow', () => {
        // Simulate complete login flow: webview sends login, extension responds
        const loginMsg: WebviewToExtensionMessage = {
            type: 'command',
            command: 'login',
            payload: {
                username: 'student@tum.de',
                password: 'mypassword',
                rememberMe: true,
            },
        };

        const successResponse: ExtensionToWebviewMessage = {
            type: 'loginSuccess',
            username: 'student@tum.de',
        };

        const errorResponse: ExtensionToWebviewMessage = {
            type: 'loginError',
            error: 'Invalid credentials',
        };

        expect(loginMsg).toMatchObject({ type: 'command', command: 'login' });
        expect(successResponse).toMatchObject({ type: 'loginSuccess' });
        expect(errorResponse).toMatchObject({ type: 'loginError' });
    });

    it('postMessage payload shapes satisfy contract for course navigation flow', () => {
        // Simulate course load flow
        const reloadCmd: WebviewToExtensionMessage = {
            type: 'command',
            command: 'reloadCourses',
        };

        const courseListResponse: ExtensionToWebviewMessage = {
            type: 'courseListInit',
            courses: [
                { course: { id: 1, title: 'Algorithms & Data Structures' } },
            ],
        };

        expect(reloadCmd).toMatchObject({ command: 'reloadCourses' });
        expect(courseListResponse).toMatchObject({ type: 'courseListInit' });
        expect(Array.isArray(courseListResponse.courses)).toBe(true);
    });

    it('dispatchExtensionMessage payloads match contract shapes for websocket status', () => {
        // Verify websocket status contracts are well-formed
        const disconnectedMsg: ExtensionToWebviewMessage = { type: 'updateWebSocketStatus', status: 'disconnected' };
        const connectedMsg: ExtensionToWebviewMessage = { type: 'updateWebSocketStatus', status: 'connected' };

        expect(isExtensionMessage(disconnectedMsg)).toBe(true);
        expect(isExtensionMessage(connectedMsg)).toBe(true);
    });

    it('optional fields in contracts are genuinely optional', () => {
        // CourseListInitMessage.archivedCourses is optional
        const withArchived: ExtensionToWebviewMessage = {
            type: 'courseListInit',
            courses: [],
            archivedCourses: [{ id: 1, title: 'Old Course' }],
        };

        const withoutArchived: ExtensionToWebviewMessage = {
            type: 'courseListInit',
            courses: [],
        };

        // Both are valid — optional fields work correctly
        expect(withArchived.type).toBe('courseListInit');
        expect(withoutArchived.type).toBe('courseListInit');
    });
});
