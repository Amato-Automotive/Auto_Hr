import React, { useEffect, useState } from 'react';
import { GraduationCap, Plus, Loader2, Clock, BookOpen, Lock, CheckCircle, PlayCircle, UserPlus, Trophy, Check, X, Hourglass, Send, Settings } from 'lucide-react';
import { learningApi, type Course, type CourseDetail, type Enrollment, type UserRole } from '../services/api';
import { CourseComposer } from './CourseComposer';
import { CourseDetailView } from './CourseDetailView';
import { AssignCourseDialog } from './AssignCourseDialog';
import { NominateDialog } from './NominateDialog';
import { matchesDateFilter, matchesSearch, type PageFilterState } from '../utils/pageFilters';

interface LearningCatalogPanelProps {
  role: UserRole;
  departments: string[];
  filters?: PageFilterState;
}

const MANAGEMENT_ROLES: UserRole[] = ['HR', 'LEADERSHIP', 'MANAGER'];

const STATE_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-50 text-slate-500 border border-slate-100',
  PUBLISHED: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
  UNPUBLISHED: 'bg-amber-50 text-amber-600 border border-amber-100',
  ARCHIVED: 'bg-slate-50 text-slate-400 border border-slate-100',
};

export const LearningCatalogPanel: React.FC<LearningCatalogPanelProps> = ({ role, departments, filters }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [activeEnrollmentId, setActiveEnrollmentId] = useState<number | null>(null);
  const [assigningCourse, setAssigningCourse] = useState<Course | null>(null);
  const [nominatingCourse, setNominatingCourse] = useState<Course | null>(null);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [editingCourse, setEditingCourse] = useState<CourseDetail | null>(null);
  const [managingId, setManagingId] = useState<number | null>(null);

  const loadAll = () => {
    setLoading(true);
    Promise.allSettled([learningApi.listCourses(), learningApi.getMyEnrollments()])
      .then(([coursesRes, enrollRes]) => {
        if (coursesRes.status === 'fulfilled' && coursesRes.value.data) setCourses(coursesRes.value.data.courses);
        if (enrollRes.status === 'fulfilled' && enrollRes.value.data) setEnrollments(enrollRes.value.data.enrollments);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

  const isHR = role === 'HR';
  const canAssign = MANAGEMENT_ROLES.includes(role);

  const handleEnroll = async (courseId: number) => {
    setEnrollingId(courseId);
    try {
      await learningApi.enroll(courseId);
      loadAll();
    } catch {
      // non-critical for Phase 1
    } finally {
      setEnrollingId(null);
    }
  };

  const enrollmentFor = (courseId: number) => enrollments.find(e => e.courseId === courseId);
  const filteredCourses = filters
    ? courses.filter(course =>
        matchesSearch(filters.search, [
          course.title,
          course.description,
          course.category,
          course.skillTags,
          course.language,
          course.state,
          course.targetDepartment,
          course.createdBy?.username,
          course.durationMinutes,
          course.modules?.length,
        ]) && matchesDateFilter(filters, [course.createdAt, course.updatedAt])
      )
    : courses;

  const handleRespond = async (enrollmentId: number, accept: boolean) => {
    setRespondingId(enrollmentId);
    try {
      if (accept) await learningApi.acceptCourseNomination(enrollmentId);
      else await learningApi.declineCourseNomination(enrollmentId);
      loadAll();
    } catch {
      // non-critical
    } finally {
      setRespondingId(null);
    }
  };

  const handleManage = async (courseId: number) => {
    setManagingId(courseId);
    try {
      const res = await learningApi.getCourse(courseId);
      if (res.data?.course) setEditingCourse(res.data.course);
    } finally {
      setManagingId(null);
    }
  };

  if (activeEnrollmentId) {
    return (
      <CourseDetailView
        enrollmentId={activeEnrollmentId}
        onBack={() => { setActiveEnrollmentId(null); loadAll(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Browse and enroll in available courses</p>
        {isHR && (
          <button
            onClick={() => setShowComposer(true)}
            className="btn-orange px-4 py-2.5 text-xs font-bold rounded-2xl whitespace-nowrap flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> New Course
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#f46617] animate-spin" />
        </div>
      ) : courses.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No courses yet</p>
          {isHR && <p className="text-xs mt-1">Click "New Course" to create the first one.</p>}
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No courses match the filters</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map(course => {
            const enrollment = enrollmentFor(course.id);
            return (
              <div
                key={course.id}
                className="bg-white rounded-[24px] border border-orange-100/50 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col"
              >
                <div className="h-24 sm:h-32 bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center overflow-hidden">
                  {course.thumbnailUrl ? (
                    <img src={course.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <BookOpen className="w-10 h-10 text-orange-300" />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${STATE_BADGE[course.state]}`}>
                      {course.state}
                    </span>
                    {course.mandatory && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-red-50 text-red-500 border border-red-100">
                        <Lock className="w-2.5 h-2.5" /> Mandatory
                      </span>
                    )}
                    {course.autoAssign && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                        <UserPlus className="w-2.5 h-2.5" /> Auto-Assign
                      </span>
                    )}
                    {course.enableRanking && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                        <Trophy className="w-2.5 h-2.5" /> Ranked
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 leading-snug mb-1">{course.title}</h3>
                  {course.description && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">{course.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-semibold mb-3">
                    {course.durationMinutes && (
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {course.durationMinutes} min</span>
                    )}
                    <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" /> {course.modules?.length ?? 0} modules</span>
                  </div>

                  <div className="mt-auto space-y-2">
                    {enrollment?.status === 'NOMINATED' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespond(enrollment.id, true)}
                          disabled={respondingId === enrollment.id}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100 transition-colors"
                        >
                          {respondingId === enrollment.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespond(enrollment.id, false)}
                          disabled={respondingId === enrollment.id}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> Decline
                        </button>
                      </div>
                    ) : enrollment?.status === 'PENDING_APPROVAL' ? (
                      <span className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full bg-amber-50 text-amber-600 border border-amber-100">
                        <Hourglass className="w-3.5 h-3.5" /> Awaiting Approval
                      </span>
                    ) : enrollment?.status === 'REJECTED' ? (
                      <span className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full bg-slate-50 text-slate-400 border border-slate-200">
                        <X className="w-3.5 h-3.5" /> Not Approved
                      </span>
                    ) : enrollment ? (
                      <button
                        onClick={() => setActiveEnrollmentId(enrollment.id)}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full justify-center transition-colors ${
                          enrollment.status === 'COMPLETED'
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100'
                            : 'bg-orange-50 hover:bg-orange-100 text-[#f46617] border border-orange-100'
                        }`}
                      >
                        {enrollment.status === 'COMPLETED' ? <CheckCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        {enrollment.status === 'COMPLETED' ? 'Completed' : enrollment.status === 'IN_PROGRESS' ? 'Continue' : 'Start'}
                      </button>
                    ) : course.state === 'PUBLISHED' ? (
                      <button
                        onClick={() => handleEnroll(course.id)}
                        disabled={enrollingId === course.id}
                        className="btn-orange px-3 py-2 text-xs font-bold rounded-xl w-full justify-center"
                      >
                        {enrollingId === course.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {course.requiresApproval ? 'Request to Enroll' : 'Enroll'}
                      </button>
                    ) : null}

                    {canAssign && course.state === 'PUBLISHED' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAssigningCourse(course)}
                          className="flex-1 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl justify-center bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Assign
                        </button>
                        <button
                          onClick={() => setNominatingCourse(course)}
                          className="flex-1 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl justify-center bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" /> Nominate
                        </button>
                      </div>
                    )}

                    {isHR && (
                      <button
                        onClick={() => handleManage(course.id)}
                        disabled={managingId === course.id}
                        className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full justify-center bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 transition-colors"
                      >
                        {managingId === course.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />}
                        Manage
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showComposer && (
        <CourseComposer
          departments={departments}
          onClose={() => setShowComposer(false)}
          onSaved={() => { setShowComposer(false); loadAll(); }}
        />
      )}

      {editingCourse && (
        <CourseComposer
          departments={departments}
          editingCourse={editingCourse}
          onClose={() => setEditingCourse(null)}
          onSaved={() => { setEditingCourse(null); loadAll(); }}
        />
      )}

      {assigningCourse && (
        <AssignCourseDialog
          course={assigningCourse}
          onClose={() => setAssigningCourse(null)}
          onAssigned={loadAll}
        />
      )}

      {nominatingCourse && (
        <NominateDialog
          target={{ type: 'course', id: nominatingCourse.id, title: nominatingCourse.title }}
          onClose={() => setNominatingCourse(null)}
          onNominated={loadAll}
        />
      )}
    </div>
  );
};
