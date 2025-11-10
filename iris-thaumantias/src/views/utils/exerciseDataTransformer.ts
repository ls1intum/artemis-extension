/**
 * Exercise data with transformed/computed fields
 */
export interface TransformedExerciseData {
  // Basic exercise info
  exerciseTitle: string;
  exerciseType: string;
  maxPoints: number;
  bonusPoints: number;
  
  // Date info
  releaseDate: string;
  dueDateDisplay: string;
  timeRemainingDisplay: string;
  isDueSoon: boolean;
  
  // Configuration
  mode: string;
  includedInScore: string;
  filePattern: string;
  
  // Participation data
  hasParticipation: boolean;
  firstParticipation?: any;
  participationId?: number;
  latestSubmission?: any;
  latestResult?: any;
  
  // Exercise type flags
  isProgrammingExercise: boolean;
  isQuizExercise: boolean;
  
  // Score calculations
  scorePercentage?: number;
  scorePoints?: number;
  totalTests?: number;
  passedTests?: number;
  hasTestInfo?: boolean;
}

/**
 * Get latest submission by ID (matches Artemis frontend approach)
 * IDs are database auto-increment, guaranteed to be sequential with submission time
 */
export function getLatestSubmission(participation: any): any | undefined {
  if (
    !participation ||
    !Array.isArray(participation.submissions) ||
    participation.submissions.length === 0
  ) {
    return undefined;
  }

  return participation.submissions.reduce((latest: any, current: any) => {
    const latestId = typeof latest?.id === "number" ? latest.id : -Infinity;
    const currentId = typeof current?.id === "number" ? current.id : -Infinity;
    return currentId > latestId ? current : latest;
  });
}

/**
 * Get latest result by completionDate (matches Artemis frontend approach)
 * Results can complete out of order due to varying build times
 * Uses completionDate to ensure the most recently completed result is returned
 */
export function getLatestResult(submission: any): any | undefined {
  if (
    !submission ||
    !Array.isArray(submission.results) ||
    submission.results.length === 0
  ) {
    return undefined;
  }

  return submission.results.reduce((latest: any, current: any) => {
    const latestDate = latest?.completionDate
      ? new Date(latest.completionDate).getTime()
      : -Infinity;
    const currentDate = current?.completionDate
      ? new Date(current.completionDate).getTime()
      : -Infinity;

    // Fallback to ID if completionDates are equal or missing (rare edge case)
    if (latestDate === currentDate) {
      const latestId = typeof latest?.id === "number" ? latest.id : -Infinity;
      const currentId = typeof current?.id === "number" ? current.id : -Infinity;
      return currentId > latestId ? current : latest;
    }

    return currentDate > latestDate ? current : latest;
  });
}

/**
 * Calculate time remaining display and due soon status
 */
export function calculateDueDate(dueDate: string | null | undefined): {
  dueDateDisplay: string;
  timeRemainingDisplay: string;
  isDueSoon: boolean;
} {
  if (!dueDate) {
    return {
      dueDateDisplay: "No due date",
      timeRemainingDisplay: "",
      isDueSoon: false,
    };
  }

  const dueDateObj = new Date(dueDate);
  const now = new Date();
  const timeRemaining = dueDateObj.getTime() - now.getTime();
  const hoursRemaining = timeRemaining / (1000 * 60 * 60);
  const daysRemaining = Math.floor(hoursRemaining / 24);
  const remainingHours = Math.floor(hoursRemaining % 24);

  const dueDateDisplay = dueDateObj.toLocaleString();

  let timeRemainingDisplay = "";
  let isDueSoon = false;

  if (timeRemaining < 0) {
    timeRemainingDisplay = "Overdue";
    isDueSoon = true;
  } else if (hoursRemaining < 24) {
    timeRemainingDisplay = `Due in ${Math.floor(hoursRemaining)}h`;
    isDueSoon = true;
  } else if (daysRemaining < 7) {
    timeRemainingDisplay = `Due in ${daysRemaining}d ${remainingHours}h`;
  } else {
    timeRemainingDisplay = `Due in ${daysRemaining} days`;
  }

  return {
    dueDateDisplay,
    timeRemainingDisplay,
    isDueSoon,
  };
}

