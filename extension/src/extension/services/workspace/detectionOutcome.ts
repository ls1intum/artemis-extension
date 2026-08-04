/**
 * What a workspace-detection run concluded.
 *
 * `unavailable` exists so a server we could not reach is never rendered as
 * "this folder is not an exercise". The two look identical to the student and
 * only one of them is worth a Retry.
 *
 * `courseId` is required on `matched`: the chat's acquisition needs it, and a
 * match without one would consume the startup latch, suppress the cold-start
 * chooser and leave nothing on screen to act on.
 */
export type DetectionOutcome =
    | { kind: 'matched'; exerciseId: number; courseId: number }
    | { kind: 'no-match' }
    | { kind: 'unavailable' };
