export interface RaterSession {
    v: 1;
    role: 'rater';
    raterId: string;
    raterName: string;
    iat: number;
    exp: number;
}

export interface ResearcherSession {
    v: 1;
    role: 'researcher';
    iat: number;
    exp: number;
}

export type ViewerSession = RaterSession | ResearcherSession;
