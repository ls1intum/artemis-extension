/**
 * Which of a student's participations is the one on screen, shared by the
 * extension host and the webview so the two cannot answer it differently.
 *
 * Artemis' own client (`ParticipationService.getSpecificStudentParticipation`)
 * filters on `!!participation.testRun === testRun` and takes the first match.
 * It drives that flag from an explicit graded/practice UI mode; an IDE has no
 * such toggle but does know which repository the student has checked out, so
 * that is what `isPractice` carries here.
 *
 * The first participation is the fallback rather than nothing, matching
 * Artemis: an exercise with a single participation must resolve to it whatever
 * its `testRun` says.
 */
export function selectParticipation<P extends { testRun?: boolean }>(
    participations: readonly P[] | undefined,
    isPractice: boolean,
): P | undefined {
    const all = participations ?? [];
    // Coerced, like Artemis does: the field is optional on the wire, and a
    // participation whose `testRun` is absent is a graded one.
    return all.find(p => !!p.testRun === isPractice) ?? all[0];
}
