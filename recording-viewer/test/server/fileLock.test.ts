import { describe, it, expect } from 'vitest';
import { withFileLock, _fileLocksForTest } from '../../server/fileLock';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe('withFileLock', () => {
    it('serializes concurrent callers on the same path', async () => {
        const order: string[] = [];
        const aPromise = withFileLock('/tmp/x', async () => {
            order.push('A-start');
            await sleep(20);
            order.push('A-end');
            return 'A';
        });
        const bPromise = withFileLock('/tmp/x', async () => {
            order.push('B-start');
            await sleep(5);
            order.push('B-end');
            return 'B';
        });
        const [a, b] = await Promise.all([aPromise, bPromise]);
        expect(a).toBe('A');
        expect(b).toBe('B');
        expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
    });

    it('does NOT serialize callers on different paths', async () => {
        const order: string[] = [];
        const xP = withFileLock('/tmp/x', async () => { order.push('x-start'); await sleep(20); order.push('x-end'); });
        const yP = withFileLock('/tmp/y', async () => { order.push('y-start'); await sleep(5); order.push('y-end'); });
        await Promise.all([xP, yP]);
        expect(order.indexOf('y-start')).toBeLessThan(order.indexOf('x-end'));
    });

    it('propagates errors from fn to the caller', async () => {
        await expect(
            withFileLock('/tmp/x', async () => { throw new Error('boom'); }),
        ).rejects.toThrow('boom');
    });

    it('continues the queue even if a previous fn threw', async () => {
        const errP = withFileLock('/tmp/x', async () => { throw new Error('first'); });
        const okP = withFileLock('/tmp/x', async () => 'second');
        await expect(errP).rejects.toThrow('first');
        await expect(okP).resolves.toBe('second');
    });

    it('GCs the map entry when nothing is queued behind the last caller', async () => {
        await withFileLock('/tmp/gc', async () => 'done');
        await Promise.resolve();
        await Promise.resolve();
        expect(_fileLocksForTest.size).toBe(0);
    });
});
