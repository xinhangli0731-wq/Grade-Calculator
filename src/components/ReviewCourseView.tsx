import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Split, AlertTriangle, Pencil, ShieldCheck } from 'lucide-react';
import {
  Course,
  GradeComponent,
  GradeCutoff,
  ParsedSyllabusResponse,
  SubAssignmentItem,
} from '../types/course';

interface ReviewCourseViewProps {
  initialData: ParsedSyllabusResponse;
  existingCourse?: Course | null;
  onBack: () => void;
  onConfirmCourse: (course: Course) => void;
}

const DEFAULT_EMPTY_LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-'];

const STANDARD_SCALE_PRESET: GradeCutoff[] = [
  { letter: 'A+', minPercentage: 97 },
  { letter: 'A', minPercentage: 93 },
  { letter: 'A-', minPercentage: 90 },
  { letter: 'B+', minPercentage: 87 },
  { letter: 'B', minPercentage: 83 },
  { letter: 'B-', minPercentage: 80 },
];

function inferCategoryType(name: string): 'exam' | 'non-exam' {
  const lower = name.toLowerCase();
  if (
    lower.includes('midterm') ||
    lower.includes('final') ||
    lower.includes('exam') ||
    lower.includes('quiz') ||
    lower.includes('test') ||
    lower.includes('report')
  ) {
    return 'exam';
  }
  if (
    lower.includes('homework') ||
    lower.includes('hw') ||
    lower.includes('classwork') ||
    lower.includes('practice') ||
    lower.includes('challenge') ||
    lower.includes('problem') ||
    lower.includes('worksheet') ||
    lower.includes('attendance') ||
    lower.includes('participation') ||
    lower.includes('assignment') ||
    lower.includes('lab') ||
    lower.includes('discussion') ||
    lower.includes('project') ||
    lower.includes('mp')
  ) {
    return 'non-exam';
  }
  return 'exam';
}

function getShortPrefix(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('homework') || lower.includes('hw')) return 'HW';
  if (lower.includes('lab')) return 'Lab';
  if (lower.includes('practice')) return 'Prac';
  if (lower.includes('challenge')) return 'Chal';
  if (lower.includes('classwork')) return 'CW';
  return 'HW';
}

function buildInitialSubItems(
  compId: string,
  name: string,
  count = 8
): SubAssignmentItem[] {
  const prefix = getShortPrefix(name);
  return Array.from({ length: count }, (_, idx) => ({
    id: `${compId}-sub-${idx + 1}`,
    name: `${prefix} ${idx + 1}`,
    scoreText: '',
    percentage: null,
  }));
}

function sanitizeCourseCode(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (
    /^(unknown|unknown course|n\/a|none|null|not specified|course|syllabus)$/i.test(
      trimmed
    )
  ) {
    return '';
  }
  return trimmed;
}

