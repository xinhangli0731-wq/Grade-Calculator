import { Course, GradeComponent, SubAssignmentItem } from '../types/course';

export type RequirementFeasibility = 'achievable' | 'impossible' | 'secured';

export interface GradeRequirementRow {
  letter: string;
  cutoff: number;
  requiredPercentage: number;
  feasibility: RequirementFeasibility;
  statusMessage: string;
  droppedComponentNames: string[];
  perAssessmentBreakdown: Array<{
    id: string;
    name: string;
    weight: number;
    effectiveWeight: number;
    maxPoints: number;
    requiredPoints: number;
    requiredPercentage: number;
    isDroppedAtTarget?: boolean;
  }>;
}

export interface BeforeSemesterCalculation {
  assumedNonExamComponents: Array<{
    id: string;
    name: string;
    weight: number;
    assumedPercentage: number;
    weightedContribution: number;
  }>;
  examComponents: GradeComponent[];
  totalAssumedWeight: number;
  totalExamWeight: number;
  effectiveWeightById: Record<string, number>;
  examDropCount: number;
  countedExamCount: number;
  totalDroppableExamCount: number;
  lockedPointsFromAssumed: number;
  requirementsByGrade: GradeRequirementRow[];
}

export interface InProgressCalculation {
  hasCompletedAssessments: boolean;
  currentGradePercentage: number | null;
  currentLetterGrade: string | null;
  hasWhatIf: boolean;
  projectedGradePercentage: number | null;
  projectedLetterGrade: string | null;
  isAllCompleted: boolean;
  nextGradeUp: {
    letter: string;
    cutoff: number;
    pointsAway: number;
  } | null;
  completedWeight: number;
  completedWeightedPoints: number;
  effectiveWeightById: Record<string, number>;
  currentlyDroppedIds: string[];
  currentlyDroppedNames: string[];
  examDropCount: number;
  countedExamCount: number;
  totalDroppableExamCount: number;
  openAssessments: GradeComponent[];
  openWeight: number;
  totalLockedPoints: number;
  requirementsByGrade: GradeRequirementRow[];
}

export interface SubItemsCalculation {
  totalCount: number;
  dropLowestCount: number;
  countedCount: number;
  completedCount: number;
  remainingCount: number;
  currentAverage: number | null;
  maxPossibleAverage: number;
  targetAverage: number;
  requiredOnRemainingForTarget: number | null;
  targetFeasibility: RequirementFeasibility;
  droppedSubIds: string[];
}

export function parseScoreStringToPercentage(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, '');
  if (!trimmed) return null;
  if (trimmed.includes('/')) {
    const [numStr, denStr] = trimmed.split('/');
    const earned = parseFloat(numStr);
    const max = parseFloat(denStr);
    if (Number.isFinite(earned) && Number.isFinite(max) && max > 0) {
      return (earned / max) * 100;
    }
    return null;
  }
  const val = parseFloat(trimmed);
  return Number.isFinite(val) ? val : null;
}

/**
 * Calculates metrics for individual Homework/Coursework sub-items, including "Drop Lowest D Homeworks"
 */
