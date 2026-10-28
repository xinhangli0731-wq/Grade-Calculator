import React, { useState } from 'react';
import { Plus, Trash2, Pencil, Check } from 'lucide-react';
import { Course } from '../types/course';
import {
  calculateBeforeSemesterRequirements,
  calculateInProgressMetrics,
  formatPct,
} from '../utils/gradeMath';

interface DashboardViewProps {
  courses: Course[];
  onSelectCourse: (courseId: string) => void;
  onAddCourse: () => void;
  onDeleteCourse: (courseId: string) => void;
  onUpdateTargetGrade: (courseId: string, newTarget: string) => void;
  onRenameCourse: (courseId: string, newCode: string) => void;
}

const CARD_TOP_ACCENTS = [
  'border-t-4 border-t-indigo-500',
  'border-t-4 border-t-sky-500',
  'border-t-4 border-t-teal-500',
  'border-t-4 border-t-violet-500',
  'border-t-4 border-t-amber-500',
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  courses,
  onSelectCourse,
  onAddCourse,
  onDeleteCourse,
  onRenameCourse,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const startEditing = (e: React.MouseEvent, course: Course) => {
    e.stopPropagation();
    setEditingId(course.id);
    setEditingName(course.courseCode);
  };

  const commitRename = (courseId: string) => {
    const cleaned = editingName.trim();
    if (cleaned) {
      onRenameCourse(courseId, cleaned);
    }
    setEditingId(null);
  };

  return (
    <div className="max-w-[960px] mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            My Courses
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Click any course to calculate exam & homework targets, or click a course name to rename it.
          </p>
        </div>

        <button
          type="button"
          onClick={onAddCourse}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Plus className="w-4 h-4" />
          Add Course
        </button>
      </div>

      {/* Course Cards Grid */}
      {courses.length === 0 ? (
        <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-14 text-center shadow-2xs">
          <h2 className="text-lg font-bold text-slate-900 font-display">
            No courses yet · 暂无课程
          </h2>
          <p className="text-sm text-slate-500 mt-1.5 mb-6 max-w-md mx-auto">
            Upload a syllabus file, paste a screenshot (⌘V / Ctrl+V), or enter weights manually to create your first course.
          </p>
          <button
            type="button"
            onClick={onAddCourse}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Add Course · 添加第一门课
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {courses.map((course, idx) => {
            const inProgress = calculateInProgressMetrics(course);
            const beforeSem = calculateBeforeSemesterRequirements(course);

            const hasGrades = inProgress.hasCompletedAssessments;
            const activeReqs = hasGrades
              ? inProgress.requirementsByGrade
              : beforeSem.requirementsByGrade;

            const targetReq =
              activeReqs.find((r) => r.letter === course.targetGrade) || activeReqs[0];

            const nextAssessment = hasGrades
              ? inProgress.openAssessments[0]
              : beforeSem.examComponents[0];

            const remainingCount = hasGrades
              ? inProgress.openAssessments.length
              : beforeSem.examComponents.length;

            const topAccent = CARD_TOP_ACCENTS[idx % CARD_TOP_ACCENTS.length];
            const isEditingThis = editingId === course.id;

            return (
              <div
                key={course.id}
                onClick={() => {
                  if (!isEditingThis) onSelectCourse(course.id);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (!isEditingThis && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectCourse(course.id);
                  }
                }}
                className={`group relative bg-white border border-slate-200 ${topAccent} rounded-xl p-6 hover:border-indigo-300 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    {isEditingThis ? (
                      <div
                        className="flex items-center gap-1.5 flex-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => commitRename(course.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(course.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full px-2 py-0.5 text-lg font-bold text-slate-900 font-display bg-indigo-50/60 border border-indigo-400 rounded focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => commitRename(course.id)}
                          className="p-1 text-indigo-600 hover:bg-indigo-50 rounded cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={(e) => startEditing(e, course)}
                        title="Click to rename course"
                        className="inline-flex items-center gap-1.5 group/title rounded px-1 -ml-1 hover:bg-slate-100 transition-colors"
                      >
                        <h2 className="text-xl font-bold text-slate-900 font-display">
                          {course.courseCode}
                        </h2>
                        <Pencil className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover/title:opacity-100 transition-opacity" />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCourse(course.id);
                      }}
                      title="Delete course"
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Target</span>
                      <span className="font-mono font-bold text-indigo-600">
                        {course.targetGrade}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Current Grade</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums flex items-center gap-1.5">
                        {hasGrades && inProgress.currentGradePercentage !== null ? (
                          <>
                            <span>{formatPct(inProgress.currentGradePercentage)}</span>
                            {inProgress.currentLetterGrade && (
                              <span className="px-1.5 py-0.5 text-xs font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {inProgress.currentLetterGrade}
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Next Assessment</span>
                      <span className="font-medium text-slate-800 truncate max-w-[140px]">
                        {nextAssessment ? nextAssessment.name : 'All Completed'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    {inProgress.isAllCompleted
                      ? 'Final Letter Grade'
                      : remainingCount === 1 && nextAssessment
                      ? `${nextAssessment.name} needed`
                      : `Need for ${course.targetGrade}`}
                  </span>

                  {inProgress.isAllCompleted && inProgress.currentLetterGrade ? (
                    <span className="text-2xl font-bold font-mono tabular-nums text-emerald-600">
                      {inProgress.currentLetterGrade} ({formatPct(inProgress.currentGradePercentage ?? 0)})
                    </span>
                  ) : targetReq ? (
                    <span
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        targetReq.feasibility === 'impossible'
                          ? 'text-rose-600'
                          : targetReq.feasibility === 'secured'
                          ? 'text-emerald-600'
                          : 'text-indigo-600'
                      }`}
                    >
                      {targetReq.feasibility === 'secured'
                        ? 'Secured'
                        : formatPct(targetReq.requiredPercentage)}
                    </span>
                  ) : (
                    <span className="text-sm font-mono text-slate-400">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
