import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { CourseDashboardEntry, CourseDashboardResponse, ExerciseDetail } from '@extension/types';

import type { ExerciseRegistryEntry } from './exerciseRegistry';
import { LogCategory, logger } from './loggingService';
import { getEntryExercises } from './workspace';

/** A course the picker may offer. Never assembled out of fragments. */
export interface CatalogCourse {
    id: number;
    title: string;
    shortName?: string;
}

export interface CatalogExercise {
    id: number;
    courseId: number;
    title: string;
    shortName?: string;
    releaseDate?: string;
    dueDate?: string;
    repositoryUri?: string;
    participationId?: number;
    /** The picker's existing participation filter, decided once, here. */
    pickable: boolean;
}

export interface CatalogProjection {
    courses: CatalogCourse[];
    exercises: CatalogExercise[];
}

/**
 * Something the dashboard does not carry: an archived course found by
 * workspace detection, a course opened from the sidebar, an exercise opened
 * on its own. A partial record says what it is good for, so nothing has to
 * guess: a partial course names a course id and is never offered as one, and
 * a partial exercise is rendered only once it has a title.
 */
export type SupplementalRecord =
    | { kind: 'course'; entry: CourseDashboardEntry }
    | { kind: 'partial-course'; id: number; title?: string }
    | {
        kind: 'partial-exercise';
        id: number;
        courseId: number;
        title?: string;
        shortName?: string;
        releaseDate?: string;
        dueDate?: string;
        repositoryUri?: string;
        participationId?: number;
    };

/** The registry indexes repositories, so an exercise without one is not one. */
export function toRegistryEntries(projection: CatalogProjection): ExerciseRegistryEntry[] {
    return projection.exercises
        .filter((e): e is CatalogExercise & { repositoryUri: string } => typeof e.repositoryUri === 'string')
        .map(e => ({
            id: e.id, title: e.title, shortName: e.shortName,
            courseId: e.courseId, repositoryUri: e.repositoryUri, participationId: e.participationId,
        }));
}

function courseIdOf(entry: CourseDashboardEntry): number | undefined {
    const nested = entry.course?.id;
    if (typeof nested === 'number') { return nested; }
    const flat = (entry as { id?: unknown }).id;
    return typeof flat === 'number' ? flat : undefined;
}

/** `next` wins field by field, but only where it actually says something. */
function mergeDefined<T extends object>(previous: T, next: T): T {
    const merged = { ...previous };
    for (const [key, value] of Object.entries(next)) {
        if (value !== undefined) { (merged as Record<string, unknown>)[key] = value; }
    }
    return merged;
}

function toCatalogExercise(raw: ExerciseDetail, courseId: number): CatalogExercise | null {
    if (typeof raw.id !== 'number' || typeof raw.title !== 'string') { return null; }
    const participation = raw.studentParticipations?.[0];
    return {
        id: raw.id,
        courseId,
        title: raw.title,
        shortName: raw.shortName,
        releaseDate: raw.releaseDate ?? raw.startDate,
        dueDate: raw.dueDate,
        repositoryUri: participation?.repositoryUri ?? raw.repositoryUri,
        participationId: typeof participation?.id === 'number' ? participation.id : undefined,
        pickable: (raw.studentParticipations?.length ?? 0) > 0,
    };
}

/**
 * The chat's and the sidebar's view of what exists on the server right now.
 *
 * Two layers, because one is not enough: workspace detection can find the
 * student's exercise in an ARCHIVED course, which no dashboard response will
 * ever contain, and a single layer replaced wholesale by each fetch would
 * drop it with no way to recover it (the registry still matches the folder,
 * so the archive probe never runs again).
 */
export class CourseCatalog implements vscode.Disposable {
    private _dashboard: CourseDashboardEntry[] | undefined;
    /**
     * The rest of the last dashboard response. `CourseDashboardResponse` has
     * an index signature, and the cache this replaces returned the response
     * whole; rebuilding only `{ courses }` would quietly drop any other
     * top-level field a consumer might one day read.
     */
    private _dashboardExtras: Omit<CourseDashboardResponse, 'courses'> | undefined;
    private readonly _supplemental = new Map<string, SupplementalRecord>();
    /**
     * One monotonic sequence over EVERY dashboard request, plain and forced
     * alike. The latest REQUEST wins, not the latest success: once B has
     * started, A may not install even if B fails, or a plain init fetch lands
     * after a failed forced one and reinstates a snapshot the student already
     * asked to replace.
     */
    private _requestSeq = 0;
    private _inflight: Promise<CourseDashboardResponse | undefined> | undefined;
    private _epoch = 0;

