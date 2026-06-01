import type { CommandHandler, CommandMap } from './types';

/** Merge extra handlers into target, failing closed on any command collision. */
export function mergeRecordingHandlers(
    target: Map<string, CommandHandler>,
    extra: CommandMap,
): void {
    for (const [command, handler] of Object.entries(extra)) {
        if (target.has(command)) {
            throw new Error(`Seam handler "${command}" collides with an existing handler`);
        }
        target.set(command, handler);
    }
}
