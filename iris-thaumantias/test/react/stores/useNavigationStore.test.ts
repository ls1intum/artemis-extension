import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavigationStore } from '../../../src/views/webview/react/stores/useNavigationStore';

describe('useNavigationStore', () => {
	it('initializes with empty breadcrumbs', () => {
		const { result } = renderHook(() => useNavigationStore());

		expect(result.current.breadcrumbs).toEqual([]);
	});

	it('pushBreadcrumb adds a breadcrumb entry', () => {
		const { result } = renderHook(() => useNavigationStore());
		const navigateFn = vi.fn();

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', navigateFn);
		});

		expect(result.current.breadcrumbs).toHaveLength(1);
		expect(result.current.breadcrumbs[0].label).toBe('Home');
		expect(result.current.breadcrumbs[0].view).toBe('dashboard');
		expect(result.current.breadcrumbs[0].onClick).toBe(navigateFn);
	});

	it('pushBreadcrumb accumulates multiple breadcrumbs', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', vi.fn());
			result.current.pushBreadcrumb('Courses', 'courseList', vi.fn());
			result.current.pushBreadcrumb('My Course', 'courseDetail', vi.fn());
		});

		expect(result.current.breadcrumbs).toHaveLength(3);
		expect(result.current.breadcrumbs[0].view).toBe('dashboard');
		expect(result.current.breadcrumbs[1].view).toBe('courseList');
		expect(result.current.breadcrumbs[2].view).toBe('courseDetail');
	});

	it('abbreviates labels longer than 20 characters (17 chars + ...)', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('A Very Long Course Title That Exceeds Twenty Characters', 'courseDetail', vi.fn());
		});

		// abbreviateLabel: substring(0, 17) + '...' = 20 chars total
		expect(result.current.breadcrumbs[0].label).toBe('A Very Long Cours...');
		expect(result.current.breadcrumbs[0].label).toHaveLength(20);
	});

	it('does not abbreviate labels of exactly 20 characters', () => {
		const { result } = renderHook(() => useNavigationStore());
		const exactLabel = 'Exactly Twenty Chars';

		act(() => {
			result.current.pushBreadcrumb(exactLabel, 'view', vi.fn());
		});

		expect(result.current.breadcrumbs[0].label).toBe(exactLabel);
	});

	it('does not abbreviate labels shorter than 20 characters', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('Short', 'view', vi.fn());
		});

		expect(result.current.breadcrumbs[0].label).toBe('Short');
	});

	it('popToBreadcrumb slices breadcrumbs to target index + 1', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', vi.fn());
			result.current.pushBreadcrumb('Courses', 'courseList', vi.fn());
			result.current.pushBreadcrumb('My Course', 'courseDetail', vi.fn());
			result.current.pushBreadcrumb('Exercise', 'exerciseDetail', vi.fn());
		});

		act(() => {
			result.current.popToBreadcrumb(1); // pop to index 1 = 'Courses'
		});

		expect(result.current.breadcrumbs).toHaveLength(2);
		expect(result.current.breadcrumbs[0].view).toBe('dashboard');
		expect(result.current.breadcrumbs[1].view).toBe('courseList');
	});

	it('popToBreadcrumb calls onClick on the target segment', () => {
		const { result } = renderHook(() => useNavigationStore());
		const homeNavigate = vi.fn();
		const courseNavigate = vi.fn();

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', homeNavigate);
			result.current.pushBreadcrumb('Course', 'courseDetail', courseNavigate);
		});

		act(() => {
			result.current.popToBreadcrumb(0); // pop to index 0 = 'Home'
		});

		expect(homeNavigate).toHaveBeenCalledOnce();
		expect(courseNavigate).not.toHaveBeenCalled();
	});

	it('popToBreadcrumb does nothing if index is out of bounds', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', vi.fn());
		});

		act(() => {
			result.current.popToBreadcrumb(5); // out of bounds
		});

		// Breadcrumbs remain unchanged
		expect(result.current.breadcrumbs).toHaveLength(1);
	});

	it('clearBreadcrumbs empties the breadcrumbs array', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', vi.fn());
			result.current.pushBreadcrumb('Courses', 'courseList', vi.fn());
		});

		act(() => {
			result.current.clearBreadcrumbs();
		});

		expect(result.current.breadcrumbs).toEqual([]);
	});

	it('clearBreadcrumbs on already-empty store is a no-op', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.clearBreadcrumbs();
		});

		expect(result.current.breadcrumbs).toEqual([]);
	});

	it('supports deep navigation chain A -> B -> C and popTo A', () => {
		const { result } = renderHook(() => useNavigationStore());
		const navA = vi.fn();
		const navB = vi.fn();
		const navC = vi.fn();

		act(() => {
			result.current.pushBreadcrumb('A', 'viewA', navA);
			result.current.pushBreadcrumb('B', 'viewB', navB);
			result.current.pushBreadcrumb('C', 'viewC', navC);
		});

		expect(result.current.breadcrumbs).toHaveLength(3);

		act(() => {
			result.current.popToBreadcrumb(0); // back to A
		});

		expect(result.current.breadcrumbs).toHaveLength(1);
		expect(result.current.breadcrumbs[0].view).toBe('viewA');
		expect(navA).toHaveBeenCalledOnce();
	});

	it('consecutive pops work correctly', () => {
		const { result } = renderHook(() => useNavigationStore());

		act(() => {
			result.current.pushBreadcrumb('Home', 'dashboard', vi.fn());
			result.current.pushBreadcrumb('Courses', 'courseList', vi.fn());
			result.current.pushBreadcrumb('Course', 'courseDetail', vi.fn());
		});

		act(() => {
			result.current.popToBreadcrumb(1);
		});

		expect(result.current.breadcrumbs).toHaveLength(2);

		act(() => {
			result.current.popToBreadcrumb(0);
		});

		expect(result.current.breadcrumbs).toHaveLength(1);
	});

	it('popToBreadcrumb on last item trims to single breadcrumb', () => {
		const { result } = renderHook(() => useNavigationStore());
		const last = vi.fn();

		act(() => {
			result.current.pushBreadcrumb('Only', 'only', last);
		});

		act(() => {
			result.current.popToBreadcrumb(0);
		});

		expect(result.current.breadcrumbs).toHaveLength(1);
		expect(last).toHaveBeenCalledOnce();
	});
});
