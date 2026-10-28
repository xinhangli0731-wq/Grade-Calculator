import React, { useState } from 'react';
import {
  ArrowLeft,
  Settings2,
  Check,
  RotateCcw,
  Pencil,
  ListChecks,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  ShieldCheck,
} from 'lucide-react';
import { Course, GradeComponent, SubAssignmentItem } from '../types/course';
import {
  calculateBeforeSemesterRequirements,
  calculateInProgressMetrics,
  calculateSubItemsMetrics,
  formatPct,
  formatScoreNumber,
  getComponentActualPercentage,
  parseScoreStringToPercentage,
} from '../utils/gradeMath';

interface CourseDetailViewProps {
  course: Course;
  onBack: () => void;
  onUpdateCourse: (updated: Course) => void;
  onEditStructure: () => void;
}

function getInitialInputText(comp: GradeComponent): string {
  if (comp.status !== 'completed' || comp.earnedPoints === null) return '';
  if (comp.maxPoints !== 100) {
    return `${comp.earnedPoints}/${comp.maxPoints}`;
  }
  return `${Number(comp.earnedPoints.toFixed(1))}`;
}

function getShortPrefix(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('homework') || lower.includes('hw')) return 'HW';
  if (lower.includes('lab')) return 'Lab';
  return 'HW';
}