export function calculateSubItemsMetrics(
  subItems: SubAssignmentItem[],
  targetAvg = 95,
  dropLowestCount = 0
): SubItemsCalculation {
  const totalCount = subItems.length;
  const safeDrop = Math.max(0, Math.min(totalCount - 1, dropLowestCount || 0));
  const countedCount = Math.max(1, totalCount - safeDrop);

  const completedItems = subItems.filter(
    (item): item is SubAssignmentItem & { percentage: number } =>
      item.percentage !== null && Number.isFinite(item.percentage)
  );
  const completedCount = completedItems.length;
  const remainingCount = Math.max(0, totalCount - completedCount);

  // Determine which completed sub-items are currently dropped if completedCount > countedCount
  // (or if all items are evaluated)
  const sortedCompletedAsc = [...completedItems].sort(
    (a, b) => a.percentage - b.percentage
  );
  const currentDropsToApply =
    completedCount > countedCount ? completedCount - countedCount : 0;
  const droppedSubIds = sortedCompletedAsc
    .slice(0, currentDropsToApply)
    .map((item) => item.id);
  const keptCompleted = sortedCompletedAsc.slice(currentDropsToApply);

  const currentAverage =
    keptCompleted.length > 0
      ? keptCompleted.reduce((s, item) => s + item.percentage, 0) /
        keptCompleted.length
      : null;

  // Helper: evaluate final category average if all remaining items score X%
  const evaluateCategoryAvgAtX = (x: number): number => {
    if (totalCount === 0) return 100;
    const allScores = [
      ...completedItems.map((i) => i.percentage),
      ...Array.from({ length: remainingCount }, () => x),
    ].sort((a, b) => b - a); // Descending
    const topK = allScores.slice(0, countedCount);
    return topK.reduce((s, v) => s + v, 0) / countedCount;
  };

  const maxPossibleAverage = evaluateCategoryAvgAtX(100);
  const minPossibleAverage = evaluateCategoryAvgAtX(0);

  let requiredOnRemainingForTarget: number | null = null;
  let targetFeasibility: RequirementFeasibility = 'achievable';

  if (remainingCount === 0) {
    targetFeasibility =
      (currentAverage ?? 0) + 1e-9 >= targetAvg ? 'secured' : 'impossible';
  } else if (minPossibleAverage + 1e-9 >= targetAvg) {
    requiredOnRemainingForTarget = 0;
    targetFeasibility = 'secured';
  } else {
    // Solve piecewise-linear monotonic function evaluateCategoryAvgAtX(x) = targetAvg
    // Since it's strictly linear above the lowest dropped scores, we can solve via binary search on [-100, 300]
    let lo = 0;
    let hi = 250;
    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      if (evaluateCategoryAvgAtX(mid) >= targetAvg) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    requiredOnRemainingForTarget = (lo + hi) / 2;
    if (requiredOnRemainingForTarget > 100 + 1e-5) {
      targetFeasibility = 'impossible';
    } else if (requiredOnRemainingForTarget <= 1e-5) {
      targetFeasibility = 'secured';
      requiredOnRemainingForTarget = 0;
    } else {
      targetFeasibility = 'achievable';
    }
  }

  return {
    totalCount,
    dropLowestCount: safeDrop,
    countedCount,
    completedCount,
    remainingCount,
    currentAverage,
    maxPossibleAverage,
    targetAverage: targetAvg,
    requiredOnRemainingForTarget,
    targetFeasibility,
    droppedSubIds,
  };
}

export function getComponentActualPercentage(comp: GradeComponent): number | null {
  if (comp.status !== 'completed' || comp.earnedPoints === null) {
    return null;
  }
  const max = comp.maxPoints > 0 ? comp.maxPoints : 100;
  return (comp.earnedPoints / max) * 100;
}

export function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(decimals))}%`;
}

export function formatScoreNumber(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(decimals))}`;
}

export function getLetterGradeForPercentage(
  percentage: number | null,
  course: Course
): string | null {
  if (percentage === null || !Number.isFinite(percentage)) return null;
  const validCutoffs = course.gradeScale
    .filter((g): g is { letter: string; minPercentage: number } => g.minPercentage !== null)
    .sort((a, b) => b.minPercentage - a.minPercentage);

  if (validCutoffs.length === 0) return null;

  for (const cutoff of validCutoffs) {
    if (percentage + 1e-9 >= cutoff.minPercentage) {
      return cutoff.letter;
    }
  }

  // Standard academic fallback letters if syllabus scale only listed down to B- or C-
  const minListed = validCutoffs[validCutoffs.length - 1].minPercentage;
  const standardLower: Array<{ letter: string; min: number }> = [
    { letter: 'C+', min: 77 },
    { letter: 'C', min: 73 },
    { letter: 'C-', min: 70 },
    { letter: 'D+', min: 67 },
    { letter: 'D', min: 60 },
  ];
  for (const fb of standardLower) {
    if (fb.min < minListed && percentage + 1e-9 >= fb.min) {
      return fb.letter;
    }
  }
  return 'F';
}

