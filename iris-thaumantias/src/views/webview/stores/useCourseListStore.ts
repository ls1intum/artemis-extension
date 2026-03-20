import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { postCommand, type VsCodeApi, type CourseData, type ArchivedCourse } from '../../../../shared/messageContracts';

interface CourseListState {
    courses: CourseData[];
    archivedCourses: ArchivedCourse[];
    archivedLoaded: boolean;
    isLoading: boolean;
    searchTerm: string;
    typeFilter: 'all' | 'active' | 'archived';
    semesterFilter: string;
    sortBy: string;

    // Actions
    setCourses: (courses: CourseData[], archived?: ArchivedCourse[]) => void;
    setArchivedCourses: (archived: ArchivedCourse[]) => void;
    setLoading: (loading: boolean) => void;
    setSearchTerm: (term: string) => void;
    setTypeFilter: (filter: 'all' | 'active' | 'archived') => void;
    setSemesterFilter: (filter: string) => void;
    setSortBy: (sort: string) => void;
    clearFilters: () => void;
    loadCourses: (vscodeApi: VsCodeApi) => void;
    loadArchivedCourses: (vscodeApi: VsCodeApi) => void;

    // Derived
    filteredCourses: () => { active: CourseData[]; archived: ArchivedCourse[] };
}

/**
 * Parse semester format: WS24/25, SS25, etc.
 */
function parseSemester(semester: string): { type: string; year: number; sortKey: number } {
    const cleanSemester = semester.toUpperCase().trim();

    // Match patterns like WS24/25, WS2024/2025, SS25, SS2025
    const wsMatch = cleanSemester.match(/^WS(\d{2,4})(?:\/(\d{2,4}))?$/);
    const ssMatch = cleanSemester.match(/^SS(\d{2,4})$/);

    if (wsMatch) {
        // Winter semester: WS24/25 or WS24
        let year = parseInt(wsMatch[1]);
        // Convert 2-digit years to 4-digit (24 -> 2024)
        if (year < 100) {
            year += 2000;
        }
        // Winter semester starts in fall, so it's the later year
        return { type: 'WS', year: year, sortKey: year * 10 + 1 }; // +1 to make WS slightly later than SS of same year
    } else if (ssMatch) {
        // Summer semester: SS25
        let year = parseInt(ssMatch[1]);
        // Convert 2-digit years to 4-digit (25 -> 2025)
        if (year < 100) {
            year += 2000;
        }
        return { type: 'SS', year: year, sortKey: year * 10 };
    }

    // Fallback for unknown formats
    return { type: 'UNKNOWN', year: 0, sortKey: 0 };
}

/**
 * Compare semesters (higher sortKey = newer).
 */
function compareSemesters(a: string, b: string): number {
    const semesterA = parseSemester(a);
    const semesterB = parseSemester(b);

    // Compare by sortKey (higher = newer)
    return semesterA.sortKey - semesterB.sortKey;
}

