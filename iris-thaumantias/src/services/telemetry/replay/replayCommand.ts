/**
 * VS Code command handler for session replay.
 *
 * Lists recorded sessions, lets the user pick one, replays it through
 * the current EQ pipeline, and writes replay-eq.jsonl to the session folder.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { RecordedEvent, SessionMetadata } from '../recording/types';
import { replaySession } from './replayEngine';

export async function executeReplayCommand(globalStorageUri: vscode.Uri): Promise<void> {
    const recordingsDir = path.join(globalStorageUri.fsPath, 'recordings');

    if (!fs.existsSync(recordingsDir)) {
        vscode.window.showWarningMessage('No recordings directory found.');
        return;
    }

    // List session folders
    const entries = fs.readdirSync(recordingsDir, { withFileTypes: true });
    const sessions: { id: string; metadata: SessionMetadata | null }[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(recordingsDir, entry.name, 'metadata.json');
        let metadata: SessionMetadata | null = null;
        if (fs.existsSync(metaPath)) {
            try {
                metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            } catch {
                // Skip invalid metadata
            }
        }
        sessions.push({ id: entry.name, metadata });
    }

    if (sessions.length === 0) {
        vscode.window.showWarningMessage('No recorded sessions found.');
        return;
    }

    // Sort newest first
    sessions.sort((a, b) => (b.metadata?.startTime ?? 0) - (a.metadata?.startTime ?? 0));

    // Build QuickPick items
    const items = sessions.map(s => {
        const date = s.metadata?.startTime
            ? new Date(s.metadata.startTime).toLocaleString()
            : 'unknown date';
        const exercise = s.metadata?.exerciseId
            ? `Exercise ${s.metadata.exerciseId}`
            : 'unknown exercise';
        return {
            label: `${exercise} — ${date}`,
            description: s.id,
            sessionId: s.id,
        };
    });

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a session to replay',
    });

    if (!picked) return;

    const sessionDir = path.join(recordingsDir, picked.sessionId);
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    if (!fs.existsSync(eventsPath)) {
        vscode.window.showErrorMessage(`events.jsonl not found in session ${picked.sessionId}`);
        return;
    }

    // Parse events
    const lines = fs.readFileSync(eventsPath, 'utf-8')
        .split('\n')
        .filter(l => l.trim().length > 0);
    const events: RecordedEvent[] = lines.map(l => JSON.parse(l));

    // Run replay
    const snapshots = replaySession(events);

    // Write replay-eq.jsonl
    const outputPath = path.join(sessionDir, 'replay-eq.jsonl');
    const output = snapshots.map(s => JSON.stringify(s)).join('\n');
    fs.writeFileSync(outputPath, output + (output.length > 0 ? '\n' : ''), 'utf-8');

    vscode.window.showInformationMessage(
        `Replay complete: ${snapshots.length} EQ snapshots generated → replay-eq.jsonl`,
    );
}
