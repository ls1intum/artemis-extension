import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@extension/domain/errors';
import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/chatSessionService';

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
const courseId = async () => 7;

describe('classifyIrisCourseAvailability (§14, shared by chat + card)', () => {
    it('profile inactive → disabled', async () => {
        const r = await classifyIrisCourseAvailability(api({ profileActive: false }), courseId);
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('profile probe throws → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ profileThrows: new Error('net') }), courseId);
        expect(r.availability.kind).toBe('unavailable');
    });

    it('course resolution undefined → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: { enabled: true } } }), async () => undefined);
        expect(r.availability.kind).toBe('unavailable');
    });

    it('enabled=false → disabled', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: { enabled: false } } }), courseId);
        expect(r.availability).toEqual({ kind: 'disabled' });
    });

    it('enabled=true → enabled, and returns the settings body (incl. proactiveStruggleEnabled)', async () => {
        const r = await classifyIrisCourseAvailability(
            api({ settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } }), courseId);
        expect(r.availability).toEqual({ kind: 'enabled' });
        expect(r.settings?.settings?.proactiveStruggleEnabled).toBe(false);
    });

    it('malformed settings → unavailable', async () => {
        const r = await classifyIrisCourseAvailability(api({ settings: { settings: {} } }), courseId);
        expect(r.availability.kind).toBe('unavailable');
    });

    it('settings call 403 → disabled (course-forbidden = Iris off for this user)', async () => {
        const r = await classifyIrisCourseAvailability(api({ settingsThrows: new ApiError('Forbidden', 403) }), courseId);
        expect(r.availability).toEqual({ kind: 'disabled' });
    });
});
