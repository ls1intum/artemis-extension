import type { ServerContext } from '@shared/types/serverContext';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';

function describeContext(context: ServerContext | undefined): string {
    return context ? `${context.mode}/${context.entityId}${context.name ? ` (${context.name})` : ''}` : 'none';
}

export class ChatDiagnosticsService {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _exerciseRegistry: ExerciseRegistry,
        /**
         * A GETTER, not a value: the conversation service is built after this
         * one in the provider's constructor. Same house pattern as
         * `ChatViewStatePresenter`.
         */
        private readonly _getConversation: () => IrisConversationService | undefined = () => undefined,
    ) { }

    public generateDiagnosticsReport(): string {
        const snapshot = this._contextStore.snapshot();
        let report = '='.repeat(80) + '\n';
        report += '🐛 IRIS CHAT DIAGNOSTICS\n';
        report += 'Generated at: ' + new Date().toISOString() + '\n';
        report += '='.repeat(80) + '\n\n';

        report += this._conversationSection();

        report += `💻 EXERCISES (${snapshot.exercises.length}):\n`;
        if (snapshot.exercises.length > 0) {
            snapshot.exercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}${exercise.isWorkspace ? ' ⭐' : ''}\n`;
                report += `     Short Name: ${exercise.shortName ?? '—'}\n`;
                report += `     Course ID: ${exercise.courseId ?? '—'}\n`;
                if (exercise.releaseDate) {
                    report += `     Release: ${exercise.releaseDate}\n`;
                }
                if (exercise.dueDate) {
                    report += `     Due: ${exercise.dueDate}\n`;
                }
                if (exercise.lastViewed) {
                    report += `     Last Viewed: ${new Date(exercise.lastViewed).toISOString()}\n`;
                }
            });
        } else {
            report += '  No exercises tracked\n';
        }

        report += `\n📚 COURSES (${snapshot.courses.length}):\n`;
        if (snapshot.courses.length > 0) {
            snapshot.courses.forEach((course, idx) => {
                report += `  ${idx + 1}. [${course.id}] ${course.title}\n`;
                report += `     Short Name: ${course.shortName ?? '—'}\n`;
                if (course.lastViewed) {
                    report += `     Last Viewed: ${new Date(course.lastViewed).toISOString()}\n`;
                }
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

    /**
     * The open conversation, which is what this report is mostly asked about.
     * The removed "Debug Sessions (Raw)" command described the local session
     * store that no longer exists; this describes what replaced it.
     */
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
