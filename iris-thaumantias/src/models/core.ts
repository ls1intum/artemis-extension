// --- Core API Models ---

export class ArtemisFeedback {
    constructor(
        public readonly id?: number,
        public readonly text?: string,
        public readonly detailText?: string,
        public readonly reference?: string,
        public readonly credits?: number,
        public readonly type?: 'AUTOMATIC' | 'MANUAL',
        public readonly positive?: boolean,
    ) {}

    static fromJSON(data: unknown): ArtemisFeedback {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisFeedback data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisFeedback(
            typeof d.id === 'number' ? d.id : undefined,
            typeof d.text === 'string' ? d.text : undefined,
            typeof d.detailText === 'string' ? d.detailText : undefined,
            typeof d.reference === 'string' ? d.reference : undefined,
            typeof d.credits === 'number' ? d.credits : undefined,
            typeof d.type === 'string' ? d.type as 'AUTOMATIC' | 'MANUAL' : undefined,
            typeof d.positive === 'boolean' ? d.positive : undefined,
        );
    }
}

export class ArtemisUser {
    constructor(
        public readonly login: string,
        public readonly id?: number,
        public readonly firstName?: string,
        public readonly lastName?: string,
        public readonly email?: string,
        public readonly activated?: boolean,
        public readonly langKey?: string,
        public readonly authorities?: string[],
    ) {}

    static fromJSON(data: unknown): ArtemisUser {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisUser data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisUser(
            String(d.login),
            typeof d.id === 'number' ? d.id : undefined,
            typeof d.firstName === 'string' ? d.firstName : undefined,
            typeof d.lastName === 'string' ? d.lastName : undefined,
            typeof d.email === 'string' ? d.email : undefined,
            typeof d.activated === 'boolean' ? d.activated : undefined,
            typeof d.langKey === 'string' ? d.langKey : undefined,
            Array.isArray(d.authorities) ? d.authorities.map(String) : undefined,
        );
    }
}

export class ArtemisCourse {
    constructor(
        public readonly id: number,
        public readonly title: string,
        public readonly shortName: string,
        public readonly description?: string,
        public readonly startDate?: string,
        public readonly endDate?: string,
        public readonly semester?: string,
        public readonly studentGroupName?: string,
        public readonly teachingAssistantGroupName?: string,
        public readonly editorGroupName?: string,
        public readonly instructorGroupName?: string,
    ) {}

    static fromJSON(data: unknown): ArtemisCourse {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisCourse data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisCourse(
            Number(d.id),
            String(d.title),
            String(d.shortName),
            typeof d.description === 'string' ? d.description : undefined,
            typeof d.startDate === 'string' ? d.startDate : undefined,
            typeof d.endDate === 'string' ? d.endDate : undefined,
            typeof d.semester === 'string' ? d.semester : undefined,
            typeof d.studentGroupName === 'string' ? d.studentGroupName : undefined,
            typeof d.teachingAssistantGroupName === 'string' ? d.teachingAssistantGroupName : undefined,
            typeof d.editorGroupName === 'string' ? d.editorGroupName : undefined,
            typeof d.instructorGroupName === 'string' ? d.instructorGroupName : undefined,
        );
    }
}

export class ArtemisExercise {
    constructor(
        public readonly id: number,
        public readonly title: string,
        public readonly shortName: string,
        public readonly type: 'programming' | 'modeling' | 'quiz' | 'text' | 'file-upload',
        public readonly releaseDate?: string,
        public readonly dueDate?: string,
        public readonly assessmentDueDate?: string,
        public readonly maxPoints?: number,
        public readonly bonusPoints?: number,
        public readonly course?: ArtemisCourse,
    ) {}

    static fromJSON(data: unknown): ArtemisExercise {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisExercise data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisExercise(
            Number(d.id),
            String(d.title),
            String(d.shortName),
            String(d.type) as ArtemisExercise['type'],
            typeof d.releaseDate === 'string' ? d.releaseDate : undefined,
            typeof d.dueDate === 'string' ? d.dueDate : undefined,
            typeof d.assessmentDueDate === 'string' ? d.assessmentDueDate : undefined,
            typeof d.maxPoints === 'number' ? d.maxPoints : undefined,
            typeof d.bonusPoints === 'number' ? d.bonusPoints : undefined,
            d.course && typeof d.course === 'object' ? ArtemisCourse.fromJSON(d.course) : undefined,
        );
    }
}

export class ArtemisResult {
    constructor(
        public readonly id: number,
        public readonly completionDate?: string,
        public readonly successful?: boolean,
        public readonly score?: number,
        public readonly rated?: boolean,
        public readonly feedbacks?: ArtemisFeedback[],
        public readonly participation?: ArtemisParticipation,
        public readonly assessor?: ArtemisUser,
    ) {}

    static fromJSON(data: unknown): ArtemisResult {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisResult data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisResult(
            Number(d.id),
            typeof d.completionDate === 'string' ? d.completionDate : undefined,
            typeof d.successful === 'boolean' ? d.successful : undefined,
            typeof d.score === 'number' ? d.score : undefined,
            typeof d.rated === 'boolean' ? d.rated : undefined,
            Array.isArray(d.feedbacks) ? d.feedbacks.map(f => ArtemisFeedback.fromJSON(f)) : undefined,
            d.participation && typeof d.participation === 'object' ? ArtemisParticipation.fromJSON(d.participation) : undefined,
            d.assessor && typeof d.assessor === 'object' ? ArtemisUser.fromJSON(d.assessor) : undefined,
        );
    }
}

export class ArtemisParticipation {
    constructor(
        public readonly id: number,
        public readonly type: 'student' | 'template' | 'solution',
        public readonly student?: ArtemisUser,
        public readonly team?: any,
        public readonly exercise?: ArtemisExercise,
        public readonly repositoryUri?: string,
        public readonly buildPlanId?: string,
        public readonly results?: ArtemisResult[],
    ) {}

    static fromJSON(data: unknown): ArtemisParticipation {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ArtemisParticipation data');
        }
        const d = data as Record<string, unknown>;
        return new ArtemisParticipation(
            Number(d.id),
            String(d.type) as ArtemisParticipation['type'],
            d.student && typeof d.student === 'object' ? ArtemisUser.fromJSON(d.student) : undefined,
            d.team ?? undefined,
            d.exercise && typeof d.exercise === 'object' ? ArtemisExercise.fromJSON(d.exercise) : undefined,
            typeof d.repositoryUri === 'string' ? d.repositoryUri : undefined,
            typeof d.buildPlanId === 'string' ? d.buildPlanId : undefined,
            Array.isArray(d.results) ? d.results.map(r => ArtemisResult.fromJSON(r)) : undefined,
        );
    }
}
