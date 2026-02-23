# External Integrations

**Analysis Date:** 2026-02-23

## APIs & External Services

**Artemis Server (Primary Integration):**
- Artemis Learning Management System - Complete course/exercise management and feedback platform
  - SDK/Client: Custom REST client in `src/api/artemisApi.ts` using Fetch API
  - Base URL: Configurable via `artemis.serverUrl` (default: `https://artemis.tum.de`)
  - Auth: JWT cookie-based (httpOnly) stored in VS Code secrets
  - Connection: HTTPS REST endpoints + STOMP/WebSocket for real-time updates

**Iris (Embedded in Artemis):**
- LLM-based virtual assistant for student support
  - SDK/Client: REST endpoints via `ArtemisApiService`
  - Chat API: `/api/iris/course-chat/*` and `/api/iris/programming-exercise-chat/*`
  - Health: `/api/iris/courses/{courseId}/status`
  - Settings: `/api/iris/courses/{courseId}/iris-settings`
  - Auth: Same JWT cookie as Artemis

## Data Storage

**Databases:**
- Artemis PostgreSQL/MySQL backend
  - Connection: Handled server-side
  - Client: N/A - extension communicates only via REST API
  - Data accessed through Artemis endpoints

**VS Code Secrets Storage (Local):**
- Extension uses `context.secrets` API for credential storage
  - Stores JWT authentication cookie (`artemis-cookie`)
  - Stores Artemis server URL if changed from default
  - OS-level encryption (Keychain on macOS, Credential Manager on Windows, libsecret on Linux)

**Local File System:**
- Exercise repositories cloned to user-specified directory
  - Default clone path configurable via `artemis.defaultClonePath` setting
  - Git working directories for local development

**Caching:**
- None detected - real-time API calls for all data
- Chat history cached in memory during session
- Build status cached briefly via subscription handlers

## Authentication & Identity

**Auth Provider:**
- Artemis (Custom/LDAP/AD depending on institution)
  - Implementation: `src/auth/auth.ts` (AuthManager class)
  - Mechanism: Username/password → JWT cookie
  - Login endpoint: `/api/public/authentication`
  - Logout: Manual context clearing in extension
  - Token persistence: VS Code secrets storage (memory + optional disk)
  - Expiration handling: Auto-logout on 401, prompts re-authentication

**Session Management:**
- Per-user login state tracked in VS Code context
  - Context key: `iris:authenticated`
  - Triggers WebSocket reconnection on login/logout
  - Survives VS Code restarts if credentials stored

## Monitoring & Observability

**Error Tracking:**
- None detected - custom logging only

**Logging:**
- `src/services/loggingService.ts` - Custom logging service
  - Output: VS Code output channel (`Artemis` channel)
  - No external log aggregation
  - Log levels: INFO, WARN, ERROR with categories (API, WEBSOCKET, AUTH, etc.)
  - Console usage: Prohibited via ESLint (enforced with no-console rule)

## CI/CD & Deployment

**Hosting:**
- VS Code Extension Marketplace (published by aet-tum)
- Local installation from `.vsix` file also supported

**CI Pipeline:**
- GitHub Actions (infrastructure in `.github/`)
- Local build: `npm run package:vsix` → produces `.vsix` file
- Release process: Publish to marketplace via `vsce publish`

## Environment Configuration

**Required env vars:**
- `ARTEMIS_SERVER_URL` (optional, falls back to `https://artemis.tum.de`)
- Git credentials (handled by OS git client)

**Configuration Settings (VS Code settings.json):**
- `artemis.serverUrl` - Artemis server URL (string, default: `https://artemis.tum.de`)
- `artemis.iris.sendUncommittedChanges` - Allow Iris to see uncommitted files (boolean, default: true)
- `artemis.developerMode` - Show debugging tools (boolean, default: false)
- `artemis.debugMode` - Show WebSocket debug info (boolean, default: false)
- `artemis.defaultCommitMessage` - Auto-submit commit message (string, default: "Solution submission via Iris extension")
- `artemis.showUnsavedChangesWarning` - Warn on unsaved files (boolean, default: true)
- `artemis.defaultClonePath` - Default folder for cloning exercises (string, empty = ask each time)
- `artemis.showSetDefaultClonePathPrompt` - Prompt to set clone folder (boolean, default: true)
- `artemis.struggleDetection.enabled` - Enable struggle hints (boolean, default: true)
- `artemis.dataCollectionConsent` - Telemetry consent level (enum: pending|declined|basic|extended, default: pending)

**Secrets location:**
- VS Code `context.secrets` API
  - Stores: JWT cookie and server URL
  - Encrypted by OS keystore

## Webhooks & Callbacks

**Incoming:**
- None - all communication is pull-based (polling/subscriptions)

**Outgoing:**
- STOMP subscriptions to Artemis WebSocket topics:
  - Build result updates: `/user/topic/courses/{courseId}/exercises/{exerciseId}/submission/{submissionId}/result`
  - Submission processing: `/user/topic/exercises/{exerciseId}/submission/{participationId}/submission-processed`
  - Real-time status: Configurable per active exercise

## API Endpoint Summary

**Core APIs:**
- `GET /api/core/public/account` - Get current user
- `GET /api/core/courses` - List all courses
- `GET /api/core/courses/for-dashboard` - Dashboard with exercises/scores
- `GET /api/core/courses/{courseId}` - Single course details
- `GET /api/core/courses/{courseId}/for-dashboard` - Course dashboard entry
- `GET /api/core/participations` - List user participations
- `GET /api/core/participations/{participationId}/results` - Participation results
- `GET /api/core/account/participation-vcs-access-token` - Get/create VCS token

**Exercise APIs:**
- `GET /api/exercise/exercises/{exerciseId}/details` - Exercise with submissions/results
- `POST /api/exercise/exercises/{exerciseId}/participations` - Start exercise
- `POST /api/exercise/exercises/{exerciseId}/participations/practice` - Start practice
- `GET /api/programming/programming-exercise-participations/{participationId}/latest-pending-submission` - Pending build

**Build APIs:**
- `GET /api/programming/participations/{participationId}/buildlogs` - Build logs
- `GET /api/assessment/participations/{participationId}/results/{resultId}/details` - Result details

**Iris Chat APIs:**
- `POST /api/iris/course-chat/{courseId}/sessions/current` - Get/create course chat
- `POST /api/iris/programming-exercise-chat/{exerciseId}/sessions/current` - Get/create exercise chat
- `GET /api/iris/sessions/{sessionId}/messages` - Chat messages
- `POST /api/iris/sessions/{sessionId}/messages` - Send message (with optional uncommitted files)
- `PUT /api/iris/sessions/{sessionId}/messages/{messageId}/helpful` - Rate message
- `POST /api/iris/sessions/{sessionId}/messages/{messageId}/resend` - Resend message

**Iris Health/Settings:**
- `GET /api/iris/courses/{courseId}/status` - Iris health/rate limit
- `GET /api/iris/courses/{courseId}/iris-settings` - Iris configuration

**Exam APIs:**
- `GET /api/exam/courses/{courseId}/exams` - List exams
- `GET /api/exam/courses/{courseId}/exams/{examId}/own-student-exam` - Exam status
- `POST /api/exam/courses/{courseId}/exams/{examId}/student-exams/{studentExamId}/conduction` - Start exam
- `POST /api/exam/courses/{courseId}/exams/{examId}/student-exams/submit` - Submit exam

**Utility APIs:**
- `GET /api/programming/plantuml/svg` - PlantUML diagram rendering
- `GET /management/info` - Server profile info (checks if Iris profile active)

---

*Integration audit: 2026-02-23*
