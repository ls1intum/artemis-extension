/**
 * Which of a student's participations is the one on screen, shared by the extension host and the
 * webview so the two cannot answer it differently.
 *
 * Artemis' `ParticipationService.getSpecificStudentParticipation` filters on
 * `!!participation.testRun === testRun` and takes the first match, driving the flag from an
 * explicit UI mode. An IDE has no such toggle but knows which repository is checked out, which is
 * what `isPractice` carries here. The first participation is the fallback rather than nothing, so
 * an exercise with a single one resolves to it whatever its `testRun` says.
 */
export function selectParticipation<P extends { testRun?: boolean }>(
    participations: readonly P[] | undefined,
    isPractice: boolean,
): P | undefined {
    const all = participations ?? [];
    // Coerced like Artemis does: the field is optional on the wire, and absent means graded.
    return all.find(p => !!p.testRun === isPractice) ?? all[0];
}
