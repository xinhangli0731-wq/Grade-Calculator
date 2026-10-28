import React from 'react';
import { ArrowLeft, Plus } from 'lucide-react';

interface FormulaGuideViewProps {
  onBack: () => void;
  onAddCourse: () => void;
}

export const FormulaGuideView: React.FC<FormulaGuideViewProps> = ({
  onBack,
  onAddCourse,
}) => {
  return (
    <div className="max-w-[840px] mx-auto px-6 py-10">
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Courses
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-8">
        <div className="pb-6 border-b border-slate-200">
          <p className="text-xs font-medium text-slate-500 mb-1">
            Grading Policy & Calculation Methodology
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-display">
            How Course Grade Planner Calculates Your Target Scores
          </h1>
          <p className="text-sm text-slate-600 mt-2">
            Every syllabus uses different assessment weights, point totals, and letter grade cutoffs. Here is how our engine normalizes your scores and solves for your remaining exams.
          </p>
        </div>

        <div className="space-y-6 text-sm text-slate-700">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-display">
              01. Weighted Course Grade Formula
            </h2>
            <p className="mt-1 text-slate-600">
              Your overall course percentage is the weighted sum of each assessment’s percentage score multiplied by its syllabus weight:
            </p>
            <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-900 tabular-nums">
              Final Grade = Σ (Assessment Score % × Assessment Weight %)
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200">
            <h2 className="text-base font-bold text-slate-900 font-display">
              02. Automatic Normalization to Percentage (100-Point Scale)
            </h2>
            <p className="mt-1 text-slate-600">
              Not every exam is graded out of 100 points. If Midterm 1 is out of 50 points and you score 45, you can enter <span className="font-mono font-semibold text-slate-900">45 / 50</span> directly. The planner converts all scores to percentages (<span className="font-mono font-semibold text-slate-900">45 / 50 → 90.0%</span>) and also displays required future exam scores in both points and percentages.
            </p>
          </div>

          <div className="pt-6 border-t border-slate-200">
            <h2 className="text-base font-bold text-slate-900 font-display">
              03. Mode 1 (Before Semester) vs. Mode 2 (Semester In Progress)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="font-bold text-slate-900 font-display">
                  Mode 1: Before the Semester
                </p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Assumes non-exam coursework (Homework, Attendance, Labs) earns 100% by default (adjustable via slider) and solves for the average score and individual exam scores needed for an A+, A, A-, or B+.
                </p>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="font-bold text-slate-900 font-display">
                  Mode 2: Semester In Progress & What-If
                </p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Locks in your completed grades, calculates your live Current Grade, and lets you type hypothetical What-If scores on upcoming exams to see how they change your Final Exam requirement.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Return to Dashboard
          </button>
          <button
            type="button"
            onClick={onAddCourse}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Upload a Syllabus Now
          </button>
        </div>
      </div>
    </div>
  );
};