    private readonly _onCoursesLoaded = new vscode.EventEmitter<CourseDashboardResponse>();
    public readonly onCoursesLoaded = this._onCoursesLoaded.event;

    constructor(private readonly _api: ArtemisApiService) {}

    public get currentEpoch(): number { return this._epoch; }

    /** The sidebar's shape. Course-granular: a dashboard entry wins wholesale. */
    public get(): CourseDashboardResponse | undefined {
        if (this._dashboard === undefined && this._supplemental.size === 0) { return undefined; }
        const dashboard = this._dashboard ?? [];
        const known = new Set(dashboard.map(courseIdOf).filter((id): id is number => id !== undefined));
        const extras: CourseDashboardEntry[] = [];
        for (const record of this._supplemental.values()) {
            if (record.kind !== 'course') { continue; }
            const id = courseIdOf(record.entry);
            if (id === undefined || known.has(id)) { continue; }
            extras.push(record.entry);
        }
        return { ...this._dashboardExtras, courses: [...dashboard, ...extras] };
    }

    public async fetch(options?: { force?: boolean }): Promise<CourseDashboardResponse | undefined> {
        if (this._dashboard && !options?.force) { return this.get(); }
        if (this._inflight && !options?.force) { return this._inflight; }
        const token = ++this._requestSeq;
        const epoch = this._epoch;
        const run = this._doFetch(token, epoch);
        this._inflight = run;
        try {
            return await run;
        } finally {
            // Only if it is still OURS. The old unscoped cleanup let a newer
            // request's handle be erased by an older one settling.
            if (this._inflight === run) { this._inflight = undefined; }
        }
    }

    private async _doFetch(token: number, epoch: number): Promise<CourseDashboardResponse | undefined> {
        let data: CourseDashboardResponse;
        try {
            data = await this._api.getCoursesForDashboard();
        } catch (error) {
            logger.error('CourseCatalog: failed to fetch courses', LogCategory.GENERAL, error);
            return undefined;
        }
        if (token !== this._requestSeq || epoch !== this._epoch) {
            logger.info('CourseCatalog: discarding a superseded dashboard response', LogCategory.GENERAL);
            return this.get();
        }
        const { courses, ...extras } = data;
        this._dashboard = courses ?? [];
        this._dashboardExtras = extras;
        logger.info(`CourseCatalog: loaded ${this._dashboard.length} courses`, LogCategory.GENERAL);
        const merged = this.get();
        if (merged) { this._onCoursesLoaded.fire(merged); }
        return merged;
    }

    /** Compatibility entry point for the sidebar's archived-course injection. */
    public injectEntry(entry: CourseDashboardEntry): void {
        const id = courseIdOf(entry);
        if (id === undefined) { return; }
        // The same no-op the cache this replaces performed: a course already
        // recorded is not injected again, and above all does not refire the event
        // that drives the registry rebuild and workspace detection.
        if (this._dashboard?.some(e => courseIdOf(e) === id)) { return; }
        if (this._supplemental.get(`c:${id}`)?.kind === 'course') { return; }
        this.upsertSupplemental({ kind: 'course', entry }, this._epoch);
    }

    public upsertSupplemental(record: SupplementalRecord, epoch: number): void {
        if (epoch !== this._epoch) {
            logger.info('CourseCatalog: rejecting a supplemental write from another session', LogCategory.GENERAL);
            return;
        }
        const key = record.kind === 'partial-exercise'
            ? `e:${record.id}`
            : `c:${record.kind === 'course' ? courseIdOf(record.entry) : record.id}`;
        if (key.endsWith('undefined')) { return; }
        // Information is monotonic within a session: a `partial-course` names
        // a course id and nothing else, so letting one land on the key of a
        // FULL course would erase that course's exercises, including the
        // archived workspace course this layer exists to protect. Courses and
        // partial courses deliberately share a key so the two never both
        // describe the same id; the rule is that the poorer record loses.
        const existing = this._supplemental.get(key);
        if (record.kind === 'partial-course' && existing?.kind === 'course') { return; }
        // Same rule between two partial exercises. A write that knows only the
        // id, the course and the title (a history row's name) must not delete
        // a repository URI and a participation id a richer write already
        // recorded: that would drop the exercise out of the registry and take
        // the participation reverse lookup with it.
        if (record.kind === 'partial-exercise' && existing?.kind === 'partial-exercise') {
            this._supplemental.set(key, mergeDefined(existing, record));
        } else {
            this._supplemental.set(key, record);
        }
        const merged = this.get();
        if (merged) { this._onCoursesLoaded.fire(merged); }
    }

