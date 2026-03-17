import type { RecordedEvent, SessionMetadata, LoadedSession } from './types';

export function parseEventsFile(text: string): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue;
        try {
            events.push(JSON.parse(line) as RecordedEvent);
        } catch {
            // Skip malformed JSONL lines
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
            metadata = parseMetadataFile(text);
        } else if (name.endsWith('.jsonl')) {
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

    return { metadata, events, fileName };
}
