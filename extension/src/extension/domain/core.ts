export interface ArtemisFeedback {
    readonly id?: number;
    readonly text?: string;
    readonly detailText?: string;
    readonly reference?: string;
    readonly credits?: number;
    readonly type?: 'AUTOMATIC' | 'MANUAL';
    readonly positive?: boolean;
    readonly testCase?: { id?: number; testName?: string };
}

export function parseArtemisFeedback(data: unknown): ArtemisFeedback {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ArtemisFeedback data');
    }
    const d = data as Record<string, unknown>;
    const rawTestCase = d.testCase as Record<string, unknown> | undefined;
    return {
        id: typeof d.id === 'number' ? d.id : undefined,
        text: typeof d.text === 'string' ? d.text : undefined,
        detailText: typeof d.detailText === 'string' ? d.detailText : undefined,
        reference: typeof d.reference === 'string' ? d.reference : undefined,
        credits: typeof d.credits === 'number' ? d.credits : undefined,
        type: typeof d.type === 'string' ? d.type as 'AUTOMATIC' | 'MANUAL' : undefined,
        positive: typeof d.positive === 'boolean' ? d.positive : undefined,
        testCase: rawTestCase && typeof rawTestCase === 'object' ? {
            id: typeof rawTestCase.id === 'number' ? rawTestCase.id : undefined,
            testName: typeof rawTestCase.testName === 'string' ? rawTestCase.testName : undefined,
        } : undefined,
    };
}

export interface ArtemisUser {
    readonly login: string;
    readonly id?: number;
    readonly firstName?: string;
    readonly lastName?: string;
    readonly email?: string;
    readonly activated?: boolean;
    readonly langKey?: string;
    readonly authorities?: string[];
}

export function parseArtemisUser(data: unknown): ArtemisUser {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ArtemisUser data');
    }
    const d = data as Record<string, unknown>;
    return {
        login: String(d.login),
        id: typeof d.id === 'number' ? d.id : undefined,
        firstName: typeof d.firstName === 'string' ? d.firstName : undefined,
        lastName: typeof d.lastName === 'string' ? d.lastName : undefined,
        email: typeof d.email === 'string' ? d.email : undefined,
        activated: typeof d.activated === 'boolean' ? d.activated : undefined,
        langKey: typeof d.langKey === 'string' ? d.langKey : undefined,
        authorities: Array.isArray(d.authorities) ? d.authorities.map(String) : undefined,
    };
}

interface ArtemisCourse {
    readonly id: number;
    readonly title: string;
    readonly shortName: string;
    readonly description?: string;
    readonly startDate?: string;
    readonly endDate?: string;
    readonly semester?: string;
    readonly studentGroupName?: string;
    readonly teachingAssistantGroupName?: string;
    readonly editorGroupName?: string;
    readonly instructorGroupName?: string;
}

function parseArtemisCourse(data: unknown): ArtemisCourse {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ArtemisCourse data');
    }
    const d = data as Record<string, unknown>;
    return {
        id: Number(d.id),
        title: String(d.title),
        shortName: String(d.shortName),
        description: typeof d.description === 'string' ? d.description : undefined,
        startDate: typeof d.startDate === 'string' ? d.startDate : undefined,
        endDate: typeof d.endDate === 'string' ? d.endDate : undefined,
        semester: typeof d.semester === 'string' ? d.semester : undefined,
        studentGroupName: typeof d.studentGroupName === 'string' ? d.studentGroupName : undefined,
        teachingAssistantGroupName: typeof d.teachingAssistantGroupName === 'string' ? d.teachingAssistantGroupName : undefined,
        editorGroupName: typeof d.editorGroupName === 'string' ? d.editorGroupName : undefined,
        instructorGroupName: typeof d.instructorGroupName === 'string' ? d.instructorGroupName : undefined,
    };
}

export interface ArtemisExercise {
    readonly id: number;
    readonly title: string;
    readonly shortName: string;
    readonly type: 'programming' | 'modeling' | 'quiz' | 'text' | 'file-upload';
    readonly releaseDate?: string;
    readonly dueDate?: string;
    readonly assessmentDueDate?: string;
    readonly maxPoints?: number;
    readonly bonusPoints?: number;
    readonly course?: ArtemisCourse;
}

function parseArtemisExercise(data: unknown): ArtemisExercise {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ArtemisExercise data');
    }
    const d = data as Record<string, unknown>;
    return {
        id: Number(d.id),
        title: String(d.title),
        shortName: String(d.shortName),
        type: String(d.type) as ArtemisExercise['type'],
        releaseDate: typeof d.releaseDate === 'string' ? d.releaseDate : undefined,
        dueDate: typeof d.dueDate === 'string' ? d.dueDate : undefined,
        assessmentDueDate: typeof d.assessmentDueDate === 'string' ? d.assessmentDueDate : undefined,
        maxPoints: typeof d.maxPoints === 'number' ? d.maxPoints : undefined,
        bonusPoints: typeof d.bonusPoints === 'number' ? d.bonusPoints : undefined,
        course: d.course && typeof d.course === 'object' ? parseArtemisCourse(d.course) : undefined,
    };
}

export interface ArtemisResult {
    readonly id: number;
    readonly completionDate?: string;
    readonly successful?: boolean;
    readonly score?: number;
    readonly rated?: boolean;
    readonly feedbacks?: ArtemisFeedback[];
    readonly participation?: ArtemisParticipation;
    readonly assessor?: ArtemisUser;
}

export function parseArtemisResult(data: unknown): ArtemisResult {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ArtemisResult data');
    }
    const d = data as Record<string, unknown>;
    return {
        id: Number(d.id),
        completionDate: typeof d.completionDate === 'string' ? d.completionDate : undefined,
        successful: typeof d.successful === 'boolean' ? d.successful : undefined,
        score: typeof d.score === 'number' ? d.score : undefined,
        rated: typeof d.rated === 'boolean' ? d.rated : undefined,
        feedbacks: Array.isArray(d.feedbacks) ? d.feedbacks.map(f => parseArtemisFeedback(f)) : undefined,
        participation: d.participation && typeof d.participation === 'object' ? parseArtemisParticipation(d.participation) : undefined,
        assessor: d.assessor && typeof d.assessor === 'object' ? parseArtemisUser(d.assessor) : undefined,
    };
}

export interface ArtemisParticipation {
    readonly id: number;
    readonly type: 'student' | 'template' | 'solution';
    readonly student?: ArtemisUser;
    readonly team?: Record<string, unknown>;
    readonly exercise?: ArtemisExercise;
    readonly repositoryUri?: string;
    readonly buildPlanId?: string;
    readonly results?: ArtemisResult[];
}

export function parseArtemisParticipation(data: unknown): ArtemisParticipation {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid ArtemisParticipation data');
    }
    const d = data as Record<string, unknown>;
    return {
        id: Number(d.id),
        type: String(d.type) as ArtemisParticipation['type'],
        student: d.student && typeof d.student === 'object' ? parseArtemisUser(d.student) : undefined,
        team: d.team && typeof d.team === 'object' ? d.team as Record<string, unknown> : undefined,
        exercise: d.exercise && typeof d.exercise === 'object' ? parseArtemisExercise(d.exercise) : undefined,
        repositoryUri: typeof d.repositoryUri === 'string' ? d.repositoryUri : undefined,
        buildPlanId: typeof d.buildPlanId === 'string' ? d.buildPlanId : undefined,
        results: Array.isArray(d.results) ? d.results.map(r => parseArtemisResult(r)) : undefined,
    };
}
