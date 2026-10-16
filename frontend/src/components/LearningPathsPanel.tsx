import React, { useEffect, useState } from 'react';
import { Route, Plus, Loader2, Lock, CheckCircle, PlayCircle, UserPlus, BookOpen, Check, X, Hourglass, Send } from 'lucide-react';
import { learningApi, type LearningPath, type PathEnrollmentDetail, type UserRole } from '../services/api';
import { LearningPathComposer } from './LearningPathComposer';
import { AssignPathDialog } from './AssignPathDialog';
import { NominateDialog } from './NominateDialog';
import { CourseDetailView } from './CourseDetailView';
import { matchesDateFilter, matchesSearch, type PageFilterState } from '../utils/pageFilters';

interface LearningPathsPanelProps {
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

export const LearningPathsPanel: React.FC<LearningPathsPanelProps> = ({ role, departments, filters }) => {
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [pathEnrollments, setPathEnrollments] = useState<PathEnrollmentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [enrollingId, setEnrollingId] = useState<number | null>(null);
  const [assigningPath, setAssigningPath] = useState<LearningPath | null>(null);
  const [nominatingPath, setNominatingPath] = useState<LearningPath | null>(null);
  const [activeCourseEnrollmentId, setActiveCourseEnrollmentId] = useState<number | null>(null);
  const [viewingPathId, setViewingPathId] = useState<number | null>(null);
  const [respondingId, setRespondingId] = useState<number | null>(null);

  const loadAll = () => {
    setLoading(true);
    Promise.allSettled([learningApi.listPaths(), learningApi.getMyPathEnrollments()])
      .then(([pathsRes, peRes]) => {
        if (pathsRes.status === 'fulfilled' && pathsRes.value.data) setPaths(pathsRes.value.data.paths);
        if (peRes.status === 'fulfilled' && peRes.value.data) setPathEnrollments(peRes.value.data.pathEnrollments);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

  const isHR = role === 'HR';
  const canAssign = MANAGEMENT_ROLES.includes(role);

  const handleEnroll = async (pathId: number) => {
    setEnrollingId(pathId);
    try {
      await learningApi.enrollPath(pathId);
      loadAll();
    } catch {
      // non-critical
    } finally {
      setEnrollingId(null);
    }
  };

  const pathEnrollmentFor = (pathId: number) => pathEnrollments.find(pe => pe.pathId === pathId);
  const filteredPaths = filters
    ? paths.filter(path =>
        matchesSearch(filters.search, [
          path.title,
          path.description,
          path.state,
          path.targetDepartment,
          path.navigationMode,
          path.createdBy?.username,
          path.courses?.map(pc => pc.course.title).join(' '),
        ]) && matchesDateFilter(filters, [path.createdAt, path.updatedAt])
      )
    : paths;

  const handleRespond = async (pathEnrollmentId: number, accept: boolean) => {
    setRespondingId(pathEnrollmentId);
    try {
      if (accept) await learningApi.acceptPathNomination(pathEnrollmentId);
      else await learningApi.declinePathNomination(pathEnrollmentId);
      loadAll();
    } catch {
      // non-critical
    } finally {
      setRespondingId(null);
    }
  };

  if (activeCourseEnrollmentId) {
    return (
      <CourseDetailView
        enrollmentId={activeCourseEnrollmentId}
        onBack={() => { setActiveCourseEnrollmentId(null); loadAll(); }}
      />
    );
  }

  if (viewingPathId) {
    const pe = pathEnrollments.find(p => p.pathId === viewingPathId);
    if (pe) {
      return (
        <div className="space-y-6">
          <button onClick={() => setViewingPathId(null)} className="text-xs font-bold text-slate-500 hover:text-slate-700">
            ← Back to Paths
          </button>
          <div>
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">{pe.path.title}</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
              {pe.path.navigationMode === 'SEQUENTIAL' ? 'Complete in order' : 'Complete in any order'}
            </p>
          </div>
          <div className="space-y-3">
            {pe.path.courses.map((pc, i) => {
              const status = pc.enrollmentStatus ?? 'NOT_STARTED';
              const locked = pe.path.navigationMode === 'SEQUENTIAL' && status === 'NOT_STARTED' &&
                pe.path.courses.slice(0, i).some(prior => (prior.enrollmentStatus ?? 'NOT_STARTED') !== 'COMPLETED');
              return (
                <div key={pc.id} className="bg-white rounded-[24px] border border-orange-100/50 shadow-sm p-5 flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-400 w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{pc.course.title}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">{status.replace('_', ' ')}</p>
                  </div>
                  {locked ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-400 px-3 py-2">
                      <Lock className="w-3.5 h-3.5" /> Locked
                    </span>
                  ) : (
                    <button
                      onClick={async () => {
                        if (status === 'NOT_STARTED') await learningApi.enroll(pc.courseId);
                        const res = await learningApi.getMyEnrollments();
                        const enrollment = res.data?.enrollments.find(e => e.courseId === pc.courseId);
                        if (enrollment) setActiveCourseEnrollmentId(enrollment.id);
                      }}
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-colors ${
                        status === 'COMPLETED'
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100'
                          : 'bg-orange-50 hover:bg-orange-100 text-[#f46617] border border-orange-100'
                      }`}
                    >
                      {status === 'COMPLETED' ? <CheckCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                      {status === 'COMPLETED' ? 'Review' : status === 'IN_PROGRESS' ? 'Continue' : 'Start'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Sequenced course bundles for a learning goal</p>
        {isHR && (
          <button
            onClick={() => setShowComposer(true)}
            className="btn-orange px-4 py-2.5 text-xs font-bold rounded-2xl whitespace-nowrap flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> New Path
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#f46617] animate-spin" />
        </div>
      ) : paths.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <Route className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No learning paths yet</p>
          {isHR && <p className="text-xs mt-1">Click "New Path" to bundle courses into a curriculum.</p>}
        </div>
      ) : filteredPaths.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <Route className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No learning paths match the filters</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPaths.map(path => {
            const pathEnrollment = pathEnrollmentFor(path.id);
            return (
              <div key={path.id} className="bg-white rounded-[24px] border border-orange-100/50 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col">
                <div className="h-24 sm:h-32 bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center overflow-hidden">
                  {path.thumbnailUrl ? (
                    <img src={path.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Route className="w-10 h-10 text-orange-300" />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${STATE_BADGE[path.state]}`}>
                      {path.state}
                    </span>
                    {path.mandatory && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-red-50 text-red-500 border border-red-100">
                        <Lock className="w-2.5 h-2.5" /> Mandatory
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 leading-snug mb-1">{path.title}</h3>
                  {path.description && (
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">{path.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-semibold mb-3">
                    <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" /> {path.courses.length} courses</span>
                  </div>

                  <div className="mt-auto space-y-2">
                    {pathEnrollment?.status === 'NOMINATED' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespond(pathEnrollment.id, true)}
                          disabled={respondingId === pathEnrollment.id}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100 transition-colors"
                        >
                          {respondingId === pathEnrollment.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespond(pathEnrollment.id, false)}
                          disabled={respondingId === pathEnrollment.id}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> Decline
                        </button>
                      </div>
                    ) : pathEnrollment?.status === 'PENDING_APPROVAL' ? (
                      <span className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full bg-amber-50 text-amber-600 border border-amber-100">
                        <Hourglass className="w-3.5 h-3.5" /> Awaiting Approval
                      </span>
                    ) : pathEnrollment?.status === 'REJECTED' ? (
                      <span className="inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full bg-slate-50 text-slate-400 border border-slate-200">
                        <X className="w-3.5 h-3.5" /> Not Approved
                      </span>
                    ) : pathEnrollment ? (
                      <button
                        onClick={() => setViewingPathId(path.id)}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl w-full justify-center transition-colors ${
                          pathEnrollment.status === 'COMPLETED'
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100'
                            : 'bg-orange-50 hover:bg-orange-100 text-[#f46617] border border-orange-100'
                        }`}
                      >
                        {pathEnrollment.status === 'COMPLETED' ? <CheckCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                        {pathEnrollment.status === 'COMPLETED' ? 'Completed' : pathEnrollment.status === 'IN_PROGRESS' ? 'Continue' : 'Start'}
                      </button>
                    ) : path.state === 'PUBLISHED' ? (
                      <button
                        onClick={() => handleEnroll(path.id)}
                        disabled={enrollingId === path.id}
                        className="btn-orange px-3 py-2 text-xs font-bold rounded-xl w-full justify-center"
                      >
                        {enrollingId === path.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {path.requiresApproval ? 'Request to Enroll' : 'Enroll'}
                      </button>
                    ) : null}

                    {canAssign && path.state === 'PUBLISHED' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAssigningPath(path)}
                          className="flex-1 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl justify-center bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Assign
                        </button>
                        <button
                          onClick={() => setNominatingPath(path)}
                          className="flex-1 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl justify-center bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" /> Nominate
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showComposer && (
        <LearningPathComposer
          departments={departments}
          onClose={() => setShowComposer(false)}
          onSaved={() => { setShowComposer(false); loadAll(); }}
        />
      )}

      {assigningPath && (
        <AssignPathDialog
          path={assigningPath}
          onClose={() => setAssigningPath(null)}
          onAssigned={loadAll}
        />
      )}

      {nominatingPath && (
        <NominateDialog
          target={{ type: 'path', id: nominatingPath.id, title: nominatingPath.title }}
          onClose={() => setNominatingPath(null)}
          onNominated={loadAll}
        />
      )}
    </div>
  );
};
