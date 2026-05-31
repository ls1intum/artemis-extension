import { describe, it, expect } from 'vitest';
import { orderTypesActiveFirst } from '../src/utils/timelineLayout';

describe('orderTypesActiveFirst', () => {
    it('keeps the curated order but moves empty entries to the end', () => {
        const hasEvents = (t: string) => t === 'b' || t === 'd';
        expect(orderTypesActiveFirst(['a', 'b', 'c', 'd', 'e'], hasEvents)).toEqual(['b', 'd', 'a', 'c', 'e']);
    });

    it('returns every entry in original order when all are active', () => {
        expect(orderTypesActiveFirst(['x', 'y', 'z'], () => true)).toEqual(['x', 'y', 'z']);
    });

    it('returns every entry in original order when none are active', () => {
        expect(orderTypesActiveFirst(['x', 'y', 'z'], () => false)).toEqual(['x', 'y', 'z']);
    });
});
