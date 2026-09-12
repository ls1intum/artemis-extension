// extension/src/extension/services/sensing/sequence.ts
/**
 * Strictly monotonic ordering token for sensor events. All sensing and
 * session-lifecycle code runs on the extension host's single JS thread, so
 * consuming one counter yields a strict total order: an event that happened
 * before another always carries a smaller token. Used where timestamp
 * comparison would be ambiguous within one millisecond (decision log #1b).
 */
let counter = 0;

export function nextSensorSeq(): number {
    counter += 1;
    return counter;
}