export const ReviewCourseView: React.FC<ReviewCourseViewProps> = ({
  initialData,
  existingCourse,
  onBack,
  onConfirmCourse,
}) => {
  const [courseCode, setCourseCode] = useState(() =>
    sanitizeCourseCode(existingCourse?.courseCode || initialData.courseCode)
  );

  const [examDropCount, setExamDropCount] = useState<number>(() =>
    existingCourse
      ? existingCourse.examDropCount || 0
      : initialData.examDropCount || 0
  );

  const [components, setComponents] = useState<GradeComponent[]>(() => {
    if (existingCourse) {
      return existingCourse.components.map((c) => ({ ...c }));
    }

    // Deduplicate components if parser returned duplicate base names
    const rawList = initialData.components || [];
    const seenKeys = new Set<string>();
    const dedupedList = rawList.filter((c) => {
      const key = (c.name || '')
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (!key) return false;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    return dedupedList.map((c, idx) => {
      const catType = inferCategoryType(c.name);
      const compId = `comp-${Date.now()}-${idx}`;
      const bestMatch = c.name.match(/best\s+(\d+)\s*(?:\/|of|out of)\s*(\d+)/i);
      const parsedTotal = bestMatch ? parseInt(bestMatch[2], 10) : undefined;
      const parsedDrop = bestMatch
        ? Math.max(0, parseInt(bestMatch[2], 10) - parseInt(bestMatch[1], 10))
        : undefined;

      const subCount =
        c.totalSubItemsCount && c.totalSubItemsCount > 1
          ? c.totalSubItemsCount
          : parsedTotal && parsedTotal > 1
          ? parsedTotal
          : 8;
      const subDrop =
        c.subDropLowestCount !== undefined && c.subDropLowestCount > 0
          ? c.subDropLowestCount
          : parsedDrop || 0;

      return {
        id: compId,
        name: c.name,
        weight: Number(c.weight) || 0,
        categoryType: catType,
        canBeDropped:
          catType === 'exam' ? (c.canBeDropped ?? true) : false,
        status: 'remaining',
        earnedPoints: null,
        maxPoints: Number(c.maxPoints) > 0 ? Number(c.maxPoints) : 100,
        assumedPercentage: 100,
        whatIfPercentage: null,
        subTargetPercentage: 95,
        subDropLowestCount: subDrop,
        subItems:
          catType === 'non-exam'
            ? buildInitialSubItems(compId, c.name, subCount)
            : undefined,
      };
    });
  });

  const [gradeScaleFound] = useState<boolean>(
    existingCourse ? existingCourse.gradeScaleFoundInSyllabus : initialData.gradeScaleFound
  );

  const [gradeScale, setGradeScale] = useState<GradeCutoff[]>(() => {
    if (existingCourse && existingCourse.gradeScale.length > 0) {
      return existingCourse.gradeScale.map((g) => ({ ...g }));
    }
    if (initialData.gradeScaleFound && initialData.gradeScale.length > 0) {
      return initialData.gradeScale.map((g) => ({
        letter: g.letter,
        minPercentage: Number(g.minPercentage),
      }));
    }
    return DEFAULT_EMPTY_LETTERS.map((letter) => ({
      letter,
      minPercentage: null,
    }));
  });

  const [validationError, setValidationError] = useState<string | null>(null);

  // Calculate effective weight accounting for dropped exams
  const droppableExams = components.filter(
    (c) => c.categoryType === 'exam' && c.canBeDropped !== false
  );
  const activeDrops =
    examDropCount > 0 && droppableExams.length > examDropCount
      ? examDropCount
      : 0;
  const countedDroppableCount = droppableExams.length - activeDrops;

  const nonDroppableWeight = components
    .filter((c) => !(c.categoryType === 'exam' && c.canBeDropped !== false))
    .reduce((sum, c) => sum + (Number(c.weight) || 0), 0);

  const avgDroppableWeight =
    droppableExams.length > 0
      ? droppableExams.reduce((sum, c) => sum + (Number(c.weight) || 0), 0) /
        droppableExams.length
      : 0;

  const effectiveTotalWeight =
    activeDrops > 0
      ? nonDroppableWeight + countedDroppableCount * avgDroppableWeight
      : components.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);

  const handleComponentChange = (
    id: string,
    field: 'name' | 'weight' | 'canBeDropped' | 'categoryType',
    value: string | number | boolean
  ) => {
    setValidationError(null);
    setComponents((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (field === 'name') {
          const nextName = String(value);
          const nextCat = inferCategoryType(nextName);
          return {
            ...c,
            name: nextName,
            categoryType: nextCat,
            canBeDropped: nextCat === 'exam' ? c.canBeDropped ?? true : false,
            subItems:
              nextCat === 'non-exam' && (!c.subItems || c.subItems.length === 0)
                ? buildInitialSubItems(c.id, nextName, 8)
                : c.subItems,
          };
        }
        if (field === 'categoryType') {
          const nextCat = value === 'non-exam' ? 'non-exam' : 'exam';
          return {
            ...c,
            categoryType: nextCat,
            canBeDropped: nextCat === 'exam' ? true : false,
            subItems:
              nextCat === 'non-exam' && (!c.subItems || c.subItems.length === 0)
                ? buildInitialSubItems(c.id, c.name, 8)
                : c.subItems,
          };
        }
        if (field === 'canBeDropped') {
          return { ...c, canBeDropped: Boolean(value) };
        }
        return { ...c, weight: Number(value) || 0 };
      })
    );
  };

  const handleAddComponent = () => {
    setValidationError(null);
    const rem = Math.max(0, Number((100 - effectiveTotalWeight).toFixed(1)));
    setComponents((prev) => [
      ...prev,
      {
        id: `comp-${Date.now()}-${prev.length}`,
        name: `Exam ${prev.length + 1}`,
        weight: rem > 0 ? rem : 20,
        categoryType: 'exam',
        canBeDropped: true,
        status: 'remaining',
        earnedPoints: null,
        maxPoints: 100,
        assumedPercentage: 100,
        whatIfPercentage: null,
      },
    ]);
  };

  const handleRemoveComponent = (id: string) => {
    setValidationError(null);
    setComponents((prev) => prev.filter((c) => c.id !== id));
  };

  const handleQuickSplit = (comp: GradeComponent) => {
    const matchCount = comp.name.match(/(\d+)/);
    const count = matchCount ? Math.min(10, Math.max(2, parseInt(matchCount[1], 10))) : 2;
    const baseName =
      comp.name
        .replace(/^\d+\s+/, '')
        .replace(/s$/i, '')
        .trim() || 'Exam';
    const partWeight = Number((comp.weight / count).toFixed(2));

    const splitItems: GradeComponent[] = Array.from({ length: count }, (_, idx) => ({
      id: `${comp.id}-split-${idx}-${Date.now()}`,
      name: `${baseName} ${idx + 1}`,
      weight:
        idx === count - 1
          ? Number((comp.weight - partWeight * (count - 1)).toFixed(2))
          : partWeight,
      categoryType: comp.categoryType,
      canBeDropped: comp.categoryType === 'exam',
      status: 'remaining',
      earnedPoints: null,
      maxPoints: comp.maxPoints,
      assumedPercentage: 100,
      whatIfPercentage: null,
    }));

    setComponents((prev) => {
      const idx = prev.findIndex((c) => c.id === comp.id);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1, ...splitItems);
      return next;
    });
  };

  const handleCutoffChange = (
    index: number,
    field: 'letter' | 'minPercentage',
    value: string
  ) => {
    setValidationError(null);
    setGradeScale((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        if (field === 'letter') return { ...item, letter: value };
        const parsed = value.trim() === '' ? null : Number(value);
        return {
          ...item,
          minPercentage: parsed !== null && Number.isFinite(parsed) ? parsed : null,
        };
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (components.length === 0) {
      setValidationError('Please add at least one grading component.');
      return;
    }

    const validCutoffs = gradeScale.filter(
      (g) => g.letter.trim() !== '' && g.minPercentage !== null && Number.isFinite(g.minPercentage)
    );

    if (validCutoffs.length === 0) {
      setValidationError('Please enter the grade cutoffs (or click "Fill Standard Cutoffs").');
      return;
    }

    const sortedCutoffs = [...validCutoffs].sort(
      (a, b) => (b.minPercentage ?? 0) - (a.minPercentage ?? 0)
    );

    const resolvedCode = courseCode.trim() || 'My Course';

    const newCourse: Course = {
      id: existingCourse?.id || `course-${Date.now()}`,
      courseCode: resolvedCode,
      courseTitle: existingCourse?.courseTitle || initialData.courseTitle || '',
      targetGrade: existingCourse?.targetGrade || 'A',
      components,
      gradeScale: sortedCutoffs,
      gradeScaleFoundInSyllabus: true,
      examDropCount,
      policyNotes: initialData.policyNotes || existingCourse?.policyNotes,
      assumeNonExamFullCreditInProgress:
        existingCourse?.assumeNonExamFullCreditInProgress ?? true,
      createdAt: existingCourse?.createdAt || new Date().toISOString(),
    };

    onConfirmCourse(newCourse);
  };

  return (
    <div className="max-w-[680px] mx-auto px-6 py-12">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 mb-6 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Editable Course Name Box */}
        <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5">
          <label
            htmlFor="course-name-input"
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 mb-1.5"
          >
            <Pencil className="w-3.5 h-3.5" />
            Course Name (Click to edit)
          </label>
          <input
            id="course-name-input"
            type="text"
            autoFocus={!courseCode}
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
            placeholder="Enter course name, e.g. STAT 400 or ECON 102"
            className="text-2xl font-bold text-slate-900 font-display bg-white border border-indigo-200 rounded-lg px-3.5 py-2 focus:border-indigo-600 focus:outline-none w-full"
          />
          {initialData.policyNotes && (
            <p className="text-xs text-indigo-800 mt-2 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>AI Policy Note: {initialData.policyNotes}</span>
            </p>
          )}
        </div>

        {validationError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {validationError}
          </div>
        )}

        {/* Grading Breakdown + Exam Drop Policy Box */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 font-display">
              Grading Breakdown
            </h2>
            <span
              className={`text-xs font-mono tabular-nums ${
                Math.abs(effectiveTotalWeight - 100) < 0.5
                  ? 'text-emerald-600 font-semibold'
                  : 'text-amber-600 font-semibold'
              }`}
            >
              Effective Total: {Number(effectiveTotalWeight.toFixed(1))}%
              {activeDrops > 0 &&
                ` (Best ${countedDroppableCount} of ${droppableExams.length} exams count)`}
            </span>
          </div>

          {/* Exam Drop Policy Selector */}
          <div className="p-3.5 bg-indigo-50/40 border border-indigo-100 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-semibold text-indigo-950">
                Exam Drop Policy / 考试 Drop 规则:
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                e.g. STAT 400 has 4 exams (3 Midterms + Final) and drops the lowest 1, counting the best 3 (例如考 4 次去最低 1 次).
              </p>
            </div>
            <select
              value={examDropCount}
              onChange={(e) => setExamDropCount(parseInt(e.target.value, 10) || 0)}
              className="px-3 py-1.5 font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg focus:outline-none cursor-pointer"
            >
              <option value={0}>No Drop (All exams count / 全部计入)</option>
              <option value={1}>Drop Lowest 1 Exam (Best N-1 / 去最低1场)</option>
              <option value={2}>Drop Lowest 2 Exams (Best N-2 / 去最低2场)</option>
            </select>
          </div>

          <div className="space-y-2.5">
            {components.map((comp) => {
              const isExam = comp.categoryType === 'exam';
              return (
                <div key={comp.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={comp.name}
                    onChange={(e) =>
                      handleComponentChange(comp.id, 'name', e.target.value)
                    }
                    placeholder="Component"
                    className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600"
                  />

                  <div className="relative w-24 shrink-0">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={comp.weight}
                      onChange={(e) =>
                        handleComponentChange(comp.id, 'weight', e.target.value)
                      }
                      className="w-full pr-7 pl-3 py-2 text-sm font-mono tabular-nums text-right bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                      %
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleComponentChange(
                        comp.id,
                        'categoryType',
                        isExam ? 'non-exam' : 'exam'
                      )
                    }
                    title="Click to toggle between Exam/Major Assessment (calculate required score) and Homework/Coursework (assume 100% / track per item)"
                    className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isExam
                        ? 'bg-indigo-50/70 border-indigo-200 text-indigo-700'
                        : 'bg-emerald-50/70 border-emerald-200 text-emerald-700'
                    }`}
                  >
                    {isExam ? 'Exam · 考试' : 'HW · 平时'}
                  </button>

                  {examDropCount > 0 && isExam && (
                    <button
                      type="button"
                      onClick={() =>
                        handleComponentChange(
                          comp.id,
                          'canBeDropped',
                          !(comp.canBeDropped !== false)
                        )
                      }
                      title="Toggle whether this exam can be dropped if it is your lowest score"
                      className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        comp.canBeDropped !== false
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-slate-100 border-slate-200 text-slate-500'
                      }`}
                    >
                      {comp.canBeDropped !== false ? 'Droppable · 可Drop' : 'Required · 必考'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleQuickSplit(comp)}
                    title="Split into individual items"
                    className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer"
                  >
                    <Split className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRemoveComponent(comp.id)}
                    title="Remove"
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleAddComponent}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Component
          </button>
        </div>

        {/* Grade Cutoffs Box */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900 font-display">
              Grade Cutoffs
            </h2>
            <button
              type="button"
              onClick={() =>
                setGradeScale(STANDARD_SCALE_PRESET.map((g) => ({ ...g })))
              }
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 cursor-pointer"
            >
              Fill Standard Cutoffs (97 / 93 / 90)
            </button>
          </div>

          {!gradeScaleFound && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                No grading scale found in syllabus. Please enter cutoffs or click “Fill Standard Cutoffs”.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {gradeScale.map((cutoff, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
              >
                <input
                  type="text"
                  value={cutoff.letter}
                  onChange={(e) => handleCutoffChange(idx, 'letter', e.target.value)}
                  className="w-10 text-sm font-bold font-mono text-slate-900 bg-transparent focus:outline-none"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="any"
                    placeholder="—"
                    value={cutoff.minPercentage ?? ''}
                    onChange={(e) =>
                      handleCutoffChange(idx, 'minPercentage', e.target.value)
                    }
                    className="w-16 px-2 py-1 text-sm font-mono tabular-nums text-right bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  <span className="text-xs text-slate-400 font-mono">%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-3 px-5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer shadow-xs"
        >
          {existingCourse ? 'Save Changes' : 'Create Course'}
        </button>
      </form>
    </div>
  );
};
