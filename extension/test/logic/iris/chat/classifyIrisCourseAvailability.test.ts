import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@extension/domain/errors';
import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/irisAvailabilityService';

function api(over: Partial<{ profileActive: boolean; settings: unknown; settingsThrows: unknown; profileThrows: unknown; user: unknown; userThrows: unknown }>) {
    return {
        getCurrentUser: vi.fn(async () => {
            if (over.userThrows) { throw over.userThrows; }
            return over.user ?? { login: 'student', selectedLLMUsage: 'CLOUD_AI' };
        }),
        getProfileInfo: vi.fn(async () => {
            if (over.profileThrows) { throw over.profileThrows; }
            return {} as never;
        }),
        isIrisProfileActive: vi.fn(() => over.profileActive ?? true),
        getIrisCourseChatSettings: vi.fn(async () => {
            if (over.settingsThrows) { throw over.settingsThrows; }
            return over.settings as never;
        }),
    };
}

describe('classifyIrisCourseAvailability (§14, shared by chat + card)', () => {
    it('profile inactive → disabled', async () => {
        const r = await classifyIrisCourseAvailability(api({ profileActive: false }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('profile probe throws → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ profileThrows: new Error('net') }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability.kind).toBe('unavailable');
    });

    it('course resolution undefined → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: { enabled: true } } }) as never, undefined, { type: 'exercise', id: 7, title: 'Ex' });
        expect(r.availability.kind).toBe('unavailable');
    });

    it('enabled=false → disabled', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: { enabled: false } } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('enabled=true → enabled, and returns the settings body (incl. proactiveStruggleEnabled)', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'enabled' });
        expect(r.settings?.settings?.proactiveStruggleEnabled).toBe(false);
    });

    it('malformed settings → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: {} } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability.kind).toBe('unavailable');
    });

    it.each(['CLOUD_AI', 'LOCAL_AI'])('%s opts the account in → enabled', async (selectedLLMUsage) => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true } }, user: { login: 'student', selectedLLMUsage } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'enabled' });
    });

    it('no AI choice on the account → ai-not-allowed (none)', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true } }, user: { login: 'student' } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'ai-not-allowed', block: 'none' });
    });

    it('NO_AI on the account → ai-not-allowed (no-ai)', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true } }, user: { login: 'student', selectedLLMUsage: 'NO_AI' } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'ai-not-allowed', block: 'no-ai' });
    });

    it('account cannot be read → unavailable, not a guess about the AI choice', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true } }, userThrows: new Error('net') }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability.kind).toBe('unavailable');
    });

    it('a course with Iris off stays disabled whatever the AI choice', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: false } }, user: { login: 'student' } }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('settings call 403 → disabled (course-forbidden = Iris off for this user)', async () => {
        const r = await classifyIrisCourseAvailability(api({ settingsThrows: new ApiError('Forbidden', 403) }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'disabled' });
    });
});