function getArticleForLetter(letter: string): string {
  const first = letter.trim().toUpperCase()[0];
  return first === 'A' || first === 'F' ? 'an' : 'a';
}

/**
 * Computes the effective weight of each counted component when examDropCount > 0.
 * Example (STAT 400):
 * - Homework = 10% (non-droppable)
 * - Midterm 1, Midterm 2, Midterm 3, Final Exam (4 droppable exams, examDropCount = 1 -> K = 3 counted exams)
 * - Remaining weight for the 3 counted exams = 100% - 10% = 90%, so each counted exam has effectiveWeight = 30%!
 */
export function getCoursePoolConfiguration(course: Course) {
  const rawDropCount = Math.max(0, course.examDropCount || 0);
  const droppableExams = course.components.filter(
    (c) => c.categoryType === 'exam' && c.canBeDropped !== false
  );

  const effectiveDropCount =
    rawDropCount > 0 && droppableExams.length > rawDropCount ? rawDropCount : 0;

  const nonDroppableComponents =
    effectiveDropCount > 0
      ? course.components.filter(
          (c) => !(c.categoryType === 'exam' && c.canBeDropped !== false)
        )
      : course.components;

  const activeDroppableExams = effectiveDropCount > 0 ? droppableExams : [];
  const countedExamCount = Math.max(
    0,
    activeDroppableExams.length - effectiveDropCount
  );

  const nonDroppableWeightSum = nonDroppableComponents.reduce(
    (s, c) => s + (Number(c.weight) || 0),
    0
  );

  // Calculate total weight shared by the K counted exams in the drop pool
  let poolTotalWeight = 0;
  if (effectiveDropCount > 0 && countedExamCount > 0) {
    const remainderTo100 = 100 - nonDroppableWeightSum;
    if (remainderTo100 > 0 && remainderTo100 <= 100) {
      poolTotalWeight = remainderTo100;
    } else {
      const avgListedWeight =
        activeDroppableExams.reduce((s, c) => s + c.weight, 0) /
        activeDroppableExams.length;
      poolTotalWeight = avgListedWeight * countedExamCount;
    }
  }

  const effectiveWeightPerCountedPoolExam =
    countedExamCount > 0 ? poolTotalWeight / countedExamCount : 0;

  const effectiveWeightById: Record<string, number> = {};
  for (const c of course.components) {
    if (
      effectiveDropCount > 0 &&
      c.categoryType === 'exam' &&
      c.canBeDropped !== false
    ) {
      effectiveWeightById[c.id] = Number(
        effectiveWeightPerCountedPoolExam.toFixed(2)
      );
    } else {
      effectiveWeightById[c.id] = c.weight;
    }
  }

  return {
    effectiveDropCount,
    activeDroppableExams,
    nonDroppableComponents,
    countedExamCount,
    totalDroppableExamCount: activeDroppableExams.length,
    poolTotalWeight,
    effectiveWeightPerCountedPoolExam,
    effectiveWeightById,
  };
}

/**
 * Mode 1: Before the Semester / No Grades Yet
 */
