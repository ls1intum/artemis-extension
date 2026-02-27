import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavigationStore } from '../../../src/views/webview/react/stores/useNavigationStore';

/**
 * Navigation flow integration tests.
 *
 * Tests the useNavigationStore breadcrumb routing: push breadcrumbs across
 * multiple views, navigate back with popToBreadcrumb, and verify history
 * preservation and parameter carrythrough.
 */
describe('Navigation Flow', () => {
	beforeEach(() => {
		useNavigationStore.setState({ breadcrumbs: [] });
	});

	describe('Multi-view navigation with history', () => {
		it('builds breadcrumb history as views are pushed', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('Advanced Algorithms', 'course-detail', () => {});
				result.current.pushBreadcrumb('Binary Search', 'exercise-detail', () => {});
			});

			// Verify full history stack
			expect(result.current.breadcrumbs).toHaveLength(4);
			expect(result.current.breadcrumbs[0].view).toBe('dashboard');
			expect(result.current.breadcrumbs[1].view).toBe('course-list');
			expect(result.current.breadcrumbs[2].view).toBe('course-detail');
			expect(result.current.breadcrumbs[3].view).toBe('exercise-detail');
		});

		it('navigates back by popping to a previous breadcrumb index', () => {
			const navigateFn = { called: false };
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {
					navigateFn.called = true;
				});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('My Course', 'course-detail', () => {});
				result.current.pushBreadcrumb('My Exercise', 'exercise-detail', () => {});
			});

			expect(result.current.breadcrumbs).toHaveLength(4);

			// Navigate back to Dashboard (index 0)
			act(() => {
				result.current.popToBreadcrumb(0);
			});

			// History should be sliced to Dashboard only
			expect(result.current.breadcrumbs).toHaveLength(1);
			expect(result.current.breadcrumbs[0].view).toBe('dashboard');
			// Navigate function should have been called
			expect(navigateFn.called).toBe(true);
		});

		it('navigates back one step at a time', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('My Course', 'course-detail', () => {});
			});

			// Go back to CourseList (index 1)
			act(() => {
				result.current.popToBreadcrumb(1);
			});

			expect(result.current.breadcrumbs).toHaveLength(2);
			expect(result.current.breadcrumbs[1].view).toBe('course-list');
		});

		it('preserves breadcrumb labels including abbreviated titles', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				// Long label should be abbreviated
				result.current.pushBreadcrumb('A Very Long Course Title That Exceeds Limit', 'course-detail', () => {});
			});

			expect(result.current.breadcrumbs[0].label).toBe('Dashboard');
			// Labels over 20 chars are truncated to first 17 chars + '...'
			// "A Very Long Course Title That Exceeds Limit" -> first 17 = "A Very Long Cours" + "..."
			expect(result.current.breadcrumbs[1].label).toBe('A Very Long Cours...');
			expect(result.current.breadcrumbs[1].label.length).toBeLessThanOrEqual(20);
		});
	});

	describe('Deep navigation chain', () => {
		it('handles navigating through 5+ views correctly', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('My Course', 'course-detail', () => {});
				result.current.pushBreadcrumb('My Exercise', 'exercise-detail', () => {});
				result.current.pushBreadcrumb('Results', 'results', () => {});
				result.current.pushBreadcrumb('Details', 'result-detail', () => {});
			});

			expect(result.current.breadcrumbs).toHaveLength(6);
		});

		it('goes back 3 steps from deep navigation', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('My Course', 'course-detail', () => {});
				result.current.pushBreadcrumb('My Exercise', 'exercise-detail', () => {});
				result.current.pushBreadcrumb('Results', 'results', () => {});
			});

			// Go back 3 steps — pop to index 1 (course-list)
			act(() => {
				result.current.popToBreadcrumb(1);
			});

			expect(result.current.breadcrumbs).toHaveLength(2);
			expect(result.current.breadcrumbs[1].view).toBe('course-list');
		});

		it('navigating to a new view after going back replaces forward history', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('Old Course', 'course-detail', () => {});
			});

			// Go back to course-list
			act(() => {
				result.current.popToBreadcrumb(1);
			});
			expect(result.current.breadcrumbs).toHaveLength(2);

			// Navigate to a NEW view (replaces/extends history from current position)
			act(() => {
				result.current.pushBreadcrumb('New Course', 'course-detail', () => {});
			});

			// Should have 3 entries again (Dashboard, Courses, New Course)
			expect(result.current.breadcrumbs).toHaveLength(3);
			expect(result.current.breadcrumbs[2].label).toBe('New Course');
		});
	});

	describe('View parameter preservation', () => {
		it('preserves navigation functions for each breadcrumb', () => {
			const navigateLog: string[] = [];
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {
					navigateLog.push('dashboard');
				});
				result.current.pushBreadcrumb('My Course', 'course-detail', () => {
					navigateLog.push('course-detail');
				});
				result.current.pushBreadcrumb('My Exercise', 'exercise-detail', () => {
					navigateLog.push('exercise-detail');
				});
			});

			// Pop back to course-detail — its navigate fn should fire
			act(() => {
				result.current.popToBreadcrumb(1);
			});

			expect(navigateLog).toContain('course-detail');
		});

		it('clearBreadcrumbs resets navigation state', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
				result.current.pushBreadcrumb('My Course', 'course-detail', () => {});
			});

			expect(result.current.breadcrumbs).toHaveLength(3);

			act(() => {
				result.current.clearBreadcrumbs();
			});

			expect(result.current.breadcrumbs).toHaveLength(0);
		});

		it('popToBreadcrumb with invalid index does nothing', () => {
			const { result } = renderHook(() => useNavigationStore());

			act(() => {
				result.current.pushBreadcrumb('Dashboard', 'dashboard', () => {});
				result.current.pushBreadcrumb('Courses', 'course-list', () => {});
			});

			// Pop to non-existent index
			act(() => {
				result.current.popToBreadcrumb(99);
			});

			// State should be unchanged
			expect(result.current.breadcrumbs).toHaveLength(2);
		});
	});
});
