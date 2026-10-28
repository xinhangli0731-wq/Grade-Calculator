import React from 'react';

export type ActiveNavTab = 'dashboard' | 'add-course' | 'how-it-works';

interface NavbarProps {
  activeTab: ActiveNavTab;
  onNavigate: (tab: ActiveNavTab) => void;
  onOpenFirstCourseCalculator: () => void;
  courseCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onNavigate,
  onOpenFirstCourseCalculator,
}) => {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-white/95 backdrop-blur-xs border-b border-slate-200/80">
      {/* Zone 1: Brand wordmark */}
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className="text-base font-bold tracking-tight text-indigo-950 font-display whitespace-nowrap shrink-0 cursor-pointer"
      >
        Course Grade Planner
      </button>

      {/* Zone 2: Concise navigation links */}
      <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-500">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className={`hover:text-indigo-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'dashboard' ? 'text-indigo-600 font-semibold' : ''
          }`}
        >
          Courses
        </button>
        <button
          type="button"
          onClick={() => onNavigate('add-course')}
          className={`hover:text-indigo-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'add-course' ? 'text-indigo-600 font-semibold' : ''
          }`}
        >
          Add Course
        </button>
        <button
          type="button"
          onClick={onOpenFirstCourseCalculator}
          className="hover:text-indigo-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Calculator
        </button>
        <button
          type="button"
          onClick={() => onNavigate('how-it-works')}
          className={`hover:text-indigo-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'how-it-works' ? 'text-indigo-600 font-semibold' : ''
          }`}
        >
          About
        </button>
      </nav>

      {/* Zone 3: Primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={() => onNavigate('add-course')}
          className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          + Add Course
        </button>
      </div>
    </header>
  );
};
