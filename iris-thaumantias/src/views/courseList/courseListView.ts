import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { IconDefinitions } from '../../utils/iconDefinitions';
import { TextInputComponent } from '../components/input/textInputComponent';
import { DropdownComponent } from '../components/dropdown/dropdownComponent';
import { ContainerComponent } from '../components/container/containerComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { BadgeComponent } from '../components/badge/badgeComponent';

export class CourseListView {
    public generateHtml(coursesData: any | undefined, archivedCoursesData: any[] | undefined): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'components/button/button.css',
            'components/container/container.css',
            'components/listItem/list-item.css',
            'components/badge/badge.css',
            'courseList/course-list.css',
            'components/input/input.css',
            'components/dropdown/dropdown.css'
        );

        return this._getCourseListHtml(coursesData, archivedCoursesData, styles);
    }

    private _getCourseListHtml(coursesData: any | undefined, archivedCoursesData: any[] | undefined, styles: string): string {
        let coursesHtml = '';
        const safeCoursesJson = JSON.stringify(coursesData?.courses ?? []).replace(/</g, '\\u003c');

        // Generate current courses
        if (coursesData?.courses) {
            coursesHtml = coursesData.courses.map((courseData: any, courseIndex: number) => {
                const course = courseData.course;
                const exerciseCount = course.exercises ? course.exercises.length : 0;
                const semester = course.semester || 'No semester';
                const description = course.description || 'No description available';
                const courseColor = course.color || '#6c757d';

                return ListItemComponent.generate(
                    {
                        className: 'course-item',
                        clickable: true,
                        hover: true,
                        command: `viewCourseDetails(${courseIndex})`,
                        dataAttributes: {
                            'course-id': course.id.toString(),
                            'course-index': courseIndex.toString()
                        }
                    },
                    `
                        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
                        <div class="course-content">
                            <div class="course-header">
                                <div class="course-title">${course.title}</div>
                                ${BadgeComponent.generate({ label: semester, variant: 'primary', className: 'course-semester' })}
                            </div>
                            <div class="course-description">${description}</div>
                            <div class="course-stats">
                                <span>${exerciseCount} exercises</span>
                                <span>ID: ${course.id}</span>
                            </div>
                        </div>
                    `
                );
            }).join('');
        } else {
            coursesHtml = '<div class="no-courses">No courses available</div>';
        }

        // Add load archived courses button if no archived courses are loaded yet
        let loadArchivedButton = '';
        if (!archivedCoursesData) {
            loadArchivedButton = `
                <div class="load-archived-section">
                    ${ButtonComponent.generate({
                label: 'Load Archived Courses',
                variant: 'secondary',
                command: 'loadArchivedCourses()',
                className: 'load-archived-btn'
            })}
                </div>
            `;
        }

        // Generate archived courses section if data is available
        let archivedCoursesHtml = '';
        if (archivedCoursesData && archivedCoursesData.length > 0) {
            const archivedItemsHtml = archivedCoursesData.map((course: any) => {
                const courseColor = course.color || '#6c757d';
                const semester = course.semester || 'No semester';

                return ListItemComponent.generate(
                    {
                        className: 'course-item archived-course',
                        clickable: true,
                        hover: true,
                        command: `viewArchivedCourse(${course.id})`,
                        dataAttributes: {
                            'course-id': course.id.toString()
                        }
                    },
                    `
                        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
                        <div class="course-content">
                            <div class="course-header">
                                <div class="course-title">${course.title}</div>
                                ${BadgeComponent.generate({ label: semester, variant: 'secondary', className: 'course-semester archived' })}
                            </div>
                            <div class="course-stats">
                                <span>ID: ${course.id}</span>
                                <span class="archived-label">Archived</span>
                            </div>
                        </div>
                    `
                );
            }).join('');

            archivedCoursesHtml = ContainerComponent.generate({
                className: 'archived-section',
                listMode: true,
                header: {
                    title: 'Archived Courses',
                    badge: archivedCoursesData.length.toString(),
                    divider: true
                },
                bodyHtml: `<div class="archived-courses-container">${archivedItemsHtml}</div>`
            });
        } else if (archivedCoursesData && archivedCoursesData.length === 0) {
            archivedCoursesHtml = ContainerComponent.generate({
                className: 'archived-section',
                header: {
                    title: 'Archived Courses',
                    divider: true
                },
                state: {
                    type: 'info',
                    message: 'No archived courses available'
                }
            });
        }

        // Generate header with search and filters
        const headerContainer = ContainerComponent.generate({
            className: 'header-container',
            header: {
                title: 'All Courses',
                subtitle: 'Browse and manage your enrolled courses',
                titleSize: 'xlarge',
                actionsHtml: ButtonComponent.generate({
                    label: 'Reload',
                    icon: IconDefinitions.getIcon('refresh'),
                    variant: 'primary',
                    command: 'reloadCourses()',
                    height: '2rem'
                })
            },
            bodyHtml: `
                <div class="search-container">
                    ${TextInputComponent.generate({
                id: 'courseSearch',
                type: 'search',
                placeholder: 'Search courses by title, semester, or description...',
                className: 'search-input',
                height: '2.5rem'
            })}
                </div>
                <div class="controls-grid">
                    <div class="control-group">
                        ${DropdownComponent.generate({
                id: 'typeFilter',
                label: 'Type',
                size: 'medium',
                onChange: 'window.handleFiltersChange()',
                options: [
                    { value: 'all', label: 'All Courses', selected: true },
                    { value: 'active', label: 'Active Only' },
                    { value: 'archived', label: 'Archived Only' }
                ]
            })}
                    </div>
                    <div class="control-group">
                        ${DropdownComponent.generate({
                id: 'semesterFilter',
                label: 'Semester',
                size: 'medium',
                onChange: 'window.handleFiltersChange()',
                options: [
                    { value: 'all', label: 'All Semesters', selected: true }
                ]
            })}
                    </div>
                    <div class="control-group">
                        ${DropdownComponent.generate({
                id: 'sortBy',
                label: 'Sort by',
                size: 'medium',
                onChange: 'window.handleFiltersChange()',
                options: [
                    { value: 'title-asc', label: 'Title (A-Z)' },
                    { value: 'title-desc', label: 'Title (Z-A)' },
                    { value: 'semester-desc', label: 'Newest First', selected: true },
                    { value: 'semester-asc', label: 'Oldest First' },
                    { value: 'exercises-desc', label: 'Most Exercises' },
                    { value: 'exercises-asc', label: 'Least Exercises' }
                ]
            })}
                    </div>
                    <div class="control-group control-group--action">
                        ${ButtonComponent.generate({
                id: 'clearFiltersBtn',
                label: 'Clear Filters',
                variant: 'secondary',
                command: 'window.clearAllFilters()',
                disabled: true
            })}
                    </div>
                </div>
            `
        });

        // Generate active courses container
        const activeCoursesContainer = ContainerComponent.generate({
            className: 'courses-section',
            listMode: true,
            header: {
                title: 'Active Courses',
                badge: coursesData?.courses?.length?.toString() || '0',
                divider: true
            },
            bodyHtml: coursesHtml || '<div class="no-courses">No courses available</div>'
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Courses</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    ${BackLinkComponent.generateHtml()}
    <div class="course-list-container">
        ${headerContainer}
        <div id="searchResults" class="search-results-info" style="display: none;"></div>
        <div class="courses-wrapper">
            ${activeCoursesContainer}
            ${loadArchivedButton}
            ${archivedCoursesHtml}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const courseListData = ${safeCoursesJson};
        
        ${BackLinkComponent.generateScript()}
        ${ContainerComponent.generateScript()}
        
        window.reloadCourses = function() {
            vscode.postMessage({ command: 'reloadCourses' });
        };
        
        window.viewCourseDetails = function(courseIndex) {
            const courseData = Array.isArray(courseListData) ? courseListData[courseIndex] : undefined;
            if (!courseData) {
                console.warn('[Course List] Course not found for index:', courseIndex);
                return;
            }
            
            vscode.postMessage({ 
                command: 'viewCourseDetails',
                courseData: courseData
            });
        };

        window.loadArchivedCourses = function() {
            vscode.postMessage({ command: 'loadArchivedCourses' });
        };

        window.viewArchivedCourse = function(courseId) {
            vscode.postMessage({ 
                command: 'viewArchivedCourse',
                courseId: courseId
            });
        };

        // Search functionality
        window.handleSearch = function(searchTerm) {
            handleFiltersChange();
        };

        // Main filter and sort function
        window.handleFiltersChange = function() {
            const searchTerm = document.getElementById('courseSearch')?.value?.toLowerCase().trim() || '';
            const typeFilter = document.getElementById('typeFilter')?.value || 'all';
            const semesterFilter = document.getElementById('semesterFilter')?.value || 'all';
            const sortBy = document.getElementById('sortBy')?.value || 'title-asc';
            
            const courseItems = Array.from(document.querySelectorAll('.course-item'));
            const archivedSection = document.querySelector('.archived-section');
            const archivedSeparator = document.querySelector('.section-separator');
            const searchResults = document.getElementById('searchResults');
            const clearFiltersBtn = document.getElementById('clearFiltersBtn');
            
            // Check if any filters are active
            const hasActiveFilters = searchTerm !== '' || typeFilter !== 'all' || semesterFilter !== 'all' || sortBy !== 'semester-desc';
            
            if (clearFiltersBtn) {
                clearFiltersBtn.disabled = !hasActiveFilters;
                
                // Also toggle the btn-disabled class for proper styling
                if (hasActiveFilters) {
                    clearFiltersBtn.classList.remove('btn-disabled');
                    // Add onclick handler when enabling the button
                    if (!clearFiltersBtn.hasAttribute('onclick')) {
                        clearFiltersBtn.setAttribute('onclick', 'window.clearAllFilters()');
                    }
                } else {
                    clearFiltersBtn.classList.add('btn-disabled');
                    // Remove onclick handler when disabling the button
                    clearFiltersBtn.removeAttribute('onclick');
                }
            }

            let visibleCourses = 0;
            let visibleActiveCourses = 0;
            let visibleArchivedCourses = 0;
            let totalActiveCourses = 0;
            let totalArchivedCourses = 0;

            // Count total courses and filter
            const filteredCourses = courseItems.filter(item => {
                const title = item.querySelector('.course-title')?.textContent?.toLowerCase() || '';
                const semester = item.querySelector('.course-semester')?.textContent?.toLowerCase() || '';
                const description = item.querySelector('.course-description')?.textContent?.toLowerCase() || '';
                const isArchived = item.classList.contains('archived-course');
                
                if (isArchived) {
                    totalArchivedCourses++;
                } else {
                    totalActiveCourses++;
                }

                // Apply filters
                let isVisible = true;

                // Search filter
                if (searchTerm && !title.includes(searchTerm) && !semester.includes(searchTerm) && !description.includes(searchTerm)) {
                    isVisible = false;
                }

                // Type filter
                if (typeFilter === 'active' && isArchived) {
                    isVisible = false;
                } else if (typeFilter === 'archived' && !isArchived) {
                    isVisible = false;
                }

                // Semester filter
                if (semesterFilter !== 'all' && semester !== semesterFilter.toLowerCase()) {
                    isVisible = false;
                }

                return isVisible;
            });

            // Sort courses
            filteredCourses.sort((a, b) => {
                const aTitleEl = a.querySelector('.course-title');
                const bTitleEl = b.querySelector('.course-title');
                const aSemesterEl = a.querySelector('.course-semester');
                const bSemesterEl = b.querySelector('.course-semester');
                
                const aTitle = aTitleEl?.textContent || '';
                const bTitle = bTitleEl?.textContent || '';
                const aSemester = aSemesterEl?.textContent || '';
                const bSemester = bSemesterEl?.textContent || '';
                
                // Get exercise count for active courses
                const getExerciseCount = (item) => {
                    const statsText = item.querySelector('.course-stats')?.textContent || '';
                    const match = statsText.match(/(\\d+)\\s+exercises?/);
                    return match ? parseInt(match[1]) : 0;
                };

                switch (sortBy) {
                    case 'title-desc':
                        return bTitle.localeCompare(aTitle);
                    case 'title-asc':
                        return aTitle.localeCompare(bTitle);
                    case 'semester-desc':
                        return compareSemesters(bSemester, aSemester); // newest first
                    case 'semester-asc':
                        return compareSemesters(aSemester, bSemester); // oldest first
                    case 'exercises-desc':
                        return getExerciseCount(b) - getExerciseCount(a);
                    case 'exercises-asc':
                        return getExerciseCount(a) - getExerciseCount(b);
                    default:
                        return aTitle.localeCompare(bTitle);
                }
            });

            // Apply visibility and reorder
            courseItems.forEach(item => item.classList.add('hidden'));
            
            const coursesSection = document.querySelector('.courses-section');
            const loadArchivedSection = document.querySelector('.load-archived-section');
            
            // Get the body of the courses section for reordering
            const coursesSectionBody = coursesSection?.querySelector('.ui-container__body');
            
            filteredCourses.forEach((item, index) => {
                item.classList.remove('hidden');
                visibleCourses++;
                
                if (item.classList.contains('archived-course')) {
                    visibleArchivedCourses++;
                } else {
                    visibleActiveCourses++;
                }
            });

            // Handle archived section visibility
            if (archivedSection) {
                const showArchivedSection = (typeFilter !== 'active') && 
                    (visibleArchivedCourses > 0 || (typeFilter === 'all' && totalArchivedCourses > 0));
                
                archivedSection.style.display = showArchivedSection ? 'block' : 'none';
            }

            // Handle courses section visibility
            if (coursesSection) {
                const showCoursesSection = (typeFilter !== 'archived') && 
                    (visibleActiveCourses > 0 || totalActiveCourses > 0);
                coursesSection.style.display = showCoursesSection ? 'block' : 'none';
            }

            // Update search results info
            updateSearchResultsInfo(searchResults, searchTerm, typeFilter, semesterFilter, 
                visibleCourses, visibleActiveCourses, visibleArchivedCourses, 
                totalActiveCourses, totalArchivedCourses);

            // Handle no courses message
            handleNoCoursesMessage(searchTerm, typeFilter, visibleActiveCourses, totalActiveCourses);
        };

        function updateSearchResultsInfo(searchResults, searchTerm, typeFilter, semesterFilter, 
            visibleCourses, visibleActiveCourses, visibleArchivedCourses, totalActiveCourses, totalArchivedCourses) {
            
            if (!searchResults) return;

            const hasFilters = searchTerm !== '' || typeFilter !== 'all' || semesterFilter !== 'all';
            
            if (!hasFilters) {
                searchResults.style.display = 'none';
                return;
            }

            searchResults.style.display = 'block';
            let resultsText = '';
            
            if (visibleCourses === 0) {
                resultsText = 'No courses found matching your criteria.';
            } else {
                const parts = [];
                if (typeFilter !== 'archived' && visibleActiveCourses > 0) {
                    parts.push(\`\${visibleActiveCourses} active course\${visibleActiveCourses === 1 ? '' : 's'}\`);
                }
                if (typeFilter !== 'active' && visibleArchivedCourses > 0) {
                    parts.push(\`\${visibleArchivedCourses} archived course\${visibleArchivedCourses === 1 ? '' : 's'}\`);
                }
                
                let filterDesc = '';
                const filters = [];
                if (searchTerm) filters.push(\`"\${searchTerm}"\`);
                if (typeFilter !== 'all') filters.push(typeFilter + ' courses');
                if (semesterFilter !== 'all') filters.push(semesterFilter);
                if (filters.length > 0) filterDesc = \` matching \${filters.join(', ')}\`;
                
                resultsText = \`Found \${parts.join(' and ')}\${filterDesc}\`;
            }
            
            searchResults.textContent = resultsText;
        }

        function handleNoCoursesMessage(searchTerm, typeFilter, visibleActiveCourses, totalActiveCourses) {
            const noCoursesMsg = document.querySelector('.courses-section .no-courses');
            if (!noCoursesMsg) return;

            const hasActiveFilters = searchTerm !== '' || typeFilter !== 'all';
            
            if (hasActiveFilters && visibleActiveCourses === 0 && totalActiveCourses > 0) {
                noCoursesMsg.style.display = 'block';
                noCoursesMsg.textContent = 'No active courses match your criteria.';
            } else if (!hasActiveFilters || totalActiveCourses === 0) {
                noCoursesMsg.style.display = totalActiveCourses === 0 ? 'block' : 'none';
                noCoursesMsg.textContent = 'No courses available';
            } else {
                noCoursesMsg.style.display = 'none';
            }
        }

        // Clear all filters function
        window.clearAllFilters = function() {
            const searchInput = document.getElementById('courseSearch');
            const typeFilter = document.getElementById('typeFilter');
            const semesterFilter = document.getElementById('semesterFilter');
            const sortBy = document.getElementById('sortBy');
            
            if (searchInput) searchInput.value = '';
            if (typeFilter) typeFilter.value = 'all';
            if (semesterFilter) semesterFilter.value = 'all';
            if (sortBy) sortBy.value = 'semester-desc';
            
            window.handleFiltersChange();
        };

        // Populate semester filter options
        function populateSemesterFilter() {
            const semesterFilter = document.getElementById('semesterFilter');
            if (!semesterFilter) return;

            const semesters = new Set();
            const semesterElements = document.querySelectorAll('.course-semester');
            
            semesterElements.forEach(el => {
                const semester = el.textContent?.trim();
                if (semester && semester !== 'No semester') {
                    semesters.add(semester);
                }
            });

            // Sort semesters properly (newest first)
            const sortedSemesters = Array.from(semesters).sort((a, b) => {
                return compareSemesters(b, a); // b, a for descending order (newest first)
            });
            
            // Clear existing options except "All Semesters"
            while (semesterFilter.children.length > 1) {
                semesterFilter.removeChild(semesterFilter.lastChild);
            }
            
            // Add semester options
            sortedSemesters.forEach(semester => {
                const option = document.createElement('option');
                option.value = semester.toLowerCase();
                option.textContent = semester;
                semesterFilter.appendChild(option);
            });
        }

        // Function to properly compare semesters
        function compareSemesters(a, b) {
            // Parse semester format: WS24/25, SS25, etc.
            function parseSemester(semester) {
                const cleanSemester = semester.toUpperCase().trim();
                
                // Match patterns like WS24/25, WS2024/2025, SS25, SS2025
                const wsMatch = cleanSemester.match(/^WS(\\d{2,4})(?:\\/(\\d{2,4}))?$/);
                const ssMatch = cleanSemester.match(/^SS(\\d{2,4})$/);
                
                if (wsMatch) {
                    // Winter semester: WS24/25 or WS24
                    let year = parseInt(wsMatch[1]);
                    // Convert 2-digit years to 4-digit (24 -> 2024)
                    if (year < 100) year += 2000;
                    // Winter semester starts in fall, so it's the later year
                    return { type: 'WS', year: year, sortKey: year * 10 + 1 }; // +1 to make WS slightly later than SS of same year
                } else if (ssMatch) {
                    // Summer semester: SS25
                    let year = parseInt(ssMatch[1]);
                    // Convert 2-digit years to 4-digit (25 -> 2025)
                    if (year < 100) year += 2000;
                    return { type: 'SS', year: year, sortKey: year * 10 };
                }
                
                // Fallback for unknown formats
                return { type: 'UNKNOWN', year: 0, sortKey: 0 };
            }
            
            const semesterA = parseSemester(a);
            const semesterB = parseSemester(b);
            
            // Compare by sortKey (higher = newer)
            return semesterA.sortKey - semesterB.sortKey;
        }

        // Focus search input on page load
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('courseSearch');
            if (searchInput) {
                // Don't auto-focus as it might interfere with webview
                // searchInput.focus();
                
                // Connect search input to handleSearch function
                searchInput.addEventListener('input', function(e) {
                    window.handleSearch(e.target.value);
                });
            }
            
            // Populate semester filter options
            populateSemesterFilter();
            
            // Initialize filters
            window.handleFiltersChange();
        });
    </script>
</body>
</html>`;
    }
}