export function calculateBeforeSemesterRequirements(
  course: Course
): BeforeSemesterCalculation {
  const poolConfig = getCoursePoolConfiguration(course);

  const nonExamComponents = course.components.filter(
    (c) => c.categoryType === 'non-exam'
  );
  const examComponents = course.components.filter(
    (c) => c.categoryType === 'exam'
  );

  const effectiveNonExams = examComponents.length > 0 ? nonExamComponents : [];
  const effectiveExams =
    examComponents.length > 0 ? examComponents : course.components;

  const assumedNonExamComponents = effectiveNonExams.map((c) => {
    const assumedPct = Number.isFinite(c.assumedPercentage)
      ? c.assumedPercentage
      : 100;
    const weightedContribution = (assumedPct / 100) * c.weight;
    return {
      id: c.id,
      name: c.name,
      weight: c.weight,
      assumedPercentage: assumedPct,
      weightedContribution,
    };
  });

  const totalAssumedWeight = assumedNonExamComponents.reduce(
    (sum, c) => sum + c.weight,
    0
  );
  const lockedPointsFromAssumed = assumedNonExamComponents.reduce(
    (sum, c) => sum + c.weightedContribution,
    0
  );

  // Total effective exam weight (only counting K of N if examDropCount > 0)
  const mandatoryExamWeight = effectiveExams
    .filter((e) => !poolConfig.activeDroppableExams.some((d) => d.id === e.id))
    .reduce((sum, e) => sum + e.weight, 0);

  const totalExamWeight =
    poolConfig.effectiveDropCount > 0
      ? mandatoryExamWeight + poolConfig.poolTotalWeight
      : effectiveExams.reduce((sum, c) => sum + c.weight, 0);

  const validCutoffs = course.gradeScale
    .filter(
      (g): g is { letter: string; minPercentage: number } =>
        g.minPercentage !== null
    )
    .sort((a, b) => b.minPercentage - a.minPercentage);

  const requirementsByGrade: GradeRequirementRow[] = validCutoffs.map((g) => {
    const neededWeightedPoints = g.minPercentage - lockedPointsFromAssumed;
    const requiredPercentage =
      totalExamWeight > 0 ? (neededWeightedPoints / totalExamWeight) * 100 : 0;

    const article = getArticleForLetter(g.letter);
    let feasibility: RequirementFeasibility = 'achievable';
    let statusMessage = `You need approximately ${formatPct(
      requiredPercentage
    )} average on counted exams`;

    if (requiredPercentage > 100) {
      feasibility = 'impossible';
      statusMessage = `${g.letter} is no longer mathematically possible.`;
    } else if (requiredPercentage <= 0) {
      feasibility = 'secured';
      statusMessage = `You have already secured ${article} ${g.letter}.`;
    }

    const clampedDisplayPct = Math.max(0, requiredPercentage);

    const perAssessmentBreakdown = effectiveExams.map((exam) => {
      const maxPts = exam.maxPoints > 0 ? exam.maxPoints : 100;
      const reqPoints = (clampedDisplayPct / 100) * maxPts;
      return {
        id: exam.id,
        name: exam.name,
        weight: exam.weight,
        effectiveWeight: poolConfig.effectiveWeightById[exam.id] ?? exam.weight,
        maxPoints: maxPts,
        requiredPoints: reqPoints,
        requiredPercentage,
      };
    });

    return {
      letter: g.letter,
      cutoff: g.minPercentage,
      requiredPercentage,
      feasibility,
      statusMessage,
      droppedComponentNames: [],
      perAssessmentBreakdown,
    };
  });

  return {
    assumedNonExamComponents,
    examComponents: effectiveExams,
    totalAssumedWeight,
    totalExamWeight,
    effectiveWeightById: poolConfig.effectiveWeightById,
    examDropCount: poolConfig.effectiveDropCount,
    countedExamCount: poolConfig.countedExamCount,
    totalDroppableExamCount: poolConfig.totalDroppableExamCount,
    lockedPointsFromAssumed,
    requirementsByGrade,
  };
}

/**
 * Mode 2: Semester In Progress & What-If Simulator (with Best-K-of-N Drop Policy Solver)
 */