export const useCourseListStore = create<CourseListState>()(
    devtools(
        (set, get) => ({
            courses: [],
            archivedCourses: [],
            archivedLoaded: false,
            isLoading: false,
            searchTerm: '',
            typeFilter: 'all',
            semesterFilter: 'all',
            sortBy: 'semester-desc',

            setCourses: (courses, archived) => {
                set({
                    courses,
                    archivedCourses: archived || [],
                    archivedLoaded: archived !== undefined,
                    isLoading: false,
                }, false, 'setCourses');
            },

            setArchivedCourses: (archived) => {
                set({
                    archivedCourses: archived,
                    archivedLoaded: true,
                    isLoading: false,
                }, false, 'setArchivedCourses');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setSearchTerm: (term) => {
                set({ searchTerm: term }, false, 'setSearchTerm');
            },

            setTypeFilter: (filter) => {
                set({ typeFilter: filter }, false, 'setTypeFilter');
            },

            setSemesterFilter: (filter) => {
                set({ semesterFilter: filter }, false, 'setSemesterFilter');
            },

            setSortBy: (sort) => {
                set({ sortBy: sort }, false, 'setSortBy');
            },

            clearFilters: () => {
                set({
                    searchTerm: '',
                    typeFilter: 'all',
                    semesterFilter: 'all',
                    sortBy: 'semester-desc',
                }, false, 'clearFilters');
            },

            loadCourses: (vscodeApi) => {
                set({ isLoading: true }, false, 'loadCourses');
                postCommand(vscodeApi, 'reloadCourses');
            },

            loadArchivedCourses: (vscodeApi) => {
                set({ isLoading: true }, false, 'loadArchivedCourses');
                postCommand(vscodeApi, 'loadArchivedCourses');
            },

            filteredCourses: () => {
                const state = get();
                const { courses, archivedCourses, searchTerm, typeFilter, semesterFilter, sortBy } = state;

                // Apply search and filters
                const lowerSearchTerm = searchTerm.toLowerCase().trim();

                const filteredActive = courses.filter((courseData) => {
                    const course = courseData.course;
                    const title = course.title?.toLowerCase() || '';
                    const semester = course.semester?.toLowerCase() || '';
                    const description = course.description?.toLowerCase() || '';

                    // Search filter
                    if (lowerSearchTerm && !title.includes(lowerSearchTerm) && !semester.includes(lowerSearchTerm) && !description.includes(lowerSearchTerm)) {
                        return false;
                    }

                    // Semester filter
                    if (semesterFilter !== 'all' && semester !== semesterFilter.toLowerCase()) {
                        return false;
                    }

                    return true;
                });

                const filteredArchived = archivedCourses.filter((course) => {
                    const title = course.title?.toLowerCase() || '';
                    const semester = course.semester?.toLowerCase() || '';

                    // Search filter
                    if (lowerSearchTerm && !title.includes(lowerSearchTerm) && !semester.includes(lowerSearchTerm)) {
                        return false;
                    }

                    // Semester filter
                    if (semesterFilter !== 'all' && semester !== semesterFilter.toLowerCase()) {
                        return false;
                    }

                    return true;
                });

                // Sort courses
                const sortedActive = [...filteredActive].sort((a, b) => {
                    const courseA = a.course;
                    const courseB = b.course;

                    const titleA = courseA.title || '';
                    const titleB = courseB.title || '';
                    const semesterA = courseA.semester || '';
                    const semesterB = courseB.semester || '';
                    const exercisesA = courseA.exercises?.length || 0;
                    const exercisesB = courseB.exercises?.length || 0;

                    switch (sortBy) {
                        case 'title-asc':
                            return titleA.localeCompare(titleB);
                        case 'title-desc':
                            return titleB.localeCompare(titleA);
                        case 'semester-desc':
                            return compareSemesters(semesterB, semesterA); // newest first
                        case 'semester-asc':
                            return compareSemesters(semesterA, semesterB); // oldest first
                        case 'exercises-desc':
                            return exercisesB - exercisesA;
                        case 'exercises-asc':
                            return exercisesA - exercisesB;
                        default:
                            return titleA.localeCompare(titleB);
                    }
                });

                const sortedArchived = [...filteredArchived].sort((a, b) => {
                    const titleA = a.title || '';
                    const titleB = b.title || '';
                    const semesterA = a.semester || '';
                    const semesterB = b.semester || '';

                    switch (sortBy) {
                        case 'title-asc':
                            return titleA.localeCompare(titleB);
                        case 'title-desc':
                            return titleB.localeCompare(titleA);
                        case 'semester-desc':
                            return compareSemesters(semesterB, semesterA); // newest first
                        case 'semester-asc':
                            return compareSemesters(semesterA, semesterB); // oldest first
                        default:
                            // For archived courses, default to semester-desc if exercises sort is selected
                            if (sortBy.startsWith('exercises-')) {
                                return compareSemesters(semesterB, semesterA);
                            }
                            return titleA.localeCompare(titleB);
                    }
                });

                return {
                    active: sortedActive,
                    archived: sortedArchived,
                };
            },
        }),
        {
            name: 'CourseListStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
