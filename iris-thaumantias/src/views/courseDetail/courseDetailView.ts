import * as vscode from 'vscode';
import { IconDefinitions } from '../../utils';
import { readCssFiles } from '../utils';
import { BackLinkComponent } from '../components/backLink/backLinkComponent';
import { ButtonComponent } from '../components/button/buttonComponent';
import { TextInputComponent } from '../components/input/textInputComponent';
import { ListItemComponent } from '../components/listItem/listItemComponent';
import { DropdownComponent } from '../components/dropdown/dropdownComponent';
import { BadgeComponent } from '../components/badge/badgeComponent';
import { AskIrisComponent } from '../components/askIris/askIrisComponent';

export class CourseDetailView {
    private _extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this._extensionContext = extensionContext;
    }

    private _getExerciseIcon(type: string): string {
        return IconDefinitions.getIcon(type);
    }

    public generateHtml(courseData: any, hideDeveloperTools: boolean = false, webview?: vscode.Webview): string {
        const styles = readCssFiles(
            'components/backLink/back-link.css',
            'courseDetail/course-detail.css',
            'components/button/button.css',
            'components/input/input.css',
            'components/listItem/list-item.css',
            'components/dropdown/dropdown.css',
            'components/badge/badge.css',
            'components/container/container.css',
            'components/askIris/ask-iris.css'
        );

        if (!courseData) {
            return this._getEmptyStateHtml(styles);
        }

        return this._getCourseDetailHtml(courseData, hideDeveloperTools, styles, webview);
    }

    private _getEmptyStateHtml(styles: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Course Details</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    <div class="empty-state">
        <h2>Course Details</h2>
        <p>Select a course to view its details</p>
    ${BackLinkComponent.generateHtml({ wrap: false })}
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        ${BackLinkComponent.generateScript()}
    </script>
</body>
</html>`;
    }

    private _getCourseDetailHtml(courseData: any, hideDeveloperTools: boolean, styles: string, webview?: vscode.Webview): string {
        const course = courseData?.course;
        if (!course) {
            return this._getEmptyStateHtml(styles);
        }

        const courseTitle = course?.title || 'Unknown Course';
        const courseDescription = course?.description || 'No description available';
        const semester = course?.semester || 'No semester';
        const exerciseCount = course?.exercises?.length || 0;
        const instructorGroup = course?.instructorGroupName || 'Unknown';
        const studentCount = course?.numberOfStudents || 0;
        const courseColor = course?.color || '#6c757d';  // Default to gray if no color
        const starAssistIcon = IconDefinitions.getIcon('star_4_edges');

        // Format exercises
        let exercisesHtml = '';
        let allExercisesJson = '[]';

        // Format exams
        const exams = course?.exams || [];
        let examsHtml = '';
        const examCount = exams.length;

        if (exams.length > 0) {
            // Sort exams: Active first, then Upcoming, then Finished
            const sortedExams = [...exams].sort((a: any, b: any) => {
                const now = new Date().getTime();

                // Calculate status for exam a
                const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
                const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
                const aIsActive = now >= aStart && now <= aEnd;
                const aIsUpcoming = now < aStart;

                // Calculate status for exam b
                const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
                const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
                const bIsActive = now >= bStart && now <= bEnd;
                const bIsUpcoming = now < bStart;

                // Priority: Active > Upcoming > Finished
                if (aIsActive && !bIsActive) {
                    return -1;
                }
                if (!aIsActive && bIsActive) {
                    return 1;
                }
                if (aIsUpcoming && !bIsUpcoming && !bIsActive) {
                    return -1;
                }
                if (!aIsUpcoming && bIsUpcoming && !aIsActive) {
                    return 1;
                }

                return 0;
            });

            examsHtml = sortedExams.map((exam: any) => {
                const startDate = exam.startDate ? new Date(exam.startDate).toLocaleString() : 'No start date';
                const endDate = exam.endDate ? new Date(exam.endDate).toLocaleString() : 'No end date';

                // Calculate status
                const now = new Date().getTime();
                const start = exam.startDate ? new Date(exam.startDate).getTime() : 0;
                const end = exam.endDate ? new Date(exam.endDate).getTime() : 0;

                let status = 'Upcoming';
                let showBadge = false;
                let activeOutline: string | undefined;

                if (now > end) {
                    status = 'Finished';
                } else if (now >= start && now <= end) {
                    status = 'Active';
                    showBadge = true;
                    activeOutline = '2px solid var(--theme-button-background)';
                }

                const statusBadge = showBadge ? BadgeComponent.generate({
                    label: status,
                    variant: 'primary',
                    height: '1rem',
                    className: 'exam-status-badge'
                }) : '';

                return ListItemComponent.generate(
                    {
                        className: 'exam-item',
                        clickable: true,
                        command: `openExam(${exam.id})`,
                        outline: activeOutline,
                        dataAttributes: {
                            'title': (exam.title?.toLowerCase() || ''),
                            'id': exam.id.toString()
                        }
                    },
                    `
                        <div class="exam-header">
                            <span class="exam-title">${exam.title}</span>
                        </div>
                        <div class="exam-info">
                            <span>${startDate} - ${endDate}</span>
                            ${statusBadge}
                        </div>
                    `
                );
            }).join('');
        } else {
            examsHtml = '<div class="no-exercises">No exams available</div>';
        }

        if (course?.exercises && course.exercises.length > 0) {
            allExercisesJson = JSON.stringify(course.exercises);
            exercisesHtml = course.exercises.map((exercise: any) => {
                const dueDate = exercise.dueDate ? new Date(exercise.dueDate).toLocaleDateString() : 'No due date';
                const releaseDate = exercise.releaseDate ? new Date(exercise.releaseDate).toLocaleDateString() : 'No release date';
                const exerciseIcon = this._getExerciseIcon(exercise.type);
                const dueDateTimestamp = exercise.dueDate ? new Date(exercise.dueDate).getTime() : 0;
                const points = exercise.maxPoints || 0;

                // Use ListItemComponent for consistent styling
                return ListItemComponent.generate(
                    {
                        className: 'exercise-item',
                        clickable: true,
                        command: `openExerciseDetails(${exercise.id})`,
                        dataAttributes: {
                            'title': (exercise.title?.toLowerCase() || ''),
                            'type': (exercise.type?.toLowerCase() || ''),
                            'exercise-id': exercise.id.toString(),
                            'due-date': dueDateTimestamp.toString(),
                            'points': points.toString(),
                            'id': exercise.id.toString()
                        }
                    },
                    `
                        <div class="exercise-header">
                            <span class="exercise-title">${exercise.title}</span>
                            <span class="exercise-type-icon">${exerciseIcon}</span>
                        </div>
                        <div class="exercise-info">
                            <span>Due: ${dueDate}</span>
                            <span>Released: ${releaseDate}</span>
                            <span>${points} ${points === 1 ? 'point' : 'points'}</span>
                        </div>
                    `
                );
            }).join('');

            // Show all exercises; no footer needed
        } else {
            const isArchived = course?.isArchived;
            const noExercisesMessage = isArchived
                ? 'No exercises available for this archived course'
                : 'No exercises available';
            exercisesHtml = `<div class="no-exercises">${noExercisesMessage}</div>`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Course Details</title>
        <style>
        ${styles}
        </style>
</head>
<body>
    <div class="back-link-container">
        ${BackLinkComponent.generateHtml({ wrap: false })}
        <button class="fullscreen-btn" id="fullscreenBtn" onclick="toggleFullscreen()" title="Open course in new editor tab">
            ⛶
        </button>
    </div>
    
    <div class="course-header">
        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
        <div class="course-header-content">
            <div class="course-title">${courseTitle}</div>
            <div class="course-semester">${semester}</div>
            <div class="course-description">${courseDescription}</div>
            <div class="course-stats">
                <div class="stat-item">${exerciseCount} exercises</div>
                <div class="stat-item">${studentCount} students</div>
                <div class="stat-item">${instructorGroup}</div>
                <div class="stat-item">ID: ${course?.id || 'Unknown'}</div>
            </div>
        </div>
    </div>
    
    ${AskIrisComponent.generate({
            id: 'ask-iris-course',
            className: 'section',
            title: 'Ask Iris about this course',
            description: 'Open the Iris chat to discuss this course or its exercises.',
            buttonId: 'askIrisAboutCourseBtn'
        })}

    <div class="section collapsible-section" id="exams-section">
        <div class="section-title collapsible-header" onclick="toggleSection('exams-section')">
            <div class="header-left">
                <span>Exams</span>
                <span class="exam-count-badge">${examCount}</span>
            </div>
            <span class="collapse-icon"></span>
        </div>
        <div class="collapsible-content">
            <div class="exam-list">
                ${examsHtml}
            </div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">Exercises</div>
        <div class="exercise-search">
            <div class="search-input-wrapper">
                ${TextInputComponent.generate({
            id: 'exerciseSearch',
            type: 'search',
            placeholder: 'Search exercises...',
            size: 'medium',
            className: 'search-input',
            height: '2rem'
        })}
            </div>
            ${DropdownComponent.generate({
            id: 'exerciseSort',
            size: 'medium',
            onChange: 'sortExercises(this.value)',
            height: '2rem',
            options: [
                { value: 'id-desc', label: 'Latest Added', selected: true },
                { value: 'id-asc', label: 'Oldest Added' },
                { value: 'title-asc', label: 'Title (A-Z)' },
                { value: 'title-desc', label: 'Title (Z-A)' },
                { value: 'due-asc', label: 'Due Date (Earliest)' },
                { value: 'due-desc', label: 'Due Date (Latest)' },
                { value: 'points-asc', label: 'Points (Low-High)' },
                { value: 'points-desc', label: 'Points (High-Low)' }
            ]
        })}
        </div>
        <div class="exercises-container">
            <div class="exercises-list">
                ${exercisesHtml}
                <div class="no-exercises-found">No exercises found matching your search.</div>
            </div>
        </div>
    </div>
    
    ${!hideDeveloperTools ? `
    <div class="action-buttons">
        ${ButtonComponent.generate({
            label: 'Open Raw JSON',
            variant: 'secondary',
            command: 'openInEditor()'
        })}
        ${ButtonComponent.generate({
            label: 'Copy Course Data',
            variant: 'secondary',
            command: 'copyToClipboard()'
        })}
    </div>
    ` : ''}

    <script>
        const vscode = acquireVsCodeApi();
        const courseData = ${JSON.stringify(courseData)};
        const askIrisButton = document.getElementById('askIrisAboutCourseBtn');
        
        ${BackLinkComponent.generateScript()}
        
        // Enable keyboard navigation for list items
        ${ListItemComponent.generateScript()}
        
        window.toggleSection = function(sectionId) {
            const section = document.getElementById(sectionId);
            if (section) {
                section.classList.toggle('collapsed');
            }
        }

        if (askIrisButton) {
            askIrisButton.addEventListener('click', () => {
                const course = (courseData && (courseData.course || courseData)) || {};
                if (!course.id) {
                    vscode.postMessage({ command: 'alert', text: 'Course information is unavailable for Iris.' });
                    return;
                }
                
                vscode.postMessage({
                    command: 'askIrisAboutCourse',
                    courseId: course.id,
                    courseTitle: course.title || 'Course',
                    courseShortName: course.shortName || ''
                });
            });
        }
        
        window.filterExercises = function(searchTerm) {
            const exercises = document.querySelectorAll('.exercise-item');
            const noExercisesFound = document.querySelector('.no-exercises-found');
            const term = searchTerm.toLowerCase();
            let visibleCount = 0;
            
            exercises.forEach(exercise => {
                const title = exercise.getAttribute('data-title') || '';
                const type = exercise.getAttribute('data-type') || '';
                
                if (title.includes(term) || type.includes(term)) {
                    exercise.style.display = '';
                    visibleCount++;
                } else {
                    exercise.style.display = 'none';
                }
            });
            
            // Show/hide "no exercises found" message
            if (visibleCount === 0 && exercises.length > 0 && term.trim() !== '') {
                noExercisesFound.style.display = 'block';
            } else {
                noExercisesFound.style.display = 'none';
            }
        };
        
        window.sortExercises = function(sortBy) {
            const exercisesList = document.querySelector('.exercises-list');
            const exercises = Array.from(document.querySelectorAll('.exercise-item'));
            const noExercisesFound = document.querySelector('.no-exercises-found');
            
            // Remove all exercises from the list
            exercises.forEach(exercise => exercise.remove());
            
            // Sort exercises based on the selected option
            let sortedExercises = [...exercises];
            
            switch(sortBy) {
                case 'id-asc':
                    sortedExercises.sort((a, b) => {
                        const idA = parseInt(a.getAttribute('data-id') || '0');
                        const idB = parseInt(b.getAttribute('data-id') || '0');
                        return idA - idB;
                    });
                    break;
                case 'id-desc':
                    sortedExercises.sort((a, b) => {
                        const idA = parseInt(a.getAttribute('data-id') || '0');
                        const idB = parseInt(b.getAttribute('data-id') || '0');
                        return idB - idA;
                    });
                    break;
                case 'title-asc':
                    sortedExercises.sort((a, b) => {
                        const titleA = a.getAttribute('data-title') || '';
                        const titleB = b.getAttribute('data-title') || '';
                        return titleA.localeCompare(titleB);
                    });
                    break;
                case 'title-desc':
                    sortedExercises.sort((a, b) => {
                        const titleA = a.getAttribute('data-title') || '';
                        const titleB = b.getAttribute('data-title') || '';
                        return titleB.localeCompare(titleA);
                    });
                    break;
                case 'due-asc':
                    sortedExercises.sort((a, b) => {
                        const dateA = parseInt(a.getAttribute('data-due-date') || '0');
                        const dateB = parseInt(b.getAttribute('data-due-date') || '0');
                        // Put exercises with no due date at the end
                        if (dateA === 0) return 1;
                        if (dateB === 0) return -1;
                        return dateA - dateB;
                    });
                    break;
                case 'due-desc':
                    sortedExercises.sort((a, b) => {
                        const dateA = parseInt(a.getAttribute('data-due-date') || '0');
                        const dateB = parseInt(b.getAttribute('data-due-date') || '0');
                        // Put exercises with no due date at the end
                        if (dateA === 0) return 1;
                        if (dateB === 0) return -1;
                        return dateB - dateA;
                    });
                    break;
                case 'points-asc':
                    sortedExercises.sort((a, b) => {
                        const pointsA = parseInt(a.getAttribute('data-points') || '0');
                        const pointsB = parseInt(b.getAttribute('data-points') || '0');
                        return pointsA - pointsB;
                    });
                    break;
                case 'points-desc':
                    sortedExercises.sort((a, b) => {
                        const pointsA = parseInt(a.getAttribute('data-points') || '0');
                        const pointsB = parseInt(b.getAttribute('data-points') || '0');
                        return pointsB - pointsA;
                    });
                    break;
            }
            
            // Re-add exercises in the sorted order
            sortedExercises.forEach(exercise => {
                exercisesList.insertBefore(exercise, noExercisesFound);
            });
        };
        
        // Sort by latest added on initial load
        if (document.querySelectorAll('.exercise-item').length > 0) {
            sortExercises('id-desc');
        }
        
        window.openExerciseDetails = function(exerciseId) {
            vscode.postMessage({ 
                command: 'openExerciseDetails',
                exerciseId: exerciseId
            });
        };

        window.openExam = function(examId) {
            const course = (courseData && (courseData.course || courseData)) || {};
            console.log('[EXAMMODE] Requesting to open exam:', examId, 'for course:', course.id);
            vscode.postMessage({ 
                command: 'openExam',
                examId: examId,
                courseId: course.id
            });
        };
        
        window.openInEditor = function() {
            vscode.postMessage({ 
                command: 'openInEditor',
                data: courseData
            });
        };
        
        window.copyToClipboard = function() {
            vscode.postMessage({ 
                command: 'copyToClipboard',
                text: JSON.stringify(courseData, null, 2)
            });
        };

        window.toggleFullscreen = function() {
            vscode.postMessage({ 
                command: 'toggleCourseFullscreen'
            });
        };
        
        // Connect search input to filter function
        const searchInput = document.getElementById('exerciseSearch');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                filterExercises(e.target.value);
            });
        }
    </script>
</body>
</html>`;
    }
}
