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
    readonly repositoryUri?: string;
    readonly buildPlanId?: string;
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
        repositoryUri: typeof d.repositoryUri === 'string' ? d.repositoryUri : undefined,
        buildPlanId: typeof d.buildPlanId === 'string' ? d.buildPlanId : undefined,
    };
}
