import type { RecordedEvent, SessionMetadata, SessionStartEvent } from './types';
import type { LoadedSession } from './types';

/**
 * Resolve the schema version for a session.
 *
 * Precedence (highest to lowest):
 *   1. metadata.schemaVersion  — written by storageWriter at flush time
 *   2. firstSessionStartEvent.schemaVersion — written inline by recorder
 *   3. 1 — legacy recordings that pre-date versioning
 */
export function resolveSchemaVersion(
    metadata: SessionMetadata | undefined | null,
    firstSessionStartEvent: SessionStartEvent | undefined,
): number {
    if (metadata?.schemaVersion != null) return metadata.schemaVersion;
    if (firstSessionStartEvent?.schemaVersion != null) return firstSessionStartEvent.schemaVersion;
    return 1;
}

export function parseEventsFile(text: string): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        try {
            events.push(JSON.parse(line) as RecordedEvent);
        } catch {
            console.warn(`[parseSession] Skipping malformed JSONL line ${i + 1}: ${line.slice(0, 80)}`);
        }
    }
    return events;
}

export function parseMetadataFile(text: string): SessionMetadata {
    return JSON.parse(text) as SessionMetadata;
}

/**
 * Parse files from a session folder drop.
 * Expects an events.jsonl and optionally a metadata.json.
 */
export async function parseDroppedFiles(files: FileList): Promise<LoadedSession> {
    let metadata: SessionMetadata | null = null;
    let events: RecordedEvent[] = [];
    let fileName = 'unknown';

    for (const file of Array.from(files)) {
        const text = await file.text();
        const name = file.name.toLowerCase();

        if (name === 'metadata.json') {
            try {
                metadata = parseMetadataFile(text);
            } catch {
                metadata = null;
            }
        } else if (name === 'events.jsonl') {
            events = parseEventsFile(text);
            fileName = file.name;
        }
    }

    // If only a single .jsonl file was dropped
    if (events.length === 0 && files.length === 1) {
        const text = await files[0].text();
        events = parseEventsFile(text);
        fileName = files[0].name;
    }

    const firstSessionStart = events.find((e): e is SessionStartEvent => e.type === 'sessionStart');
    const schemaVersion = resolveSchemaVersion(metadata, firstSessionStart);

    return { metadata, events, fileName, schemaVersion };
}
