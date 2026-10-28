export type ComponentCategoryType = 'exam' | 'non-exam';

export type AssessmentStatus = 'completed' | 'remaining';

export interface SubAssignmentItem {
  id: string;
  name: string; // e.g., "HW 1", "HW 2"
  scoreText: string; // e.g., "95" or "18/20", empty "" if not graded yet
  percentage: number | null; // Calculated percentage (0-100+), null if not graded yet
}

export interface GradeComponent {
  id: string;
  name: string;
  weight: number; // e.g., 20 for 20%
  categoryType: ComponentCategoryType; // 'exam' or 'non-exam'
  status: AssessmentStatus; // 'completed' or 'remaining'
  earnedPoints: number | null;
  maxPoints: number;
  assumedPercentage: number;
  whatIfPercentage: number | null;
  notes?: string;
  /**
   * Whether this exam is part of the course's "Drop Lowest Exam" pool
   * (e.g., true for Midterms 1-3, and true for Final if Final can also be dropped)
   */
  canBeDropped?: boolean;
  /**
   * Individual homework/assignment tracker (for non-exam components like Homework)
   */
  subItems?: SubAssignmentItem[];
  subTargetPercentage?: number; // Target average for this category (e.g., 95%)
  subDropLowestCount?: number; // Number of lowest homeworks dropped (e.g., 1 or 2)
}

export interface GradeCutoff {
  letter: string; // e.g. 'A+', 'A', 'A-', 'B+', 'B', 'B-'
  minPercentage: number | null;
}

export interface Course {
  id: string;
  courseCode: string; // e.g. 'STAT 400'
  courseTitle: string;
  targetGrade: string; // e.g. 'A'
  components: GradeComponent[];
  gradeScale: GradeCutoff[];
  gradeScaleFoundInSyllabus: boolean;
  /**
   * Number of lowest exams dropped from the droppable exam pool (0 = none, 1 = drop lowest 1 exam, etc.)
   */
  examDropCount?: number;
  policyNotes?: string;
  assumeNonExamFullCreditInProgress: boolean;
  createdAt: string;
}

export interface ParsedSyllabusResponse {
  courseCode: string;
  courseTitle: string;
  components: Array<{
    name: string;
    weight: number;
    categoryType: 'exam' | 'non-exam';
    maxPoints: number;
    canBeDropped?: boolean;
    totalSubItemsCount?: number;
    subDropLowestCount?: number;
    notes?: string;
  }>;
  examDropCount?: number;
  gradeScaleFound: boolean;
  gradeScale: Array<{
    letter: string;
    minPercentage: number;
  }>;
  policyNotes?: string;
}