    /**
     * What the picker and the registry read. Entity granularity: dashboard
     * data wins for every entity it actually contains, and a supplemental
     * entity the dashboard does not contain survives. Dropping a whole
     * supplemental course because its id appeared in the dashboard would
     * erase an individually opened exercise the dashboard's slim entry does
     * not list.
     */
    public projection(): CatalogProjection {
        const courses = new Map<number, CatalogCourse>();
        const exercises = new Map<number, CatalogExercise>();

        // Three passes, poorest source first, so precedence is a property of
        // the CODE rather than of map insertion order: dashboard beats a full
        // supplemental course, which beats a partial exercise. Written as one
        // pass over the map, a history row's bare name could land after an
        // archived course's full exercise and delete its repository URI.
        for (const record of this._supplemental.values()) {
            if (record.kind === 'partial-exercise') {
                // Renderable only with the three fields a picker row needs.
                if (record.title === undefined) { continue; }
                exercises.set(record.id, {
                    id: record.id,
                    courseId: record.courseId,
                    title: record.title,
                    shortName: record.shortName,
                    releaseDate: record.releaseDate,
                    dueDate: record.dueDate,
                    repositoryUri: record.repositoryUri,
                    participationId: record.participationId,
                    // The student opened it on purpose; it is offerable.
                    pickable: true,
                });
            }
            // `partial-course` deliberately contributes nothing here. It gives
            // a course id a display name and is never a pickable course.
        }
        for (const record of this._supplemental.values()) {
            if (record.kind === 'course') { this._absorb(record.entry, courses, exercises); }
        }
        for (const entry of this._dashboard ?? []) {
            this._absorb(entry, courses, exercises);
        }

        return { courses: [...courses.values()], exercises: [...exercises.values()] };
    }

    private _absorb(
        entry: CourseDashboardEntry,
        courses: Map<number, CatalogCourse>,
        exercises: Map<number, CatalogExercise>,
    ): void {
        const id = courseIdOf(entry);
        if (id === undefined) { return; }
        const title = entry.course?.title;
        if (typeof title === 'string') {
            courses.set(id, { id, title, shortName: entry.course?.shortName });
        }
        for (const raw of getEntryExercises(entry)) {
            const projected = toCatalogExercise(raw, id);
            if (projected) { exercises.set(projected.id, projected); }
        }
    }

    /** Full course first, then a partial record. Never invented. */
    public courseTitle(courseId: number): string | undefined {
        const full = this.projection().courses.find(c => c.id === courseId);
        if (full) { return full.title; }
        const partial = this._supplemental.get(`c:${courseId}`);
        return partial?.kind === 'partial-course' ? partial.title : undefined;
    }

    public exerciseTitle(exerciseId: number): string | undefined {
        return this.projection().exercises.find(e => e.id === exerciseId)?.title;
    }

    /**
     * The course an exercise belongs to, ACCORDING TO THE SERVER'S OWN dashboard
     * or a full course entry. Deliberately blind to partial records: a partial is
     * display data, and an exercise-to-course mapping is navigation data.
     */
    public authoritativeCourseIdFor(exerciseId: number): number | undefined {
        for (const entry of this._dashboard ?? []) {
            const hit = this._courseIdIfEntryHasExercise(entry, exerciseId);
            if (hit !== undefined) { return hit; }
        }
        for (const record of this._supplemental.values()) {
            if (record.kind !== 'course') { continue; }
            const hit = this._courseIdIfEntryHasExercise(record.entry, exerciseId);
            if (hit !== undefined) { return hit; }
        }
        return undefined;
    }

    private _courseIdIfEntryHasExercise(entry: CourseDashboardEntry, exerciseId: number): number | undefined {
        const id = courseIdOf(entry);
        if (id === undefined) { return undefined; }
        return getEntryExercises(entry).some(e => e.id === exerciseId) ? id : undefined;
    }

    /** Compatibility with the cache this replaces: `clear()` keeps the epoch. */
    public clear(): void {
        this.resetTo(this._epoch);
    }

    /** Everything this session knew, gone, and every in-flight result orphaned. */
    public resetTo(epoch: number): void {
        this._dashboard = undefined;
        this._dashboardExtras = undefined;
        this._supplemental.clear();
        this._inflight = undefined;
        this._epoch = epoch;
    }

    public dispose(): void {
        this._onCoursesLoaded.dispose();
    }
}
