import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@extension/domain/errors';
import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/irisAvailabilityService';

function api(over: Partial<{ profileActive: boolean; settings: unknown; settingsThrows: unknown; profileThrows: unknown }>) {
    return {
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

    it('settings call 403 → disabled (course-forbidden = Iris off for this user)', async () => {
        const r = await classifyIrisCourseAvailability(api({ settingsThrows: new ApiError('Forbidden', 403) }) as never, undefined, { type: 'course', id: 7, title: 'C' });
        expect(r.availability).toEqual({ kind: 'disabled' });
    });
});