export function calculateInProgressMetrics(course: Course): InProgressCalculation {
  const poolConfig = getCoursePoolConfiguration(course);
  const {
    effectiveDropCount,
    activeDroppableExams,
    countedExamCount,
    effectiveWeightPerCountedPoolExam,
    effectiveWeightById,
  } = poolConfig;

  const isDroppablePoolExam = (comp: GradeComponent) =>
    effectiveDropCount > 0 &&
    activeDroppableExams.some((d) => d.id === comp.id);

  // Helper to get a component's locked percentage if completed or What-If or assumed non-exam
  const getLockedPct = (comp: GradeComponent): number | null => {
    if (comp.status === 'completed' && comp.earnedPoints !== null) {
      return getComponentActualPercentage(comp) ?? 0;
    }
    if (comp.whatIfPercentage !== null && Number.isFinite(comp.whatIfPercentage)) {
      return comp.whatIfPercentage;
    }
    if (
      course.assumeNonExamFullCreditInProgress &&
      comp.categoryType === 'non-exam'
    ) {
      return Number.isFinite(comp.assumedPercentage)
        ? comp.assumedPercentage
        : 100;
    }
    return null;
  };

  // 1. Calculate Current Grade from COMPLETED assessments only
  let completedWeight = 0;
  let completedWeightedPoints = 0;
  const currentlyDroppedIds: string[] = [];
  const currentlyDroppedNames: string[] = [];

  const completedNonPool = course.components.filter(
    (c) => !isDroppablePoolExam(c) && c.status === 'completed' && c.earnedPoints !== null
  );
  for (const c of completedNonPool) {
    const pct = getComponentActualPercentage(c) ?? 0;
    completedWeight += c.weight;
    completedWeightedPoints += (pct / 100) * c.weight;
  }

  const completedPoolExams = activeDroppableExams
    .filter((c) => c.status === 'completed' && c.earnedPoints !== null)
    .map((c) => ({
      comp: c,
      pct: getComponentActualPercentage(c) ?? 0,
    }))
    .sort((a, b) => a.pct - b.pct); // Ascending (lowest first)

  if (completedPoolExams.length > 0) {
    const numToDropNow =
      completedPoolExams.length > countedExamCount
        ? completedPoolExams.length - countedExamCount
        : 0;
    const droppedNow = completedPoolExams.slice(0, numToDropNow);
    const keptNow = completedPoolExams.slice(numToDropNow);

    for (const d of droppedNow) {
      currentlyDroppedIds.push(d.comp.id);
      currentlyDroppedNames.push(d.comp.name);
    }
    for (const k of keptNow) {
      completedWeight += effectiveWeightPerCountedPoolExam;
      completedWeightedPoints +=
        (k.pct / 100) * effectiveWeightPerCountedPoolExam;
    }
  }

  const hasCompletedAssessments = completedWeight > 0;
  const currentGradePercentage = hasCompletedAssessments
    ? (completedWeightedPoints / completedWeight) * 100
    : null;
  const currentLetterGrade = getLetterGradeForPercentage(
    currentGradePercentage,
    course
  );

  // 1b. Calculate Projected Grade (Completed + What-If scores)
  const hasWhatIf = course.components.some(
    (c) =>
      c.status === 'remaining' &&
      c.whatIfPercentage !== null &&
      Number.isFinite(c.whatIfPercentage)
  );

  let projectedWeight = 0;
  let projectedWeightedPoints = 0;

  const getActualOrWhatIfPct = (c: GradeComponent): number | null => {
    if (c.status === 'completed' && c.earnedPoints !== null) {
      return getComponentActualPercentage(c) ?? 0;
    }
    if (c.whatIfPercentage !== null && Number.isFinite(c.whatIfPercentage)) {
      return c.whatIfPercentage;
    }
    return null;
  };

  for (const c of course.components) {
    if (!isDroppablePoolExam(c)) {
      const pct = getActualOrWhatIfPct(c);
      if (pct !== null) {
        projectedWeight += c.weight;
        projectedWeightedPoints += (pct / 100) * c.weight;
      }
    }
  }

  const projectedPoolExams = activeDroppableExams
    .map((c) => ({ comp: c, pct: getActualOrWhatIfPct(c) }))
    .filter((item): item is { comp: GradeComponent; pct: number } => item.pct !== null)
    .sort((a, b) => a.pct - b.pct);

  if (projectedPoolExams.length > 0) {
    const numDropProj =
      projectedPoolExams.length > countedExamCount
        ? projectedPoolExams.length - countedExamCount
        : 0;
    const keptProj = projectedPoolExams.slice(numDropProj);
    for (const k of keptProj) {
      projectedWeight += effectiveWeightPerCountedPoolExam;
      projectedWeightedPoints +=
        (k.pct / 100) * effectiveWeightPerCountedPoolExam;
    }
  }

  const projectedGradePercentage =
    projectedWeight > 0
      ? (projectedWeightedPoints / projectedWeight) * 100
      : null;
  const projectedLetterGrade = getLetterGradeForPercentage(
    projectedGradePercentage,
    course
  );

  // Check if all required counted weight is completed (or projected via What-If)
  const isAllCompleted = completedWeight >= 99.5;

  // 2. Partition all components into Locked vs Open (Remaining) for Target Grade Solver
  let lockedNonPoolPoints = 0;
  let openNonPoolWeight = 0;
  const openAssessments: GradeComponent[] = [];

  for (const comp of course.components) {
    const lockedPct = getLockedPct(comp);
    if (isDroppablePoolExam(comp)) {
      if (lockedPct === null) {
        openAssessments.push(comp);
      }
    } else {
      if (lockedPct !== null) {
        lockedNonPoolPoints += (lockedPct / 100) * comp.weight;
      } else {
        openNonPoolWeight += comp.weight;
        openAssessments.push(comp);
      }
    }
  }

  const lockedPoolItems = activeDroppableExams
    .map((c) => ({ comp: c, pct: getLockedPct(c) }))
    .filter((item): item is { comp: GradeComponent; pct: number } => item.pct !== null);

  const openPoolItems = activeDroppableExams.filter(
    (c) => getLockedPct(c) === null
  );

  // Function to evaluate total course percentage if all open assessments score X%
  const evaluateCourseGradeAtX = (x: number) => {
    let total = lockedNonPoolPoints + (x / 100) * openNonPoolWeight;

    if (effectiveDropCount > 0 && countedExamCount > 0) {
      const candidatePool = [
        ...lockedPoolItems.map((item) => ({
          id: item.comp.id,
          name: item.comp.name,
          pct: item.pct,
          isOpen: false,
        })),
        ...openPoolItems.map((comp) => ({
          id: comp.id,
          name: comp.name,
          pct: x,
          isOpen: true,
        })),
      ].sort((a, b) => b.pct - a.pct); // Descending (highest K kept)

      const kept = candidatePool.slice(0, countedExamCount);
      const dropped = candidatePool.slice(countedExamCount);

      for (const k of kept) {
        total += (k.pct / 100) * effectiveWeightPerCountedPoolExam;
      }

      return {
        total,
        droppedNames: dropped.map((d) => d.name),
        droppedIds: new Set(dropped.map((d) => d.id)),
      };
    }

    return {
      total,
      droppedNames: [] as string[],
      droppedIds: new Set<string>(),
    };
  };

  const baselineAtZero = evaluateCourseGradeAtX(0);
  const totalLockedPoints = baselineAtZero.total;
  const openWeight =
    openNonPoolWeight +
    Math.min(countedExamCount, openPoolItems.length) *
      effectiveWeightPerCountedPoolExam;

  const validCutoffs = course.gradeScale
    .filter(
      (g): g is { letter: string; minPercentage: number } =>
        g.minPercentage !== null
    )
    .sort((a, b) => b.minPercentage - a.minPercentage);

  // Determine next grade up from active percentage
  const activePctForNext = hasWhatIf
    ? projectedGradePercentage
    : currentGradePercentage;
  let nextGradeUp: {
    letter: string;
    cutoff: number;
    pointsAway: number;
  } | null = null;

  if (activePctForNext !== null && Number.isFinite(activePctForNext)) {
    const higherCutoffs = [...validCutoffs]
      .filter((g) => g.minPercentage > activePctForNext + 1e-7)
      .sort((a, b) => a.minPercentage - b.minPercentage);
    if (higherCutoffs.length > 0) {
      const closestHigher = higherCutoffs[0];
      nextGradeUp = {
        letter: closestHigher.letter,
        cutoff: closestHigher.minPercentage,
        pointsAway: Number(
          (closestHigher.minPercentage - activePctForNext).toFixed(2)
        ),
      };
    }
  }

  const requirementsByGrade: GradeRequirementRow[] = validCutoffs.map((g) => {
    const cutoff = g.minPercentage;
    const article = getArticleForLetter(g.letter);

    // Check if even 0% on all remaining assessments achieves the cutoff!
    if (baselineAtZero.total + 1e-7 >= cutoff) {
      const perAssessmentBreakdown = openAssessments.map((exam) => ({
        id: exam.id,
        name: exam.name,
        weight: exam.weight,
        effectiveWeight: effectiveWeightById[exam.id] ?? exam.weight,
        maxPoints: exam.maxPoints > 0 ? exam.maxPoints : 100,
        requiredPoints: 0,
        requiredPercentage: 0,
        isDroppedAtTarget: baselineAtZero.droppedIds.has(exam.id),
      }));

      return {
        letter: g.letter,
        cutoff,
        requiredPercentage: 0,
        feasibility: 'secured',
        statusMessage: `You have already secured ${article} ${g.letter}.`,
        droppedComponentNames: baselineAtZero.droppedNames,
        perAssessmentBreakdown,
      };
    }

    // If no open assessments remain and baselineAtZero < cutoff, it's impossible
    if (openAssessments.length === 0) {
      return {
        letter: g.letter,
        cutoff,
        requiredPercentage: 999,
        feasibility: 'impossible',
        statusMessage: `${g.letter} is no longer mathematically possible.`,
        droppedComponentNames: baselineAtZero.droppedNames,
        perAssessmentBreakdown: [],
      };
    }

    // Solve monotonic piecewise-linear equation evaluateCourseGradeAtX(x).total = cutoff
    let lo = 0;
    let hi = 300;
    for (let iter = 0; iter < 60; iter++) {
      const mid = (lo + hi) / 2;
      if (evaluateCourseGradeAtX(mid).total >= cutoff) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    const solvedX = (lo + hi) / 2;
    const evalAtSolved = evaluateCourseGradeAtX(solvedX);

    let feasibility: RequirementFeasibility = 'achievable';
    let statusMessage = '';

    if (solvedX > 100 + 1e-5) {
      feasibility = 'impossible';
      statusMessage = `${g.letter} is no longer mathematically possible.`;
    } else {
      feasibility = 'achievable';
      if (openAssessments.length === 1) {
        statusMessage = `You need ${formatPct(solvedX)} on ${
          openAssessments[0].name
        } to earn ${article} ${g.letter}.`;
      } else {
        statusMessage = `You need ${formatPct(
          solvedX
        )} on remaining exams to earn ${article} ${g.letter}.`;
      }
    }

    const clampedDisplayPct = Math.max(0, solvedX);
    const perAssessmentBreakdown = openAssessments.map((exam) => {
      const maxPts = exam.maxPoints > 0 ? exam.maxPoints : 100;
      const isDroppedHere = evalAtSolved.droppedIds.has(exam.id);
      const reqPct = isDroppedHere ? 0 : solvedX;
      const reqPoints = isDroppedHere ? 0 : (clampedDisplayPct / 100) * maxPts;

      return {
        id: exam.id,
        name: exam.name,
        weight: exam.weight,
        effectiveWeight: effectiveWeightById[exam.id] ?? exam.weight,
        maxPoints: maxPts,
        requiredPoints: reqPoints,
        requiredPercentage: reqPct,
        isDroppedAtTarget: isDroppedHere,
      };
    });

    return {
      letter: g.letter,
      cutoff,
      requiredPercentage: solvedX,
      feasibility,
      statusMessage,
      droppedComponentNames: evalAtSolved.droppedNames,
      perAssessmentBreakdown,
    };
  });

  return {
    hasCompletedAssessments,
    currentGradePercentage,
    currentLetterGrade,
    hasWhatIf,
    projectedGradePercentage,
    projectedLetterGrade,
    isAllCompleted,
    nextGradeUp,
    completedWeight: Number(completedWeight.toFixed(2)),
    completedWeightedPoints,
    effectiveWeightById,
    currentlyDroppedIds,
    currentlyDroppedNames,
    examDropCount: effectiveDropCount,
    countedExamCount,
    totalDroppableExamCount: activeDroppableExams.length,
    openAssessments,
    openWeight: Number(openWeight.toFixed(2)),
    totalLockedPoints,
    requirementsByGrade,
  };
}
