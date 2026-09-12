// Adapter for the server's `exercises-for-overview` projection.
//
// That endpoint replaced the deleted `courses/{id}/for-dashboard`, and it does not return the
// exercise entity: it sends a lean projection that omits, among others, the exercise-level
// `shortName` and `repositoryUri`. Mapping it field by field rather than casting the payload is
// the point of this file. `ExerciseDetail` is a permissive `[key: string]: unknown` interface, so
// a cast would let the absent fields through as silent `undefined` at every reader instead of
// being a decision made once, here.
//
// Jackson serializes the projection with `@JsonInclude(NON_EMPTY)`, so an empty collection or a
// null scalar is absent from the JSON rather than present and empty. Every field is therefore
// read defensively, and a Java `Set` arrives as a JSON array.

import type { ExerciseDetail, ParticipationSummary } from '@shared/types';

import { expectArray, expectObject } from './responseValidation';

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

function toParticipation(raw: unknown): ParticipationSummary {
    const p = raw as Record<string, unknown>;
    return {
        id: asNumber(p.id),
        type: asString(p.type),
        // The only place a repository URI survives in this projection. The exercise level has
        // none, so workspace matching depends entirely on these.
        repositoryUri: asString(p.repositoryUri),
        initializationState: asString(p.initializationState),
        initializationDate: asString(p.initializationDate),
        testRun: typeof p.testRun === 'boolean' ? p.testRun : undefined,
    };
}

/**
 * Only the fields something on the course-list or course-detail path reads.
 *
 * The projection carries more (difficulty, categories, teamMode, assessmentDueDate, quiz state,
 * the participations' submissions), and none of it has a reader here: everything to do with
 * submissions and results is read from the `exercises/{id}/details` payload instead.
 * `includedInOverallScore` is left out on purpose rather than mapped onto this type's
 * `includedInScore`, which is a boolean its one reader tests with `!== false`. Any enum string
 * would pass that test and silently label every exercise as graded.
 */
function toExercise(raw: unknown): ExerciseDetail {
    const e = expectObject('exercises-for-overview exercise', raw);
    const participations = Array.isArray(e.studentParticipations)
        ? e.studentParticipations.map(toParticipation)
        : undefined;
    return {
        id: asNumber(e.id),
        title: asString(e.title),
        type: asString(e.type),
        maxPoints: asNumber(e.maxPoints),
        releaseDate: asString(e.releaseDate),
        startDate: asString(e.startDate),
        dueDate: asString(e.dueDate),
        studentParticipations: participations,
    };
}

/**
 * The exercises of one course, mapped onto the shape the rest of the extension already renders.
 *
 * @param data the raw `exercises-for-overview` response body
 */
export function parseCourseExercisesForOverview(data: unknown): ExerciseDetail[] {
    const body = expectObject('CourseExercisesForOverview', data);
    if (!('exercises' in body)) {
        // NON_EMPTY serialization: a course whose exercises the student cannot see sends no
        // `exercises` key at all, which is an empty course rather than a malformed response.
        // Only an ABSENT key means that. Anything else in that slot is a malformed response, and
        // reading it as an empty course would blank the exercise list on a reload and make an
        // archive scan report a reachable course with nothing in it.
        return [];
    }
    return expectArray('CourseExercisesForOverview exercises', body.exercises, toExercise);
}
