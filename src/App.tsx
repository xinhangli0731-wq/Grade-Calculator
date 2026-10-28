import { useState, useEffect } from 'react';
import { Course, ParsedSyllabusResponse } from './types/course';
import { Navbar, ActiveNavTab } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { AddCourseView } from './components/AddCourseView';
import { ReviewCourseView } from './components/ReviewCourseView';
import { CourseDetailView } from './components/CourseDetailView';
import { FormulaGuideView } from './components/FormulaGuideView';

type AppScreen =
  | { type: 'dashboard' }
  | { type: 'add-course' }
  | {
      type: 'review-course';
      parsedData: ParsedSyllabusResponse;
      editingCourse?: Course | null;
    }
  | { type: 'course-detail'; courseId: string }
  | { type: 'how-it-works' };

const STORAGE_KEY = 'course_grade_planner_courses_v3';

export default function App() {
  const [courses, setCourses] = useState<Course[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });

  const [screen, setScreen] = useState<AppScreen>({ type: 'dashboard' });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
    } catch {
      // Ignore storage quota errors
    }
  }, [courses]);

  const handleNavigateTab = (tab: ActiveNavTab) => {
    if (tab === 'dashboard') {
      setScreen({ type: 'dashboard' });
    } else if (tab === 'add-course') {
      setScreen({ type: 'add-course' });
    } else if (tab === 'how-it-works') {
      setScreen({ type: 'how-it-works' });
    }
  };

  const handleOpenFirstCourseCalculator = () => {
    if (courses.length > 0) {
      setScreen({ type: 'course-detail', courseId: courses[0].id });
    } else {
      setScreen({ type: 'add-course' });
    }
  };

  const handleUpdateCourse = (updatedCourse: Course) => {
    setCourses((prev) =>
      prev.map((c) => (c.id === updatedCourse.id ? updatedCourse : c))
    );
  };

  const handleRenameCourse = (courseId: string, newCode: string) => {
    setCourses((prev) =>
      prev.map((c) => (c.id === courseId ? { ...c, courseCode: newCode } : c))
    );
  };

  const handleConfirmCourseFromReview = (confirmedCourse: Course) => {
    setCourses((prev) => {
      const exists = prev.some((c) => c.id === confirmedCourse.id);
      if (exists) {
        return prev.map((c) => (c.id === confirmedCourse.id ? confirmedCourse : c));
      }
      return [confirmedCourse, ...prev];
    });
    setScreen({ type: 'course-detail', courseId: confirmedCourse.id });
  };

  const handleDeleteCourse = (courseId: string) => {
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
    if (screen.type === 'course-detail' && screen.courseId === courseId) {
      setScreen({ type: 'dashboard' });
    }
  };

  const handleUpdateTargetGradeOnDashboard = (courseId: string, newTarget: string) => {
    setCourses((prev) =>
      prev.map((c) => (c.id === courseId ? { ...c, targetGrade: newTarget } : c))
    );
  };

  const activeNavTab: ActiveNavTab =
    screen.type === 'add-course' || screen.type === 'review-course'
      ? 'add-course'
      : screen.type === 'how-it-works'
      ? 'how-it-works'
      : 'dashboard';

  const selectedCourse =
    screen.type === 'course-detail'
      ? courses.find((c) => c.id === screen.courseId) || null
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      <Navbar
        activeTab={activeNavTab}
        onNavigate={handleNavigateTab}
        onOpenFirstCourseCalculator={handleOpenFirstCourseCalculator}
        courseCount={courses.length}
      />

      <main className="flex-1">
        {screen.type === 'dashboard' && (
          <DashboardView
            courses={courses}
            onSelectCourse={(courseId) =>
              setScreen({ type: 'course-detail', courseId })
            }
            onAddCourse={() => setScreen({ type: 'add-course' })}
            onDeleteCourse={handleDeleteCourse}
            onUpdateTargetGrade={handleUpdateTargetGradeOnDashboard}
            onRenameCourse={handleRenameCourse}
          />
        )}

        {screen.type === 'add-course' && (
          <AddCourseView
            onBack={() => setScreen({ type: 'dashboard' })}
            onParsedSuccess={(parsedData) =>
              setScreen({
                type: 'review-course',
                parsedData,
                editingCourse: null,
              })
            }
            onManualStart={() =>
              setScreen({
                type: 'review-course',
                parsedData: {
                  courseCode: '',
                  courseTitle: '',
                  gradeScaleFound: false,
                  components: [
                    { name: 'Homework', weight: 10, categoryType: 'non-exam', maxPoints: 100 },
                    { name: 'Quiz 1', weight: 10, categoryType: 'exam', maxPoints: 100 },
                    { name: 'Midterm 1', weight: 25, categoryType: 'exam', maxPoints: 100 },
                    { name: 'Midterm 2', weight: 25, categoryType: 'exam', maxPoints: 100 },
                    { name: 'Final Exam', weight: 30, categoryType: 'exam', maxPoints: 100 },
                  ],
                  gradeScale: [],
                },
                editingCourse: null,
              })
            }
          />
        )}

        {screen.type === 'review-course' && (
          <ReviewCourseView
            initialData={screen.parsedData}
            existingCourse={screen.editingCourse}
            onBack={() => {
              if (screen.editingCourse) {
                setScreen({
                  type: 'course-detail',
                  courseId: screen.editingCourse.id,
                });
              } else {
                setScreen({ type: 'add-course' });
              }
            }}
            onConfirmCourse={handleConfirmCourseFromReview}
          />
        )}

        {screen.type === 'course-detail' && selectedCourse && (
          <CourseDetailView
            course={selectedCourse}
            onBack={() => setScreen({ type: 'dashboard' })}
            onUpdateCourse={handleUpdateCourse}
            onEditStructure={() =>
              setScreen({
                type: 'review-course',
                parsedData: {
                  courseCode: selectedCourse.courseCode,
                  courseTitle: selectedCourse.courseTitle,
                  examDropCount: selectedCourse.examDropCount,
                  gradeScaleFound: selectedCourse.gradeScaleFoundInSyllabus,
                  components: selectedCourse.components.map((c) => ({
                    name: c.name,
                    weight: c.weight,
                    categoryType: c.categoryType,
                    maxPoints: c.maxPoints,
                    canBeDropped: c.canBeDropped,
                    notes: c.notes,
                  })),
                  gradeScale: selectedCourse.gradeScale
                    .filter((g): g is { letter: string; minPercentage: number } => g.minPercentage !== null)
                    .map((g) => ({
                      letter: g.letter,
                      minPercentage: g.minPercentage,
                    })),
                  policyNotes: selectedCourse.policyNotes,
                },
                editingCourse: selectedCourse,
              })
            }
          />
        )}

        {screen.type === 'how-it-works' && (
          <FormulaGuideView
            onBack={() => setScreen({ type: 'dashboard' })}
            onAddCourse={() => setScreen({ type: 'add-course' })}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 px-6 mt-16">
        <div className="max-w-[1000px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>Course Grade Planner · Syllabus Parsing & Exam Score Calculator</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setScreen({ type: 'dashboard' })}
              className="hover:text-indigo-600 transition-colors cursor-pointer"
            >
              Dashboard
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setScreen({ type: 'add-course' })}
              className="hover:text-indigo-600 transition-colors cursor-pointer"
            >
              Add Course
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setScreen({ type: 'how-it-works' })}
              className="hover:text-indigo-600 transition-colors cursor-pointer"
            >
              About
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