export const CourseDetailView: React.FC<CourseDetailViewProps> = ({
  course,
  onBack,
  onUpdateCourse,
  onEditStructure,
}) => {
  const inProgress = calculateInProgressMetrics(course);
  const beforeSemester = calculateBeforeSemesterRequirements(course);

  const [activeMode, setActiveMode] = useState<'in-progress' | 'before-semester'>(() =>
    inProgress.hasCompletedAssessments ? 'in-progress' : 'before-semester'
  );

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftCourseCode, setDraftCourseCode] = useState(course.courseCode);

  // Auto-open the first Homework component's sub-item tracker or toggle on click
  const [expandedSubId, setExpandedSubId] = useState<string | null>(() => {
    const firstNonExamWithSubs = course.components.find(
      (c) => c.categoryType === 'non-exam' && c.subItems && c.subItems.length > 0
    );
    return firstNonExamWithSubs ? firstNonExamWithSubs.id : null;
  });

  const [scoreTexts, setScoreTexts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const c of course.components) {
      map[c.id] = getInitialInputText(c);
    }
    return map;
  });

  const handleSaveCourseCode = () => {
    const cleaned = draftCourseCode.trim();
    if (cleaned) {
      onUpdateCourse({ ...course, courseCode: cleaned });
    } else {
      setDraftCourseCode(course.courseCode);
    }
    setIsEditingTitle(false);
  };

  const handleExamDropCountChange = (newDropCount: number) => {
    const updatedComponents = course.components.map((c) =>
      c.categoryType === 'exam' && c.canBeDropped === undefined
        ? { ...c, canBeDropped: true }
        : c
    );
    onUpdateCourse({
      ...course,
      examDropCount: newDropCount,
      components: updatedComponents,
    });
  };

  const handleToggleExamDroppable = (compId: string) => {
    const updated = course.components.map((c) =>
      c.id === compId ? { ...c, canBeDropped: !(c.canBeDropped !== false) } : c
    );
    onUpdateCourse({ ...course, components: updated });
  };

  const handleScoreInputChange = (comp: GradeComponent, raw: string) => {
    setScoreTexts((prev) => ({ ...prev, [comp.id]: raw }));

    const trimmed = raw.trim().replace(/%$/, '');
    if (trimmed === '') {
      const updated = course.components.map((c) =>
        c.id === comp.id
          ? { ...c, status: 'remaining' as const, earnedPoints: null }
          : c
      );
      onUpdateCourse({ ...course, components: updated });
      return;
    }

    if (trimmed.includes('/')) {
      const [numStr, denStr] = trimmed.split('/');
      const earned = parseFloat(numStr);
      const max = parseFloat(denStr);
      if (Number.isFinite(earned) && Number.isFinite(max) && max > 0) {
        const updated = course.components.map((c) =>
          c.id === comp.id
            ? {
                ...c,
                status: 'completed' as const,
                earnedPoints: earned,
                maxPoints: max,
                whatIfPercentage: null,
              }
            : c
        );
        onUpdateCourse({ ...course, components: updated });
      }
      return;
    }

    const num = parseFloat(trimmed);
    if (Number.isFinite(num)) {
      const updated = course.components.map((c) =>
        c.id === comp.id
          ? {
              ...c,
              status: 'completed' as const,
              earnedPoints: num,
              maxPoints: 100,
              whatIfPercentage: null,
            }
          : c
      );
      onUpdateCourse({ ...course, components: updated });
    }
  };

  /**
   * Toggle or initialize individual homework tracking (ONLY for non-exam Homework/Coursework)
   */
  const handleToggleSubTracker = (comp: GradeComponent) => {
    if (expandedSubId === comp.id) {
      setExpandedSubId(null);
      return;
    }

    setExpandedSubId(comp.id);

    if (!comp.subItems || comp.subItems.length === 0) {
      const prefix = getShortPrefix(comp.name);
      const defaultCount = 8;
      const initialSubItems: SubAssignmentItem[] = Array.from(
        { length: defaultCount },
        (_, idx) => ({
          id: `${comp.id}-sub-${idx + 1}`,
          name: `${prefix} ${idx + 1}`,
          scoreText: '',
          percentage: null,
        })
      );

      const updated = course.components.map((c) =>
        c.id === comp.id
          ? {
              ...c,
              subItems: initialSubItems,
              subTargetPercentage: c.subTargetPercentage ?? 95,
              subDropLowestCount: c.subDropLowestCount ?? 0,
            }
          : c
      );
      onUpdateCourse({ ...course, components: updated });
    }
  };

  const handleChangeSubItemCount = (comp: GradeComponent, newCount: number) => {
    const clamped = Math.max(1, Math.min(30, newCount));
    const currentList = comp.subItems || [];
    const prefix = getShortPrefix(comp.name);

    let nextList: SubAssignmentItem[];
    if (clamped > currentList.length) {
      const added: SubAssignmentItem[] = Array.from(
        { length: clamped - currentList.length },
        (_, i) => {
          const num = currentList.length + i + 1;
          return {
            id: `${comp.id}-sub-${num}-${Date.now()}`,
            name: `${prefix} ${num}`,
            scoreText: '',
            percentage: null,
          };
        }
      );
      nextList = [...currentList, ...added];
    } else {
      nextList = currentList.slice(0, clamped);
    }

    syncSubItemsToComponent(
      comp,
      nextList,
      comp.subTargetPercentage ?? 95,
      comp.subDropLowestCount ?? 0
    );
  };

  const handleSubItemScoreChange = (
    comp: GradeComponent,
    subId: string,
    rawScore: string
  ) => {
    const currentList = comp.subItems || [];
    const nextList = currentList.map((item) => {
      if (item.id !== subId) return item;
      const pct = parseScoreStringToPercentage(rawScore);
      return {
        ...item,
        scoreText: rawScore,
        percentage: pct,
      };
    });

    syncSubItemsToComponent(
      comp,
      nextList,
      comp.subTargetPercentage ?? 95,
      comp.subDropLowestCount ?? 0
    );
  };

  const handleSubTargetChange = (comp: GradeComponent, newTarget: number) => {
    const clamped = Math.max(0, Math.min(100, newTarget));
    syncSubItemsToComponent(
      comp,
      comp.subItems || [],
      clamped,
      comp.subDropLowestCount ?? 0
    );
  };

  const handleSubDropChange = (comp: GradeComponent, newDrop: number) => {
    const clamped = Math.max(0, Math.min(10, newDrop));
    syncSubItemsToComponent(
      comp,
      comp.subItems || [],
      comp.subTargetPercentage ?? 95,
      clamped
    );
  };

  const syncSubItemsToComponent = (
    comp: GradeComponent,
    nextSubItems: SubAssignmentItem[],
    nextTargetPct: number,
    nextDropCount: number,
    overrideMainScorePct?: number
  ) => {
    const metrics = calculateSubItemsMetrics(
      nextSubItems,
      nextTargetPct,
      nextDropCount
    );
    const pctToUse =
      overrideMainScorePct !== undefined
        ? overrideMainScorePct
        : metrics.currentAverage;

    const updated = course.components.map((c) => {
      if (c.id !== comp.id) return c;
      if (pctToUse !== null && Number.isFinite(pctToUse)) {
        const rounded = Number(pctToUse.toFixed(1));
        setScoreTexts((prev) => ({ ...prev, [comp.id]: `${rounded}` }));
        return {
          ...c,
          subItems: nextSubItems,
          subTargetPercentage: nextTargetPct,
          subDropLowestCount: nextDropCount,
          status: 'completed' as const,
          earnedPoints: rounded,
          maxPoints: 100,
          whatIfPercentage: null,
        };
      }
      return {
        ...c,
        subItems: nextSubItems,
        subTargetPercentage: nextTargetPct,
        subDropLowestCount: nextDropCount,
      };
    });

    onUpdateCourse({ ...course, components: updated });
  };

  const handleWhatIfChange = (compId: string, rawVal: string) => {
    const trimmed = rawVal.trim().replace(/%$/, '');
    const parsed = trimmed === '' ? null : parseFloat(trimmed);
    const updated = course.components.map((c) =>
      c.id === compId
        ? {
            ...c,
            whatIfPercentage: parsed !== null && Number.isFinite(parsed) ? parsed : null,
          }
        : c
    );
    onUpdateCourse({ ...course, components: updated });
  };

  const handleAssumedChange = (compId: string, rawVal: string) => {
    const parsed = parseFloat(rawVal);
    const val = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 100;
    const updated = course.components.map((c) =>
      c.id === compId ? { ...c, assumedPercentage: val } : c
    );
    onUpdateCourse({ ...course, components: updated });
  };

  const handleTargetGradeSelect = (letter: string) => {
    onUpdateCourse({ ...course, targetGrade: letter });
  };

  const handleClearWhatIfs = () => {
    const updated = course.components.map((c) => ({ ...c, whatIfPercentage: null }));
    onUpdateCourse({ ...course, components: updated });
  };

  const activeReqs =
    activeMode === 'before-semester'
      ? beforeSemester.requirementsByGrade
      : inProgress.requirementsByGrade;

  const targetReq =
    activeReqs.find((r) => r.letter === course.targetGrade) || activeReqs[0];

  const hasAnyWhatIf = course.components.some(
    (c) => c.status === 'remaining' && c.whatIfPercentage !== null
  );

  const effectiveWeightMap =
    activeMode === 'before-semester'
      ? beforeSemester.effectiveWeightById
      : inProgress.effectiveWeightById;

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All Courses
        </button>

        <button
          type="button"
          onClick={onEditStructure}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 cursor-pointer"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Edit Syllabus Weights
        </button>
      </div>

      {/* Course Header with Click-to-Edit Course Name */}
      <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-2xs">
        <div>
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={draftCourseCode}
                onChange={(e) => setDraftCourseCode(e.target.value)}
                onBlur={handleSaveCourseCode}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCourseCode();
                  if (e.key === 'Escape') {
                    setDraftCourseCode(course.courseCode);
                    setIsEditingTitle(false);
                  }
                }}
                placeholder="Enter course name..."
                className="text-2xl sm:text-3xl font-bold text-slate-900 font-display bg-indigo-50/70 border border-indigo-400 rounded-lg px-3 py-1 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveCourseCode}
                className="p-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => {
                setDraftCourseCode(course.courseCode);
                setIsEditingTitle(true);
              }}
              title="Click to rename course"
              className="group inline-flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1 -ml-2 hover:bg-indigo-50/60 transition-colors"
            >
              <h1 className="text-3xl font-bold text-slate-900 font-display">
                {course.courseCode}
              </h1>
              <Pencil className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit mt-3">
            <button
              type="button"
              onClick={() => setActiveMode('in-progress')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                activeMode === 'in-progress'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Semester In Progress
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('before-semester')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                activeMode === 'before-semester'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Before Semester
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 sm:gap-8">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {activeMode === 'in-progress' && inProgress.isAllCompleted
                ? 'Final Grade / 最终总评'
                : 'Current Grade / 当前总评'}
            </p>
            {activeMode === 'in-progress' &&
            inProgress.hasCompletedAssessments &&
            inProgress.currentGradePercentage !== null ? (
              <div className="flex items-center gap-2.5 mt-0.5">
                <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                  {formatPct(inProgress.currentGradePercentage)}
                </span>
                {inProgress.currentLetterGrade && (
                  <span className="px-2.5 py-0.5 text-xl font-bold font-mono rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {inProgress.currentLetterGrade}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-3xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                —
              </p>
            )}
            {activeMode === 'in-progress' &&
              inProgress.hasWhatIf &&
              inProgress.projectedGradePercentage !== null && (
                <p className="text-xs font-mono font-semibold text-amber-700 mt-1">
                  What-if: {formatPct(inProgress.projectedGradePercentage)} (
                  {inProgress.projectedLetterGrade})
                </p>
              )}
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500">Target Grade</p>
            <select
              value={course.targetGrade}
              onChange={(e) => handleTargetGradeSelect(e.target.value)}
              className="mt-0.5 text-2xl font-bold font-mono text-indigo-600 bg-indigo-50/70 border border-indigo-200 rounded-lg px-3 py-1 focus:outline-none cursor-pointer"
            >
              {course.gradeScale.map((g) => (
                <option key={g.letter} value={g.letter}>
                  {g.letter}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Two-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Grade Breakdown + Homework Tracker + Exam Drop Rule */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-base font-bold text-slate-900 font-display">
              Grade Breakdown
            </h2>

            {/* Quick Exam Drop Policy Switcher right inside Grade Breakdown */}
            <div className="flex items-center gap-1.5 text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-slate-500">Exam Policy / 考试政策:</span>
              <select
                value={course.examDropCount || 0}
                onChange={(e) =>
                  handleExamDropCountChange(parseInt(e.target.value, 10) || 0)
                }
                className="px-2 py-1 font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md focus:outline-none cursor-pointer"
              >
                <option value={0}>No Drop · 全部计入</option>
                <option value={1}>
                  Drop Lowest 1 Exam · 去最低1场
                  {inProgress.totalDroppableExamCount > 1
                    ? ` (Best ${inProgress.countedExamCount}/${inProgress.totalDroppableExamCount})`
                    : ''}
                </option>
                <option value={2}>Drop Lowest 2 Exams · 去最低2场</option>
              </select>
            </div>
          </div>

          {inProgress.examDropCount > 0 && (
            <div className="mb-4 px-3.5 py-2.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-xs text-indigo-950 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Drop Lowest {inProgress.examDropCount} Exam(s)</strong>: Best{' '}
                <strong>
                  {inProgress.countedExamCount} of {inProgress.totalDroppableExamCount}
                </strong>{' '}
                droppable exams count (去最低 {inProgress.examDropCount} 场，取最高{' '}
                {inProgress.countedExamCount} 场计入).
              </span>
              {targetReq && targetReq.droppedComponentNames.length > 0 && (
                <span className="font-mono font-semibold text-indigo-700">
                  Dropped / 自动不计入: {targetReq.droppedComponentNames.join(', ')}
                </span>
              )}
            </div>
          )}

          {activeMode === 'before-semester' ? (
            <div className="divide-y divide-slate-100">
              {course.components.map((comp) => {
                const isNonExam = comp.categoryType === 'non-exam';
                const effWeight = effectiveWeightMap[comp.id] ?? comp.weight;
                return (
                  <div
                    key={comp.id}
                    className="py-3.5 flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{comp.name}</p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        Effective Weight: {effWeight}%
                      </p>
                    </div>

                    {isNonExam ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">Assume</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={comp.assumedPercentage}
                          onChange={(e) => handleAssumedChange(comp.id, e.target.value)}
                          className="w-16 px-2 py-1 text-sm font-mono font-semibold text-right bg-indigo-50/50 border border-indigo-200 rounded text-indigo-900 tabular-nums"
                        />
                        <span className="text-xs text-slate-500 font-mono">%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-indigo-600 font-medium">
                        {beforeSemester.examDropCount > 0 && comp.canBeDropped !== false
                          ? `Best ${beforeSemester.countedExamCount} of ${beforeSemester.totalDroppableExamCount} count`
                          : 'Exam to calculate'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {course.components.map((comp) => {
                const isNonExam = comp.categoryType === 'non-exam';
                const isCompleted = comp.status === 'completed';
                const actualPct = getComponentActualPercentage(comp);
                const textVal = scoreTexts[comp.id] ?? '';
                const showConvertedBadge =
                  isCompleted && textVal.includes('/') && actualPct !== null;

                const effWeight = effectiveWeightMap[comp.id] ?? comp.weight;
                const isDroppedInTarget =
                  !isNonExam &&
                  inProgress.examDropCount > 0 &&
                  targetReq?.droppedComponentNames.includes(comp.name);

                const isSubExpanded = isNonExam && expandedSubId === comp.id;
                const subItems = comp.subItems || [];
                const subMetrics =
                  isNonExam && subItems.length > 0
                    ? calculateSubItemsMetrics(
                        subItems,
                        comp.subTargetPercentage ?? 95,
                        comp.subDropLowestCount ?? 0
                      )
                    : null;

                return (
                  <div key={comp.id} className="py-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-xs ${
                              isCompleted ? 'text-emerald-600' : 'text-slate-300'
                            }`}
                          >
                            {isCompleted ? <Check className="w-4 h-4" /> : '○'}
                          </span>
                          <p
                            className={`text-sm font-semibold truncate ${
                              isDroppedInTarget
                                ? 'line-through text-slate-400'
                                : 'text-slate-900'
                            }`}
                          >
                            {comp.name}
                          </p>

                          {/* ONLY show Track Each / 按次算分 on Homework / Non-Exam components */}
                          {isNonExam && (
                            <button
                              type="button"
                              onClick={() => handleToggleSubTracker(comp)}
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                                isSubExpanded || (subMetrics && subMetrics.completedCount > 0)
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                              }`}
                            >
                              <ListChecks className="w-3 h-3" />
                              {subMetrics && subMetrics.completedCount > 0
                                ? `Track Each / 按次算分 (${subMetrics.completedCount}/${subMetrics.totalCount})`
                                : 'Track Each / 按次算分'}
                              {isSubExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          )}

                          {/* For Exams when examDropCount > 0: show whether it's in the drop pool or dropped */}
                          {!isNonExam && (course.examDropCount || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => handleToggleExamDroppable(comp.id)}
                              title="Click to toggle whether this exam can be dropped"
                              className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                                isDroppedInTarget
                                  ? 'bg-amber-50 border-amber-200 text-amber-800 font-semibold'
                                  : comp.canBeDropped !== false
                                  ? 'bg-slate-100 border-slate-200 text-slate-600 hover:border-indigo-300'
                                  : 'bg-slate-50 border-slate-200 text-slate-400'
                              }`}
                            >
                              {isDroppedInTarget
                                ? 'Dropped · 已自动 Drop'
                                : comp.canBeDropped !== false
                                ? 'Droppable · 参与 Drop'
                                : 'Required · 必考'}
                            </button>
                          )}
                        </div>

                        <p className="text-xs text-slate-500 font-mono tabular-nums pl-6 mt-0.5">
                          {isDroppedInTarget
                            ? `Dropped (0% effective · original ${effWeight}%)`
                            : `Weight: ${effWeight}%`}
                          {showConvertedBadge && (
                            <span className="ml-2 text-indigo-600 font-semibold">
                              → {formatPct(actualPct)}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
                        <div className="relative">
                          <input
                            type="text"
                            value={textVal}
                            onChange={(e) => handleScoreInputChange(comp, e.target.value)}
                            placeholder="Not graded"
                            className={`w-28 px-3 py-1.5 text-sm font-mono tabular-nums text-right rounded-lg border focus:outline-none ${
                              isCompleted
                                ? 'bg-emerald-50/40 border-emerald-300 font-bold text-slate-900 focus:border-indigo-600'
                                : 'bg-slate-50 border-slate-200 text-slate-600 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600'
                            }`}
                          />
                          {isCompleted && !textVal.includes('/') && (
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                              %
                            </span>
                          )}
                        </div>

                        {!isCompleted && (
                          <input
                            type="number"
                            placeholder="What-if %"
                            value={comp.whatIfPercentage ?? ''}
                            onChange={(e) => handleWhatIfChange(comp.id, e.target.value)}
                            title="Enter a hypothetical What-If percentage score"
                            className={`w-24 px-2.5 py-1.5 text-xs font-mono tabular-nums text-right rounded-lg border focus:outline-none ${
                              comp.whatIfPercentage !== null
                                ? 'bg-amber-50 border-amber-300 font-bold text-amber-900'
                                : 'bg-slate-50/70 border-dashed border-slate-200 text-slate-600 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600'
                            }`}
                          />
                        )}
                      </div>
                    </div>

                    {/* Expanded Multi-Homework Calculator Drawer (Only for Homework / Non-Exam) */}
                    {isSubExpanded && subMetrics && (
                      <div className="mt-3 ml-0 sm:ml-6 p-4 bg-indigo-50/40 border border-indigo-100 rounded-xl space-y-4">
                        {/* Top Controls: Total Homework Count, Drop Lowest Count, Target Average */}
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-700">
                                Total Count / 总次数:
                              </span>
                              <div className="inline-flex items-center bg-white border border-slate-200 rounded-lg">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleChangeSubItemCount(
                                      comp,
                                      subMetrics.totalCount - 1
                                    )
                                  }
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 cursor-pointer"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="px-2 font-mono font-bold text-slate-900">
                                  {subMetrics.totalCount}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleChangeSubItemCount(
                                      comp,
                                      subMetrics.totalCount + 1
                                    )
                                  }
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 cursor-pointer"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-700">
                                Drop Lowest / 去最低:
                              </span>
                              <select
                                value={comp.subDropLowestCount ?? 0}
                                onChange={(e) =>
                                  handleSubDropChange(
                                    comp,
                                    parseInt(e.target.value, 10) || 0
                                  )
                                }
                                className="px-2 py-1 font-mono font-semibold bg-white border border-slate-200 rounded-md text-slate-800 cursor-pointer"
                              >
                                <option value={0}>0 (None)</option>
                                <option value={1}>1 (Drop 1 · 去1次)</option>
                                <option value={2}>2 (Drop 2 · 去2次)</option>
                                <option value={3}>3 (Drop 3 · 去3次)</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-700">
                              Target Avg / 目标均分:
                            </span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={comp.subTargetPercentage ?? 95}
                              onChange={(e) =>
                                handleSubTargetChange(
                                  comp,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-16 px-2 py-1 font-mono font-bold text-right bg-white border border-indigo-200 rounded-md text-indigo-700"
                            />
                            <span className="text-slate-500 font-mono">%</span>
                          </div>
                        </div>

                        {/* Grid of Individual Homework Inputs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {subItems.map((sub) => {
                            const hasScore = sub.percentage !== null;
                            const isSubDropped = subMetrics.droppedSubIds.includes(
                              sub.id
                            );
                            return (
                              <div
                                key={sub.id}
                                className={`flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg border ${
                                  isSubDropped
                                    ? 'bg-amber-50/60 border-amber-200'
                                    : hasScore
                                    ? 'bg-white border-emerald-200'
                                    : 'bg-white/70 border-slate-200 border-dashed'
                                }`}
                              >
                                <span
                                  className={`text-xs font-medium truncate ${
                                    isSubDropped
                                      ? 'line-through text-slate-400'
                                      : 'text-slate-700'
                                  }`}
                                >
                                  {sub.name}
                                </span>
                                <input
                                  type="text"
                                  value={sub.scoreText}
                                  onChange={(e) =>
                                    handleSubItemScoreChange(
                                      comp,
                                      sub.id,
                                      e.target.value
                                    )
                                  }
                                  placeholder="—"
                                  className="w-14 text-xs font-mono font-semibold text-right bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none tabular-nums"
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* Live Calculation Summary for Remaining Homeworks */}
                        <div className="pt-3 border-t border-indigo-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="text-slate-600">
                                Current Avg / 当前均分 ({subMetrics.completedCount}/
                                {subMetrics.totalCount} graded
                                {subMetrics.dropLowestCount > 0
                                  ? ` · Drop lowest ${subMetrics.dropLowestCount}`
                                  : ''}
                                ):{' '}
                                <strong className="font-mono text-slate-900">
                                  {subMetrics.currentAverage !== null
                                    ? formatPct(subMetrics.currentAverage)
                                    : '—'}
                                </strong>
                              </span>
                              <span className="text-slate-300">·</span>
                              <span className="text-slate-600">
                                Max Possible / 后续全满分可达:{' '}
                                <strong className="font-mono text-emerald-700">
                                  {formatPct(subMetrics.maxPossibleAverage)}
                                </strong>
                              </span>
                            </div>

                            {subMetrics.remainingCount > 0 &&
                              subMetrics.requiredOnRemainingForTarget !== null && (
                                <p className="text-indigo-950 font-medium">
                                  {subMetrics.targetFeasibility === 'impossible' ? (
                                    <span className="text-rose-600">
                                      Need{' '}
                                      <strong className="font-mono">
                                        {formatPct(
                                          subMetrics.requiredOnRemainingForTarget
                                        )}
                                      </strong>{' '}
                                      on each remaining HW for {subMetrics.targetAverage}% avg
                                      (exceeds 100% / 超过满分)
                                    </span>
                                  ) : subMetrics.targetFeasibility === 'secured' ? (
                                    <span className="text-emerald-700">
                                      {subMetrics.targetAverage}% HW average already secured! (已锁定目标均分)
                                    </span>
                                  ) : (
                                    <span>
                                      To reach{' '}
                                      <strong className="font-mono text-indigo-700">
                                        {subMetrics.targetAverage}%
                                      </strong>{' '}
                                      avg, need on each remaining HW / 后续每次需拿:
                                      <strong className="ml-1 text-sm font-mono text-indigo-600">
                                        {formatPct(
                                          subMetrics.requiredOnRemainingForTarget
                                        )}
                                      </strong>
                                    </span>
                                  )}
                                </p>
                              )}
                          </div>

                          {subMetrics.remainingCount > 0 &&
                            subMetrics.completedCount > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  syncSubItemsToComponent(
                                    comp,
                                    subItems,
                                    comp.subTargetPercentage ?? 95,
                                    comp.subDropLowestCount ?? 0,
                                    subMetrics.maxPossibleAverage
                                  )
                                }
                                className="px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Assume 100% on remaining · 按后续全满分 ({formatPct(subMetrics.maxPossibleAverage)}) 计入
                              </button>
                            )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeMode === 'in-progress' && hasAnyWhatIf && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-amber-800">
              <span>What-if scenario active</span>
              <button
                type="button"
                onClick={handleClearWhatIfs}
                className="inline-flex items-center gap-1 font-semibold underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset What-if
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Current/Final Letter Grade + What do I need? */}
        <div className="lg:col-span-5 space-y-6">
          {/* Current / Final Letter Grade Summary Card */}
          {activeMode === 'in-progress' &&
            (inProgress.hasCompletedAssessments || inProgress.hasWhatIf) && (
              <div
                className={`border rounded-xl p-5 shadow-2xs ${
                  inProgress.isAllCompleted
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : inProgress.hasWhatIf
                    ? 'bg-amber-50/70 border-amber-200'
                    : 'bg-indigo-50/60 border-indigo-100'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p
                      className={`text-xs font-semibold ${
                        inProgress.isAllCompleted
                          ? 'text-emerald-800'
                          : inProgress.hasWhatIf
                          ? 'text-amber-900'
                          : 'text-indigo-900'
                      }`}
                    >
                      {inProgress.isAllCompleted
                        ? 'Final Course Grade / 最终课程等级'
                        : inProgress.hasWhatIf
                        ? 'Projected Grade (What-If) / 模拟总评等级'
                        : 'Current Letter Grade / 当前实时等级'}
                    </p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {formatPct(
                        (inProgress.hasWhatIf
                          ? inProgress.projectedGradePercentage
                          : inProgress.currentGradePercentage) ?? 0
                      )}
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      {inProgress.isAllCompleted
                        ? 'All required grades entered · 所有计分项已录入'
                        : `Based on ${inProgress.completedWeight}% graded weight · 基于已出分 ${inProgress.completedWeight}% 权重`}
                    </p>
                  </div>

                  <div className="text-right">
                    <div
                      className={`inline-flex items-center justify-center min-w-[64px] px-4 py-2.5 rounded-xl font-mono text-3xl font-bold shadow-2xs border ${
                        inProgress.isAllCompleted
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : inProgress.hasWhatIf
                          ? 'bg-amber-500 text-white border-amber-600'
                          : 'bg-white text-indigo-700 border-indigo-200'
                      }`}
                    >
                      {(inProgress.hasWhatIf
                        ? inProgress.projectedLetterGrade
                        : inProgress.currentLetterGrade) || '—'}
                    </div>
                  </div>
                </div>

                {/* Dropped Exam & Next Grade Up Hints */}
                <div className="mt-3 pt-2.5 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {inProgress.currentlyDroppedNames.length > 0 ? (
                    <span className="text-slate-700 font-medium">
                      Dropped lowest / 已自动去除最低:{' '}
                      <strong className="font-mono text-indigo-700">
                        {inProgress.currentlyDroppedNames.join(', ')}
                      </strong>
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      {inProgress.examDropCount > 0
                        ? `Best ${inProgress.countedExamCount} of ${inProgress.totalDroppableExamCount} exams count`
                        : 'Weighted average of entered scores'}
                    </span>
                  )}

                  {inProgress.nextGradeUp ? (
                    <span className="font-mono font-semibold text-indigo-700">
                      {inProgress.nextGradeUp.pointsAway}% to {inProgress.nextGradeUp.letter} (
                      {inProgress.nextGradeUp.cutoff}%)
                    </span>
                  ) : (
                    <span className="font-semibold text-emerald-700">
                      Highest grade achieved! · 已达最高等级
                    </span>
                  )}
                </div>
              </div>
            )}

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-bold text-slate-900 font-display">
              {activeMode === 'in-progress' && inProgress.isAllCompleted
                ? 'Grade Scale Breakdown / 等级线对照'
                : activeMode === 'in-progress' && inProgress.openAssessments.length === 1
                ? `${inProgress.openAssessments[0].name} score needed`
                : 'What do I need?'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeMode === 'before-semester'
                ? 'Required exam average for each letter grade'
                : inProgress.isAllCompleted
                ? `Your final score is ${formatPct(
                    inProgress.currentGradePercentage ?? 0
                  )} (${inProgress.currentLetterGrade})`
                : inProgress.examDropCount > 0
                ? `Best ${inProgress.countedExamCount} of ${inProgress.totalDroppableExamCount} exams count (lowest ${inProgress.examDropCount} dropped)`
                : inProgress.openAssessments.length === 1
                ? `Score needed on ${inProgress.openAssessments[0].name}`
                : 'Required average across remaining exams'}
            </p>

            {/* Letter Grades & Needed Scores */}
            <div className="mt-4 space-y-1.5">
              {activeReqs.map((req) => {
                const isSelected = req.letter === course.targetGrade;
                const isCurrentEarnedLetter =
                  activeMode === 'in-progress' &&
                  inProgress.isAllCompleted &&
                  inProgress.currentLetterGrade === req.letter;

                const diffFromFinal =
                  activeMode === 'in-progress' &&
                  inProgress.isAllCompleted &&
                  inProgress.currentGradePercentage !== null
                    ? Number(
                        (req.cutoff - inProgress.currentGradePercentage).toFixed(1)
                      )
                    : null;

                return (
                  <div
                    key={req.letter}
                    onClick={() => handleTargetGradeSelect(req.letter)}
                    className={`py-3 px-3.5 rounded-xl flex items-center justify-between gap-4 cursor-pointer transition-colors ${
                      isCurrentEarnedLetter
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : isSelected
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'hover:bg-slate-50 border border-transparent hover:border-slate-200/80'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-base font-bold font-mono ${
                            isSelected || isCurrentEarnedLetter
                              ? 'text-white'
                              : 'text-slate-900'
                          }`}
                        >
                          {req.letter}
                        </span>
                        <span
                          className={`text-xs font-mono ${
                            isCurrentEarnedLetter
                              ? 'text-emerald-100'
                              : isSelected
                              ? 'text-indigo-200'
                              : 'text-slate-400'
                          }`}
                        >
                          ({req.cutoff}%)
                        </span>
                        {isCurrentEarnedLetter && (
                          <span className="px-2 py-0.5 text-[11px] font-bold bg-white/20 text-white rounded-md">
                            Your Grade · 当前等级
                          </span>
                        )}
                      </div>

                      {activeMode === 'in-progress' && inProgress.isAllCompleted ? (
                        <p
                          className={`text-xs mt-0.5 ${
                            isSelected || isCurrentEarnedLetter
                              ? 'text-white/90'
                              : req.feasibility === 'secured'
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {req.feasibility === 'secured'
                            ? `Reached (${req.cutoff}% cutoff met · 已达标)`
                            : `Short by ${diffFromFinal}% (差 ${diffFromFinal}%)`}
                        </p>
                      ) : (
                        <>
                          {req.feasibility === 'impossible' && (
                            <p
                              className={`text-xs mt-0.5 ${
                                isSelected ? 'text-rose-200' : 'text-rose-600'
                              }`}
                            >
                              {req.letter} is no longer mathematically possible.
                            </p>
                          )}
                          {req.feasibility === 'secured' && (
                            <p
                              className={`text-xs mt-0.5 ${
                                isSelected ? 'text-emerald-200' : 'text-emerald-700'
                              }`}
                            >
                              You have already secured {req.letter}.
                            </p>
                          )}
                        </>
                      )}

                      {req.droppedComponentNames.length > 0 &&
                        req.feasibility !== 'impossible' && (
                          <p
                            className={`text-[11px] mt-0.5 ${
                              isSelected || isCurrentEarnedLetter
                                ? 'text-white/80'
                                : 'text-slate-400'
                            }`}
                          >
                            Drops: {req.droppedComponentNames.join(', ')}
                          </p>
                        )}
                    </div>

                    <div className="text-right font-mono tabular-nums">
                      {activeMode === 'in-progress' && inProgress.isAllCompleted ? (
                        req.feasibility === 'secured' ? (
                          <span
                            className={`text-sm font-bold ${
                              isSelected || isCurrentEarnedLetter
                                ? 'text-white'
                                : 'text-emerald-600'
                            }`}
                          >
                            ✓ Achieved
                          </span>
                        ) : (
                          <span
                            className={`text-sm font-semibold ${
                              isSelected ? 'text-rose-200' : 'text-slate-400'
                            }`}
                          >
                            -{diffFromFinal}%
                          </span>
                        )
                      ) : req.feasibility === 'secured' ? (
                        <span
                          className={`text-sm font-bold ${
                            isSelected ? 'text-emerald-200' : 'text-emerald-600'
                          }`}
                        >
                          Secured (0%)
                        </span>
                      ) : req.feasibility === 'impossible' ? (
                        <div>
                          <span
                            className={`text-lg font-bold ${
                              isSelected ? 'text-rose-200' : 'text-rose-600'
                            }`}
                          >
                            {formatPct(req.requiredPercentage)}
                          </span>
                        </div>
                      ) : (
                        <span
                          className={`text-xl font-bold ${
                            isSelected ? 'text-white' : 'text-indigo-600'
                          }`}
                        >
                          Need {formatPct(req.requiredPercentage)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-Exam Breakdown when remaining exams exist */}
          {targetReq && targetReq.perAssessmentBreakdown.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="text-sm font-bold text-slate-900 font-display">
                Remaining Exam Targets (for{' '}
                <span className="text-indigo-600">{targetReq.letter}</span>):
              </h3>

              <div className="mt-3 divide-y divide-slate-100 text-sm">
                {targetReq.perAssessmentBreakdown.map((exam) => (
                  <div
                    key={exam.id}
                    className="py-2.5 flex items-center justify-between font-mono tabular-nums"
                  >
                    <div className="font-sans">
                      <span
                        className={`font-medium ${
                          exam.isDroppedAtTarget
                            ? 'line-through text-slate-400'
                            : 'text-slate-700'
                        }`}
                      >
                        {exam.name}
                      </span>
                      {exam.isDroppedAtTarget && (
                        <span className="ml-2 text-xs text-amber-700 font-semibold">
                          (Can be dropped · 0% needed)
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-bold ${
                        exam.isDroppedAtTarget
                          ? 'text-emerald-600'
                          : 'text-indigo-600'
                      }`}
                    >
                      {targetReq.feasibility === 'secured' || exam.isDroppedAtTarget
                        ? '0% (Dropped)'
                        : `${formatScoreNumber(exam.requiredPoints)} / ${exam.maxPoints} (${formatPct(exam.requiredPercentage)})`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
