import * as vscode from 'vscode';
import { ContextStore } from '../contextStore';
import { ArtemisApiService } from '../../api';
import { ExerciseRegistry } from '../exerciseRegistry';
import { logger, LogLevel } from '../loggingService';
import { fetchSessionsWithMessages } from './sessionSyncUtils';

export class ChatDiagnosticsService {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _exerciseRegistry: ExerciseRegistry,
    ) { }

    public async handleOpenDiagnostics(): Promise<void> {
        const snapshot = this._contextStore.snapshot();
        let report = '='.repeat(80) + '\n';
        report += '🐛 IRIS CHAT DIAGNOSTICS\n';
        report += 'Generated at: ' + new Date().toISOString() + '\n';
        report += '='.repeat(80) + '\n\n';

        report += '📌 ACTIVE CONTEXT:\n';
        if (snapshot.activeContext) {
            report += `  Type: ${snapshot.activeContext.type}\n`;
            report += `  ID: ${snapshot.activeContext.id}\n`;
            report += `  Title: ${snapshot.activeContext.title}\n`;
            report += `  Short Name: ${snapshot.activeContext.shortName ?? '—'}\n`;
            report += `  Source: ${snapshot.activeContext.source}\n`;
            report += `  Locked: ${snapshot.activeContext.locked}\n`;
            report += `  Selected At: ${new Date(snapshot.activeContext.selectedAt).toISOString()}\n`;
        } else {
            report += '  No context selected\n';
        }

        report += '\n💬 ACTIVE SESSION:\n';
        if (snapshot.activeSession) {
            report += `  ID: ${snapshot.activeSession.id}\n`;
            report += `  Preview: ${snapshot.activeSession.preview}\n`;
            report += `  Messages: ${snapshot.activeSession.messageCount}\n`;
            report += `  Created: ${new Date(snapshot.activeSession.createdAt).toISOString()}\n`;
            report += `  Last Activity: ${new Date(snapshot.activeSession.lastActivity).toISOString()}\n`;
        } else {
            report += '  No session available\n';
        }

        report += `\n🗂️  SESSIONS (${snapshot.sessions.length} total):\n`;
        if (snapshot.sessions.length > 0) {
            snapshot.sessions.forEach((session, idx) => {
                report += `  ${idx + 1}. ${session.id}\n`;
                report += `     Preview: ${session.preview}\n`;
                report += `     Messages: ${session.messageCount}\n`;
                report += `     Created: ${new Date(session.createdAt).toISOString()}\n`;
                report += `     Last Activity: ${new Date(session.lastActivity).toISOString()}\n`;
            });
        } else {
            report += '  No sessions recorded\n';
        }

        report += `\n💻 RECENT EXERCISES (${snapshot.recentExercises.length}):\n`;
        if (snapshot.recentExercises.length > 0) {
            snapshot.recentExercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}${exercise.isWorkspace ? ' ⭐' : ''}\n`;
                report += `     Short Name: ${exercise.shortName ?? '—'}\n`;
                report += `     Priority: ${exercise.priority}\n`;
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
            report += '  No recent exercises tracked\n';
        }

        report += `\n📚 RECENT COURSES (${snapshot.recentCourses.length}):\n`;
        if (snapshot.recentCourses.length > 0) {
            snapshot.recentCourses.forEach((course, idx) => {
                report += `  ${idx + 1}. [${course.id}] ${course.title}\n`;
                report += `     Short Name: ${course.shortName ?? '—'}\n`;
                report += `     Priority: ${course.priority}\n`;
                if (course.lastViewed) {
                    report += `     Last Viewed: ${new Date(course.lastViewed).toISOString()}\n`;
                }
            });
        } else {
            report += '  No recent courses tracked\n';
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

        const document = await vscode.workspace.openTextDocument({
            content: report,
            language: 'plaintext',
        });
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active,
        });
    }

    public async handleDebugSessions(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            vscode.window.showWarningMessage('No context selected. Please select an exercise or course first.');
            return;
        }

        if (!this._artemisApiService) {
            vscode.window.showErrorMessage('Artemis API service not available');
            return;
        }

        try {
            let report = '='.repeat(80) + '\n';
            report += '🔍 RAW ARTEMIS SESSION DEBUG DATA\n';
            report += 'Generated at: ' + new Date().toISOString() + '\n';
            report += '='.repeat(80) + '\n\n';

            report += '📌 CURRENT CONTEXT:\n';
            report += `  Type: ${activeContext.type}\n`;
            report += `  ID: ${activeContext.id}\n`;
            report += `  Title: ${activeContext.title}\n`;
            report += `  Short Name: ${activeContext.shortName ?? '—'}\n\n`;

            report += '🌐 FETCHING SESSIONS FROM ARTEMIS...\n\n';

            // Fetch sessions with messages using shared utility
            const artemisSessionsListFromServer = await fetchSessionsWithMessages(this._artemisApiService, activeContext);

            report += `📊 TOTAL SESSIONS FOUND: ${artemisSessionsListFromServer.length}\n`;
            report += `   (All sessions are for ${activeContext.type} ${activeContext.id}: ${activeContext.title})\n`;
            report += '='.repeat(80) + '\n\n';

            // Also check local storage
            const snapshot = this._contextStore.snapshot();
            const contextKey = `${activeContext.type}:${activeContext.id}`;
            const localSessions = snapshot.sessions.filter(s => s.contextKey === contextKey);

            report += `💾 LOCAL STORAGE INFO:\n`;
            report += `   Context Key: ${contextKey}\n`;
            report += `   Local Sessions for this context: ${localSessions.length}\n`;
            report += `   All Local Sessions (all contexts): ${snapshot.sessions.length}\n`;
            if (snapshot.sessions.length > localSessions.length) {
                const otherContexts = new Set(snapshot.sessions.map(s => s.contextKey).filter(k => k !== contextKey));
                report += `   ⚠️  WARNING: Found sessions from other contexts: ${Array.from(otherContexts).join(', ')}\n`;
            }
            report += '\n';

            // Show what snapshot.sessions contains (this is what the UI displays)
            report += `📋 SNAPSHOT SESSIONS (what UI shows):\n`;
            report += `   Total in snapshot: ${snapshot.sessions.length}\n`;
            if (snapshot.sessions.length > 0) {
                snapshot.sessions.forEach((s, idx) => {
                    report += `   ${idx + 1}. Session ${s.id} (artemisId: ${s.artemisSessionId}) - contextKey: ${s.contextKey}\n`;
                    report += `      Preview: "${s.preview}"\n`;
                    report += `      Messages: ${s.messageCount}\n`;
                });
            }
            report += '\n' + '='.repeat(80) + '\n\n';

            if (artemisSessionsListFromServer.length === 0) {
                report += '⚠️  No sessions found on Artemis for this context.\n';
            } else {
                artemisSessionsListFromServer.forEach((session, idx) => {
                    report += `SESSION ${idx + 1}:\n`;
                    report += '-'.repeat(80) + '\n';
                    report += JSON.stringify(session, null, 2);
                    report += '\n\n';
                });
            }

            report += '='.repeat(80) + '\n';
            report += 'END OF DEBUG DATA\n';
            report += '='.repeat(80) + '\n';

            const document = await vscode.workspace.openTextDocument({
                content: report,
                language: 'json',
            });
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.Active,
            });

            vscode.window.showInformationMessage(`Found ${artemisSessionsListFromServer.length} session(s) on Artemis`);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error fetching debug session data:', undefined, error);
            vscode.window.showErrorMessage(`Failed to fetch sessions from Artemis: ${errorMessage}`);
        }
    }
}
