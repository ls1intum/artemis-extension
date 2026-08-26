import type { ServerContext } from '@shared/types/serverContext';

import type { CourseCatalog } from '@extension/services/courseCatalog';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { SessionIdentityReader } from '@extension/services/session/sessionIdentityCoordinator';
import type { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';

function describeContext(context: ServerContext | undefined): string {
    return context ? `${context.mode}/${context.entityId}${context.name ? ` (${context.name})` : ''}` : 'none';
}

function describeSession(session: SessionIdentityReader): string {
    const { state } = session;
    const identity = state.kind === 'authenticated'
        ? `authenticated ${state.principal} on ${state.serverKey}`
        : `${state.kind} on ${state.serverKey}`;
    return `${identity}, epoch ${session.epoch}`;
}

export class ChatDiagnosticsService {
    constructor(
        private readonly _catalog: CourseCatalog | undefined,
        private readonly _workspaceTracker: WorkspaceExerciseTracker,
        private readonly _session: SessionIdentityReader,
        private readonly _exerciseRegistry: ExerciseRegistry,
        /**
         * A GETTER, not a value. `_conversation` would work as a value in
         * production: it is assigned once, before this collaborator, and never
         * replaced. It is read at call time because the chat's white-box tests
         * install a conversation double after construction. See #440.
         */
        private readonly _getConversation: () => IrisConversationService | undefined,
    ) { }

    public generateDiagnosticsReport(): string {
        const projection = this._catalog?.projection() ?? { courses: [], exercises: [] };
        let report = '='.repeat(80) + '\n';
        report += '🐛 IRIS CHAT DIAGNOSTICS\n';
        report += 'Generated at: ' + new Date().toISOString() + '\n';
        report += '='.repeat(80) + '\n\n';

        // Diagnostics is where a support request starts: which account,
        // which server, which generation is the first question.
        report += `🔑 SESSION: ${describeSession(this._session)}\n\n`;

        report += this._conversationSection();

        const workspaceExercise = this._workspaceTracker.current;
        report += '💻 WORKSPACE EXERCISE:\n';
        if (workspaceExercise) {
            report += `  [${workspaceExercise.id}] ${workspaceExercise.title}\n`;
            report += `     Short Name: ${workspaceExercise.shortName ?? '—'}\n`;
            report += `     Course ID: ${workspaceExercise.courseId}\n`;
        } else {
            report += '  No workspace exercise tracked\n';
        }

        report += `\n💻 EXERCISES (${projection.exercises.length}) - live catalog\n`;
        if (projection.exercises.length > 0) {
            projection.exercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}\n`;
                report += `     Short Name: ${exercise.shortName ?? '—'}\n`;
                report += `     Course ID: ${exercise.courseId}\n`;
                if (exercise.releaseDate) {
                    report += `     Release: ${exercise.releaseDate}\n`;
                }
                if (exercise.dueDate) {
                    report += `     Due: ${exercise.dueDate}\n`;
                }
            });
        } else {
            report += '  No exercises tracked\n';
        }

        report += `\n📚 COURSES (${projection.courses.length}) - live catalog\n`;
        if (projection.courses.length > 0) {
            projection.courses.forEach((course, idx) => {
                report += `  ${idx + 1}. [${course.id}] ${course.title}\n`;
                report += `     Short Name: ${course.shortName ?? '—'}\n`;
            });
        } else {
            report += '  No courses tracked\n';
        }

        const registry = this._exerciseRegistry;
        const registeredExercises = registry.getAllExercises();
        report += `\n📘 EXERCISE REGISTRY (${registeredExercises.length} total):\n`;
        if (registeredExercises.length > 0) {
            registeredExercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}\n`;
                report += `     Repository: ${exercise.repositoryUri}\n`;
            });
        } else {
            report += '  Registry is empty\n';
        }

        return report;
    }

    /** The open conversation, which is what this report is mostly asked about. */
    private _conversationSection(): string {
        const conversation = this._getConversation();
        if (!conversation) {
            return '💬 CONVERSATION:\n  No conversation service (no Artemis API or websocket service)\n\n';
        }
        const snapshot = conversation.state.snapshot();
        let section = '💬 CONVERSATION:\n';
        section += `  Session ID: ${snapshot.currentSessionId ?? 'none'}\n`;
        section += `  Course ID: ${snapshot.courseId ?? 'none'}\n`;
        section += `  Title: ${snapshot.detail?.title ?? 'none'}\n`;
        section += `  Committed topic: ${describeContext(snapshot.committedContext)}\n`;
        section += `  Staged topic: ${describeContext(snapshot.pendingContext?.ctx)}\n`;
        section += `  Content state: ${conversation.state.contentState()}\n`;
        section += `  Messages (displayed / stored): ${conversation.state.displayMessageCount()} / ${snapshot.detail?.messages.length ?? 0}\n`;
        section += `  Send in flight: ${conversation.state.sendInFlight}\n`;
        section += `  Navigation in flight: ${conversation.navigationInFlight}\n`;
        section += `  Overview rows: ${snapshot.courseSessions.length} (+${snapshot.knownInvisible.length} known but unlisted)\n\n`;
        return section;
    }
}
