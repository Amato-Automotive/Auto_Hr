import React, { useEffect, useState } from 'react';
import { Check, ClipboardCheck, RefreshCw, X } from 'lucide-react';
import { attendanceApi, type AttendanceCorrectionRequest, type CorrectionRequestState } from '../services/api';

const STATE_STYLES: Record<CorrectionRequestState, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-600 border-red-200',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200',
};

const fmtDate = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const fmtRange = (request: AttendanceCorrectionRequest) =>
  request.startDate.slice(0, 10) === request.endDate.slice(0, 10)
    ? fmtDate(request.startDate)
    : `${fmtDate(request.startDate)} – ${fmtDate(request.endDate)}`;

const describe = (request: AttendanceCorrectionRequest) => {
  const times = [request.checkIn && `in ${request.checkIn}`, request.checkOut && `out ${request.checkOut}`].filter(Boolean).join(', ');
  return `${request.status.replace(/_/g, ' ')}${times ? ` (${times})` : ''}`;
};

/**
 * Attendance correction requests: what the viewer is waiting on, and — for HR and managers —
 * what's waiting on them. One approval (HR or any of the employee's managers) applies it.
 */
export const AttendanceCorrectionRequests: React.FC<{
  canReview: boolean;
  /** Bump to reload, e.g. after the viewer submits a new request. */
  refreshKey: number;
  /** Called after an approval changes someone's attendance. */
  onApproved?: (employeeId: number) => void;
}> = ({ canReview, refreshKey, onApproved }) => {
  const [toReview, setToReview] = useState<AttendanceCorrectionRequest[]>([]);
  const [mine, setMine] = useState<AttendanceCorrectionRequest[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [reviewRes, mineRes] = await Promise.all([
        canReview ? attendanceApi.listCorrections('review') : Promise.resolve(null),
        attendanceApi.listCorrections('mine'),
      ]);
      setToReview(reviewRes?.data?.requests ?? []);
      setMine(mineRes.data?.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load correction requests');
    }
  };

  useEffect(() => {
    void load();
  }, [canReview, refreshKey]);

  const act = async (request: AttendanceCorrectionRequest, action: 'approve' | 'reject' | 'cancel') => {
    setBusyId(request.id);
    setError(null);
    try {
      if (action === 'approve') {
        await attendanceApi.approveCorrection(request.id);
        onApproved?.(request.employeeId);
      } else if (action === 'reject') {
        await attendanceApi.rejectCorrection(request.id, rejectComment.trim() || undefined);
        setRejectingId(null);
        setRejectComment('');
      } else {
        await attendanceApi.cancelCorrection(request.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      // Someone else may have decided first — show the current state.
      await load();
    } finally {
      setBusyId(null);
    }
  };

  // Only recent own requests: pending ones plus the last few decisions.
  const recentMine = mine.filter((r, index) => r.state === 'PENDING' || index < 5);
  if (toReview.length === 0 && recentMine.length === 0 && !error) return null;

  return (
    <div className="bg-white rounded-[32px] p-4 sm:p-6 border border-orange-100/50 shadow-card space-y-5">
      <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
        <ClipboardCheck className="w-5 h-5 text-[#f46617]" />
        Attendance Corrections
      </h3>

      {error && <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}

      {toReview.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Waiting for your approval ({toReview.length})
          </h4>
          {toReview.map(request => (
            <div key={request.id} className="rounded-2xl border border-orange-100 bg-orange-50/20 p-3 sm:p-4 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800">
                    {request.employee.name}
                    {request.employee.department && <span className="text-xs font-semibold text-slate-400"> · {request.employee.department}</span>}
                  </p>
                  <p className="text-xs font-bold text-slate-600 mt-0.5">{fmtRange(request)} → {describe(request)}</p>
                  <p className="text-xs text-slate-500 mt-1 break-words">Reason: {request.reason}</p>
                </div>
                {rejectingId !== request.id && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => act(request, 'approve')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                    >
                      {busyId === request.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => { setRejectingId(request.id); setRejectComment(''); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
              {rejectingId === request.id && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={rejectComment}
                    onChange={e => setRejectComment(e.target.value)}
                    placeholder="Reason for rejecting (optional)"
                    className="flex-1 min-w-0 bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => act(request, 'reject')}
                      className="px-3 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white disabled:opacity-60"
                    >
                      Confirm reject
                    </button>
                    <button type="button" onClick={() => setRejectingId(null)} className="px-3 py-2 text-xs font-bold rounded-xl bg-white border border-slate-200 text-slate-600">
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {recentMine.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">My requests</h4>
          {recentMine.map(request => (
            <div key={request.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border border-slate-100 p-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700">{fmtRange(request)} → {describe(request)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 break-words">
                  {request.state === 'PENDING' && 'Waiting for your manager or HR'}
                  {(request.state === 'APPROVED' || request.state === 'REJECTED') &&
                    `${request.state === 'APPROVED' ? 'Approved' : 'Rejected'} by ${request.reviewedBy?.employee?.name ?? request.reviewedBy?.username ?? 'a reviewer'}${request.reviewComment ? ` — ${request.reviewComment}` : ''}`}
                  {request.state === 'CANCELLED' && 'You cancelled this request'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATE_STYLES[request.state]}`}>
                  {request.state}
                </span>
                {request.state === 'PENDING' && (
                  <button
                    type="button"
                    disabled={busyId === request.id}
                    onClick={() => act(request, 'cancel')}
                    className="text-[11px] font-bold text-slate-500 hover:text-red-600 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
};
