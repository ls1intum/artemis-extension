import { StyleManager } from '../styles';
import { BackLinkComponent } from '../components/backLinkComponent';

export class CourseListView {
    private _styleManager: StyleManager;

    constructor(styleManager: StyleManager) {
        this._styleManager = styleManager;
    }

    public generateHtml(coursesData: any | undefined, archivedCoursesData: any[] | undefined): string {
        const styles = this._styleManager.getStyles([
            'views/course-list.css'
        ]);
        
        return this._getCourseListHtml(coursesData, archivedCoursesData, styles);
    }

    private _getCourseListHtml(coursesData: any | undefined, archivedCoursesData: any[] | undefined, styles: string): string {
        let coursesHtml = '';
        
        // Generate current courses
        if (coursesData?.courses) {
            coursesHtml = coursesData.courses.map((courseData: any) => {
                const course = courseData.course;
                const exerciseCount = course.exercises ? course.exercises.length : 0;
                const semester = course.semester || 'No semester';
                const description = course.description || 'No description available';
                const courseColor = course.color || '#6c757d';  // Default to gray if no color
                
                return `
                    <div class="course-item" onclick="viewCourseDetails(${JSON.stringify(courseData).replace(/"/g, '&quot;')})">
                        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
                        <div class="course-content">
                            <div class="course-header">
                                <div class="course-title">${course.title}</div>
                                <div class="course-semester">${semester}</div>
                            </div>
                            <div class="course-description">${description}</div>
                            <div class="course-stats">
                                <span>${exerciseCount} exercises</span>
                                <span>ID: ${course.id}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            coursesHtml = '<div class="no-courses">No courses available</div>';
        }

        // Add load archived courses button if no archived courses are loaded yet
        let loadArchivedButton = '';
        if (!archivedCoursesData) {
            loadArchivedButton = `
                <div class="load-archived-section">
                    <button class="load-archived-btn" onclick="loadArchivedCourses()">
                        Load Archived Courses
                    </button>
                </div>
            `;
        }

        // Generate archived courses section if data is available
        let archivedCoursesHtml = '';
        if (archivedCoursesData && archivedCoursesData.length > 0) {
            const archivedItemsHtml = archivedCoursesData.map((course: any) => {
                const courseColor = course.color || '#6c757d';
                const semester = course.semester || 'No semester';
                
                return `
                    <div class="course-item archived-course" onclick="viewArchivedCourse(${course.id})">
                        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
                        <div class="course-content">
                            <div class="course-header">
                                <div class="course-title">${course.title}</div>
                                <div class="course-semester archived">${semester}</div>
                            </div>
                            <div class="course-stats">
                                <span>ID: ${course.id}</span>
                                <span class="archived-label">Archived</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            archivedCoursesHtml = `
                <div class="archived-section">
                    <div class="section-separator">
                        <div class="separator-line"></div>
                        <div class="separator-text">Archived Courses</div>
                        <div class="separator-line"></div>
                    </div>
                    <div class="archived-courses-container">
                        ${archivedItemsHtml}
                    </div>
                </div>
            `;
        } else if (archivedCoursesData && archivedCoursesData.length === 0) {
            archivedCoursesHtml = `
                <div class="archived-section">
                    <div class="section-separator">
                        <div class="separator-line"></div>
                        <div class="separator-text">Archived Courses</div>
                        <div class="separator-line"></div>
                    </div>
                    <div class="no-courses">No archived courses available</div>
                </div>
            `;
        }
        
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
    
    <div class="header">
        <h1>All Courses</h1>
        <div class="search-container">
            <input type="text" class="search-input" id="courseSearch" placeholder="Search courses by title, semester, or description..." oninput="handleSearch(this.value)">
            <button class="reload-courses-btn" onclick="reloadCourses()" title="Reload courses">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.65 2.35C12.2 0.9 10.21 0 8 0 3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z"/>
                </svg>
                Reload Courses
            </button>
        </div>
            <div class="controls-container" id="controlsContainer">
                <div class="controls-header" onclick="toggleControls()">
                    <h3 class="controls-header-title">Filter & Sort Options</h3>
                    <div class="controls-toggle">▼</div>
                </div>
                <div class="controls-content">
                    <div class="controls-grid">
                        <div class="control-section filter-section">
                            <h3 class="control-section-title">Filter</h3>
                            <div class="control-row">
                                <div class="control-group">
                                    <label class="control-label" for="typeFilter">Type</label>
                                    <select class="control-select" id="typeFilter" onchange="handleFiltersChange()">
                                        <option value="all">All Courses</option>
                                        <option value="active">Active Only</option>
                                        <option value="archived">Archived Only</option>
                                    </select>
                                </div>
                                <div class="control-group">
                                    <label class="control-label" for="semesterFilter">Semester</label>
                                    <select class="control-select" id="semesterFilter" onchange="handleFiltersChange()">
                                        <option value="all">All Semesters</option>
                                        <!-- Options will be populated dynamically -->
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="control-section sort-section">
                            <h3 class="control-section-title">Sort</h3>
                            <div class="control-group">
                                <label class="control-label" for="sortBy">Order by</label>
                                <select class="control-select" id="sortBy" onchange="handleFiltersChange()">
                                    <option value="title-asc">Title (A-Z)</option>
                                    <option value="title-desc">Title (Z-A)</option>
                                    <option value="semester-desc">Newest First</option>
                                    <option value="semester-asc">Oldest First</option>
                                    <option value="exercises-desc">Most Exercises</option>
                                    <option value="exercises-asc">Least Exercises</option>
                                </select>
                            </div>
                        </div>
                        <div class="clear-section">
                            <button class="clear-filters-btn" id="clearFiltersBtn" onclick="clearAllFilters()" disabled>
                                Clear Filters
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div id="searchResults" class="search-results-info" style="display: none;"></div>
    
    <div class="courses-container">
        ${coursesHtml}
        ${loadArchivedButton}
        ${archivedCoursesHtml}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        ${BackLinkComponent.generateScript()}
        
        window.reloadCourses = function() {
            vscode.postMessage({ command: 'reloadCourses' });
        };
        
        window.viewCourseDetails = function(courseData) {
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
            const hasActiveFilters = searchTerm !== '' || typeFilter !== 'all' || semesterFilter !== 'all' || sortBy !== 'title-asc';
            if (clearFiltersBtn) {
                clearFiltersBtn.disabled = !hasActiveFilters;
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
            
            const coursesContainer = document.querySelector('.courses-container');
            const loadArchivedSection = document.querySelector('.load-archived-section');
            
            // Get insertion point (before archived section or load button)
            const insertionPoint = archivedSection || loadArchivedSection || null;
            
            filteredCourses.forEach((item, index) => {
                item.classList.remove('hidden');
                visibleCourses++;
                
                if (item.classList.contains('archived-course')) {
                    visibleArchivedCourses++;
                } else {
                    visibleActiveCourses++;
                    // Reorder active courses
                    if (coursesContainer && insertionPoint) {
                        coursesContainer.insertBefore(item, insertionPoint);
                    }
                }
            });

            // Handle archived section visibility
            if (archivedSection) {
                const showArchivedSection = (typeFilter !== 'active') && 
                    (visibleArchivedCourses > 0 || (typeFilter === 'all' && totalArchivedCourses > 0));
                
                archivedSection.style.display = showArchivedSection ? 'block' : 'none';
                if (archivedSeparator) archivedSeparator.style.display = showArchivedSection ? 'flex' : 'none';
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
            const noCoursesMsg = document.querySelector('.courses-container .no-courses');
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
            document.getElementById('courseSearch').value = '';
            document.getElementById('typeFilter').value = 'all';
            document.getElementById('semesterFilter').value = 'all';
            document.getElementById('sortBy').value = 'title-asc';
            handleFiltersChange();
        };

        // Toggle controls visibility
        window.toggleControls = function() {
            const container = document.getElementById('controlsContainer');
            if (container) {
                container.classList.toggle('expanded');
            }
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
            }
            
            // Populate semester filter options
            populateSemesterFilter();
            
            // Initialize filters
            handleFiltersChange();
        });
    </script>
</body>
</html>`;
    }
}
