import { useEffect, useMemo } from 'react';
import { useCourseListStore } from '../../stores/useCourseListStore';
import { useNavigationStore } from '../../stores/useNavigationStore';
import type { CourseListViewProps, CourseListPersistedState, CourseData, ArchivedCourse } from './types';
import type { CourseDashboardCourse } from '../../../../../types/apiResponses';
import {
    BackLink,
    IconButton,
    TextInput,
    Dropdown,
    Button,
    Container,
    ListItem,
    Badge,
    SkeletonList,
    ErrorMessage,
    PageHeader,
} from '../../components';
import type { DropdownOption } from '../../components';
import styles from './CourseListView.module.css';

export function CourseListView({ vscodeApi }: CourseListViewProps) {
    const {
        courses,
        archivedCourses,
        archivedLoaded,
        isLoading,
        error,
        searchTerm,
        typeFilter,
        semesterFilter,
        sortBy,
        setCourses,
        setArchivedCourses,
        setSearchTerm,
        setTypeFilter,
        setSemesterFilter,
        setSortBy,
        clearFilters,
        loadCourses,
        loadArchivedCourses,
        filteredCourses,
    } = useCourseListStore();

    const { pushBreadcrumb } = useNavigationStore();

    // Restore persisted state on mount
    useEffect(() => {
        const persistedState = vscodeApi.getState<CourseListPersistedState>();
        if (persistedState) {
            if (persistedState.searchTerm) setSearchTerm(persistedState.searchTerm);
            if (persistedState.typeFilter) setTypeFilter(persistedState.typeFilter as 'all' | 'active' | 'archived');
            if (persistedState.semesterFilter) setSemesterFilter(persistedState.semesterFilter);
            if (persistedState.sortBy) setSortBy(persistedState.sortBy);
        }

        // Push breadcrumb
        pushBreadcrumb('Courses', 'course-list', () => {
            vscodeApi.postMessage({ type: 'command', command: 'showAllCourses' });
        });

        // Listen for courseList messages
        const handleMessage = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return;
            }

            const typedMessage = message as Record<string, unknown> & { type: string };

            // Handle typed message format
            if (typedMessage.type === 'courseListInit') {
                const payload = typedMessage.payload as { courses?: CourseData[]; archivedCourses?: ArchivedCourse[] } | undefined;
                setCourses(payload?.courses ?? [], payload?.archivedCourses);
            } else if (typedMessage.type === 'archivedCoursesLoaded') {
                const payload = typedMessage.payload as { archivedCourses?: ArchivedCourse[] } | undefined;
                setArchivedCourses(payload?.archivedCourses ?? []);
            }
        };

        window.addEventListener('message', handleMessage);

        // Request initial data
        vscodeApi.postMessage({ type: 'ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, [vscodeApi, setCourses, setArchivedCourses, pushBreadcrumb, setSearchTerm, setTypeFilter, setSemesterFilter, setSortBy]);

    // Persist filter state whenever it changes
    useEffect(() => {
        const state: CourseListPersistedState = {
            searchTerm,
            typeFilter,
            semesterFilter,
            sortBy,
        };
        vscodeApi.setState(state);
    }, [searchTerm, typeFilter, semesterFilter, sortBy, vscodeApi]);

    // Get filtered courses
    const filtered = filteredCourses();
    const visibleActiveCourses = typeFilter !== 'archived' ? filtered.active : [];
    const visibleArchivedCourses = typeFilter !== 'active' ? filtered.archived : [];

    // Extract unique semesters for filter dropdown
    const semesterOptions: DropdownOption[] = useMemo(() => {
        const semesters = new Set<string>();

        courses.forEach((courseData) => {
            const semester = courseData.course.semester;
            if (semester && semester !== 'No semester') {
                semesters.add(semester);
            }
        });

        archivedCourses.forEach((course) => {
            const semester = course.semester;
            if (semester && semester !== 'No semester') {
                semesters.add(semester);
            }
        });

        // Sort semesters (newest first) - descending order for newest first
        const sortedSemesters = Array.from(semesters).sort((a, b) => {
            // We need semester comparison, but we can just sort alphabetically for now
            // WS24/25 > SS25 > WS23/24 naturally in reverse alpha
            return b.localeCompare(a);
        });

        return [
            { value: 'all', label: 'All Semesters' },
            ...sortedSemesters.map((semester) => ({ value: semester.toLowerCase(), label: semester })),
        ];
    }, [courses, archivedCourses]);

    // Check if any filters are active
    const hasActiveFilters = searchTerm !== '' || typeFilter !== 'all' || semesterFilter !== 'all' || sortBy !== 'semester-desc';

    const handleReloadCourses = () => {
        loadCourses(vscodeApi);
    };

    const handleLoadArchivedCourses = () => {
        loadArchivedCourses(vscodeApi);
    };

    const handleBackToDashboard = () => {
        vscodeApi.postMessage({ type: 'command', command: 'backToDashboard' });
    };

    const handleOpenSettings = () => {
        vscodeApi.postMessage({ type: 'command', command: 'openSettings' });
    };

    const handleViewCourseDetails = (courseData: CourseData) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseData: courseData.course as unknown as CourseDashboardCourse },
        });
    };

    const handleViewArchivedCourse = (courseId: number) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'viewArchivedCourse',
            payload: { courseId },
        });
    };

    const handleClearFilters = () => {
        clearFilters();
    };

    // Render loading state
    if (isLoading && courses.length === 0) {
        return (
            <div className={styles.courseListContainer}>
                <BackLink onClick={handleBackToDashboard} actions={
                    <>
                        <IconButton.Reload onClick={handleReloadCourses} title="Reload Courses" />
                        <IconButton.Settings onClick={handleOpenSettings} title="Settings" />
                    </>
                }>Back to Dashboard</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Render error state
    if (error) {
        return (
            <div className={styles.courseListContainer}>
                <BackLink onClick={handleBackToDashboard} actions={
                    <>
                        <IconButton.Reload onClick={handleReloadCourses} title="Reload Courses" />
                        <IconButton.Settings onClick={handleOpenSettings} title="Settings" />
                    </>
                }>Back to Dashboard</BackLink>
                <ErrorMessage error={error} onRetry={handleReloadCourses} />
            </div>
        );
    }

    // Search results info
    const searchResultsInfo = hasActiveFilters ? (
        visibleActiveCourses.length === 0 && visibleArchivedCourses.length === 0 ? (
            <div className={styles.searchResultsInfo}>No courses found matching your criteria.</div>
        ) : (
            <div className={styles.searchResultsInfo}>
                Found {visibleActiveCourses.length > 0 && `${visibleActiveCourses.length} active course${visibleActiveCourses.length === 1 ? '' : 's'}`}
                {visibleActiveCourses.length > 0 && visibleArchivedCourses.length > 0 && ' and '}
                {visibleArchivedCourses.length > 0 && `${visibleArchivedCourses.length} archived course${visibleArchivedCourses.length === 1 ? '' : 's'}`}
                {searchTerm && ` matching "${searchTerm}"`}
            </div>
        )
    ) : null;

    return (
        <div className={styles.courseListContainer}>
            <BackLink onClick={handleBackToDashboard} actions={
                <>
                    <IconButton.Reload onClick={handleReloadCourses} title="Reload Courses" />
                    <IconButton.Settings onClick={handleOpenSettings} title="Settings" />
                </>
            }>Back to Dashboard</BackLink>

            <PageHeader title="All Courses" subtitle="Browse and manage your enrolled courses" />

            <Container>
                <div className={styles.searchContainer}>
                    <TextInput
                        type="search"
                        placeholder="Search courses by title, semester, or description..."
                        value={searchTerm}
                        onChange={(value) => setSearchTerm(value)}
                        className={styles.searchInput}
                    />
                </div>
                <div className={styles.controlsGrid}>
                    <div className={styles.controlGroup}>
                        <Dropdown
                            label="Type"
                            value={typeFilter}
                            onChange={(value) => setTypeFilter(value as 'all' | 'active' | 'archived')}
                            options={[
                                { value: 'all', label: 'All Courses' },
                                { value: 'active', label: 'Active Only' },
                                { value: 'archived', label: 'Archived Only' },
                            ]}
                        />
                    </div>
                    <div className={styles.controlGroup}>
                        <Dropdown
                            label="Semester"
                            value={semesterFilter}
                            onChange={(value) => setSemesterFilter(value)}
                            options={semesterOptions}
                        />
                    </div>
                    <div className={styles.controlGroup}>
                        <Dropdown
                            label="Sort by"
                            value={sortBy}
                            onChange={(value) => setSortBy(value)}
                            options={[
                                { value: 'title-asc', label: 'Title (A-Z)' },
                                { value: 'title-desc', label: 'Title (Z-A)' },
                                { value: 'semester-desc', label: 'Newest First' },
                                { value: 'semester-asc', label: 'Oldest First' },
                                { value: 'exercises-desc', label: 'Most Exercises' },
                                { value: 'exercises-asc', label: 'Least Exercises' },
                            ]}
                        />
                    </div>
                    <div className={styles.controlGroupAction}>
                        <Button
                            variant="secondary"
                            onClick={handleClearFilters}
                            disabled={!hasActiveFilters}
                        >
                            Clear Filters
                        </Button>
                    </div>
                </div>
            </Container>

            {searchResultsInfo}

            {typeFilter !== 'archived' && (
                <Container
                    className={styles.coursesSection}
                    listMode
                    header={
                        <div className={styles.sectionHeaderWithBadge}>
                            <h3 className={styles.sectionTitle}>Active Courses</h3>
                            <Badge variant="default">{courses.length}</Badge>
                        </div>
                    }
                >
                    {visibleActiveCourses.length > 0 ? (
                        visibleActiveCourses.map((courseData, index) => {
                            const course = courseData.course;
                            const exerciseCount = course.exercises?.length || 0;
                            const semester = course.semester || 'No semester';
                            const description = course.description || 'No description available';
                            const courseColor = course.color || '#6c757d';

                            return (
                                <ListItem
                                    key={`active-${course.id}-${index}`}
                                    onClick={() => handleViewCourseDetails(courseData)}
                                    className={styles.courseItem}
                                >
                                    <div className={styles.courseColorIndicator} style={{ backgroundColor: courseColor }} />
                                    <div className={styles.courseContent}>
                                        <div className={styles.courseHeader}>
                                            <div className={styles.courseTitle}>{course.title}</div>
                                            <Badge variant="info" className={styles.courseSemester}>
                                                {semester}
                                            </Badge>
                                        </div>
                                        <div className={styles.courseDescription}>{description}</div>
                                        <div className={styles.courseStats}>
                                            <span>{exerciseCount} exercises</span>
                                            <span>ID: {course.id}</span>
                                        </div>
                                    </div>
                                </ListItem>
                            );
                        })
                    ) : (
                        <div className={styles.noCourses}>
                            {hasActiveFilters ? 'No active courses match your criteria.' : 'No courses available'}
                        </div>
                    )}
                </Container>
            )}

            {!archivedLoaded && typeFilter !== 'active' && (
                <div className={styles.loadArchivedSection}>
                    <Button variant="secondary" onClick={handleLoadArchivedCourses}>
                        Load Archived Courses
                    </Button>
                </div>
            )}

            {archivedLoaded && typeFilter !== 'active' && (
                <Container
                    className={styles.archivedSection}
                    listMode
                    header={
                        <div className={styles.sectionHeaderWithBadge}>
                            <h3 className={styles.sectionTitle}>Archived Courses</h3>
                            <Badge variant="default">{archivedCourses.length}</Badge>
                        </div>
                    }
                >
                    {visibleArchivedCourses.length > 0 ? (
                        visibleArchivedCourses.map((course, index) => {
                            const courseColor = course.color || '#6c757d';
                            const semester = course.semester || 'No semester';

                            return (
                                <ListItem
                                    key={`archived-${course.id}-${index}`}
                                    onClick={() => handleViewArchivedCourse(course.id)}
                                    className={styles.courseItem}
                                >
                                    <div className={styles.courseColorIndicator} style={{ backgroundColor: courseColor }} />
                                    <div className={styles.courseContent}>
                                        <div className={styles.courseHeader}>
                                            <div className={styles.courseTitle}>{course.title}</div>
                                            <Badge variant="muted" className={styles.courseSemester}>
                                                {semester}
                                            </Badge>
                                        </div>
                                        <div className={styles.courseStats}>
                                            <span>ID: {course.id}</span>
                                            <span className={styles.archivedLabel}>Archived</span>
                                        </div>
                                    </div>
                                </ListItem>
                            );
                        })
                    ) : (
                        <div className={styles.noCourses}>
                            {hasActiveFilters ? 'No archived courses match your criteria.' : 'No archived courses available'}
                        </div>
                    )}
                </Container>
            )}
        </div>
    );
}