/**
 * Format score inclusion status for display
 */
export function formatScoreInclusion(includedInOverallScore: string): string {
  switch (includedInOverallScore) {
    case "NOT_INCLUDED":
      return "Not included in overall score";
    case "INCLUDED_COMPLETELY":
      return "Included in overall score";
    default:
      return "Partially included in score";
  }
}

/**
 * Format exercise mode for display
 */
export function formatExerciseMode(mode: string | undefined): string {
  return mode?.toLowerCase().replace("_", " ") || "Unknown";
}

/**
 * Format exercise type for display
 */
export function formatExerciseType(type: string | undefined): string {
  return (
    type
      ?.replace(/_/g, " ")
      .replace(/\b\w/g, (l: string) => l.toUpperCase()) || "Unknown"
  );
}

/**
 * Format file pattern for display
 */
export function formatFilePattern(filePattern: string | undefined): string {
  return filePattern
    ? filePattern
        .split(",")
        .map((ext: string) => ext.trim().toUpperCase())
        .join(", ")
    : "";
}

/**
 * Calculate score in points from percentage
 */
export function calculateScorePoints(
  scorePercentage: number,
  maxPoints: number
): number {
  return Math.round((scorePercentage / 100) * maxPoints * 100) / 100;
}

/**
 * Transform raw exercise data into a structured format with computed fields
 */
export function transformExerciseData(exercise: any): TransformedExerciseData {
  // Basic exercise info
  const exerciseTitle = exercise.title || "Unknown Exercise";
  const exerciseType = formatExerciseType(exercise.type);
  const maxPoints = exercise.maxPoints || 0;
  const bonusPoints = exercise.bonusPoints || 0;

  // Date calculations
  const releaseDate = exercise.releaseDate
    ? new Date(exercise.releaseDate).toLocaleString()
    : "No release date";
  const { dueDateDisplay, timeRemainingDisplay, isDueSoon } = calculateDueDate(
    exercise.dueDate
  );

  // Configuration
  const mode = formatExerciseMode(exercise.mode);
  const includedInScore = formatScoreInclusion(
    exercise.includedInOverallScore
  );
  const filePattern = formatFilePattern(exercise.filePattern);

  // Participation data
  const hasParticipation =
    Array.isArray(exercise.studentParticipations) &&
    exercise.studentParticipations.length > 0;
  const firstParticipation = hasParticipation
    ? exercise.studentParticipations[0]
    : undefined;
  const participationId = firstParticipation?.id;

  // Exercise type flags
  const rawExerciseType = exercise.type || exercise.exerciseType || "";
  const normalizedExerciseType =
    typeof rawExerciseType === "string" ? rawExerciseType.toLowerCase() : "";
  const isProgrammingExercise = normalizedExerciseType === "programming";
  const isQuizExercise = normalizedExerciseType === "quiz";

  // Get latest submission and result
  const latestSubmission = hasParticipation
    ? getLatestSubmission(firstParticipation)
    : undefined;
  const latestResult = latestSubmission
    ? getLatestResult(latestSubmission)
    : undefined;

  // Score calculations (for programming exercises)
  let scorePercentage: number | undefined;
  let scorePoints: number | undefined;
  let totalTests: number | undefined;
  let passedTests: number | undefined;
  let hasTestInfo: boolean | undefined;

  if (isProgrammingExercise && latestResult) {
    const score = latestResult.score || 0; // This is 0-100
    scorePercentage = score;
    scorePoints = calculateScorePoints(score, maxPoints);
    const tests = latestResult.testCaseCount || 0;
    totalTests = tests;
    passedTests = latestResult.passedTestCaseCount || 0;
    hasTestInfo = tests > 0;
  }

  return {
    exerciseTitle,
    exerciseType,
    maxPoints,
    bonusPoints,
    releaseDate,
    dueDateDisplay,
    timeRemainingDisplay,
    isDueSoon,
    mode,
    includedInScore,
    filePattern,
    hasParticipation,
    firstParticipation,
    participationId,
    latestSubmission,
    latestResult,
    isProgrammingExercise,
    isQuizExercise,
    scorePercentage,
    scorePoints,
    totalTests,
    passedTests,
    hasTestInfo,
  };
}
