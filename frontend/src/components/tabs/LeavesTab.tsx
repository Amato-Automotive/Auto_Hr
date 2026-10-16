import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, Calendar, CheckCircle, XCircle, Clock,
  Plus, X, AlertTriangle, Loader2, Send, Info
} from 'lucide-react';
import { leaveApi, employeeApi, holidayApi, type Leave, type EmployeeDetail, type UserRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  isShortLeave, formatLeaveDuration, SHORT_LEAVE_MORNING, SHORT_LEAVE_EVENING,
  SHORT_LEAVE_HOURS, SHORT_LEAVES_PER_MONTH, SHORT_LEAVE_WINDOWS,
} from '../../utils/leaveRules';

/* ─── Types & Constants ────────────────────────────────────── */

interface LeavesTabProps {
  leaves: Leave[];
  employee: EmployeeDetail;
  isHR: boolean;
  onRefresh: () => void;
  theme?: 'dark' | 'light';
}

interface Approver {
  userId: number;
  employeeId: number;
  name: string;
  role: UserRole;
  position: string | null;
  department: string | null;
}

const LEAVE_TYPES = [
  { value: 'Casual Leave', label: 'Casual Leave', consumesQuota: true, color: '#6366f1', bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/20' },
  { value: 'Medical Leave', label: 'Medical / Sick Leave', consumesQuota: true, color: '#8b5cf6', bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/20' },
  { value: 'Earned Leave', label: 'Earned Leave', consumesQuota: true, color: '#06b6d4', bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  { value: 'Comp Off', label: 'Comp Off', consumesQuota: false, color: '#f59e0b', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  { value: 'Unpaid Leave', label: 'Unpaid Leave', consumesQuota: false, color: '#ef4444', bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' },
  { value: SHORT_LEAVE_MORNING, label: 'Short Leave — Morning (9:30–11:30 AM)', consumesQuota: false, color: '#14b8a6', bg: 'bg-teal-500/15', text: 'text-teal-500', border: 'border-teal-500/20' },
  { value: SHORT_LEAVE_EVENING, label: 'Short Leave — Evening (4:00–6:00 PM)', consumesQuota: false, color: '#0d9488', bg: 'bg-teal-600/15', text: 'text-teal-600', border: 'border-teal-600/20' },
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* ─── Utility Helpers ──────────────────────────────────────── */

const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const getFirstDay = (y: number, m: number) => new Date(y, m, 1).getDay();

const fmtKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const getTodayKey = () => {
  const n = new Date();
  return fmtKey(n.getFullYear(), n.getMonth(), n.getDate());
};

/** Leave days charged: Mon–Sat, skipping company holidays (the server applies the same rule). */
const workingDayCount = (s: string, e: string, holidays: Record<string, string>) => {
  let count = 0;
  for (const d = new Date(s + 'T00:00:00Z'); d <= new Date(e + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && !holidays[d.toISOString().slice(0, 10)]) count++;
  }
  return count;
};

const fmtDisplay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/* ─── Main Component ───────────────────────────────────────── */

const LeavesTab: React.FC<LeavesTabProps> = ({ leaves, employee, isHR: _isHR, onRefresh, theme = 'dark' }) => {
  const { user } = useAuth();
  const isOwnProfile = user?.employeeId === employee.id;
  const isLight = theme === 'light';

  // ── Calendar navigation state ─────────────────────────────
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(now.getFullYear());

  // ── Apply mode state ──────────────────────────────────────
  const [applyMode, setApplyMode] = useState(false);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // ── Apply dialog state ────────────────────────────────────
  const [showDialog, setShowDialog] = useState(false);
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0].value);
  const [reason, setReason] = useState('');
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [selectedApprovers, setSelectedApprovers] = useState<number[]>([]);
  const [loadingApprovers, setLoadingApprovers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // ── Company holidays for the year on screen ───────────────
  const [holidayNames, setHolidayNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    holidayApi.list(viewYear)
      .then(res => {
        if (cancelled) return;
        setHolidayNames(Object.fromEntries((res.data ?? []).map(h => [h.date.slice(0, 10), h.name])));
      })
      .catch(() => { /* calendar still works without holiday labels */ });
    return () => { cancelled = true; };
  }, [viewYear]);

  // ── Tooltip state ─────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ leave: Leave; rect: DOMRect } | null>(null);

  // ── Derived: only this employee's leaves ──────────────────
  const myLeaves = useMemo(
    () => leaves.filter(l => l.employeeId === employee.id),
    [leaves, employee.id],
  );

  // ── Derived: date → leave[] lookup map ────────────────────
  const leaveMap = useMemo(() => {
    const map: Record<string, Leave[]> = {};
    myLeaves.forEach(lv => {
      const sd = new Date(lv.startDate.split('T')[0] + 'T00:00:00');
      const ed = new Date(lv.endDate.split('T')[0] + 'T00:00:00');
      for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
        const key = fmtKey(d.getFullYear(), d.getMonth(), d.getDate());
        (map[key] ??= []).push(lv);
      }
    });
    return map;
  }, [myLeaves]);

  // ── Derived: paid leave balance ───────────────────────────
  const paidBalance = useMemo(() => {
    const jd = employee.joinDate ? new Date(employee.joinDate) : new Date();
    const n = new Date();
    // Months since join date (inclusive of current month)
    let months =
      (n.getFullYear() - jd.getFullYear()) * 12 +
      (n.getMonth() - jd.getMonth());
    months = Math.max(months + 1, 1); // at least 1 month (current)
    const total = months * 2; // 2 paid leaves per month

    // Used = days in APPROVED or PENDING leaves that consume quota
    const used = myLeaves
      .filter(
        l =>
          (l.status === 'APPROVED' || l.status === 'PENDING') &&
          LEAVE_TYPES.find(t => t.value === l.type)?.consumesQuota,
      )
      .reduce((s, l) => s + l.days, 0);

    return { total, used, remaining: total - used };
  }, [myLeaves, employee.joinDate]);

  // ── Derived: summary stats ────────────────────────────────
  const stats = useMemo(
    () => ({
      total: myLeaves.length,
      approvedDays: myLeaves
        .filter(l => l.status === 'APPROVED')
        .reduce((s, l) => s + l.days, 0),
      pending: myLeaves.filter(l => l.status === 'PENDING').length,
      rejected: myLeaves.filter(l => l.status === 'REJECTED').length,
    }),
    [myLeaves],
  );

  // ── Derived: this employee's reporting managers ─────────
  // Legacy single managerId plus every "Reports to" link from the profile.
  const managerEmployeeIds = useMemo(() => {
    const ids = new Set<number>();
    if (employee.managerId) ids.add(employee.managerId);
    for (const link of employee.managers ?? []) ids.add(link.manager.id);
    return ids;
  }, [employee.managerId, employee.managers]);

  // ── Derived: visible approvers (reporting managers + HR/Leadership) ─
  const visibleApprovers = useMemo(() => {
    return approvers
      .filter(a => {
        // Always include HR and leadership users
        if (a.role === 'HR' || a.role === 'LEADERSHIP') return true;
        // Include the people this employee reports to
        return managerEmployeeIds.has(a.employeeId);
      })
      // Reporting managers first, then HR / Leadership
      .sort((a, b) => Number(managerEmployeeIds.has(b.employeeId)) - Number(managerEmployeeIds.has(a.employeeId)));
  }, [approvers, managerEmployeeIds]);

  // ── Calendar grid cells ───────────────────────────────────
  const cells = useMemo(() => {
    const dim = getDaysInMonth(viewYear, viewMonth);
    const fd = getFirstDay(viewYear, viewMonth);
    const arr: { key: string; day: number; current: boolean }[] = [];

    // Previous month filler
    const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
    const prevDim = getDaysInMonth(prevY, prevM);
    for (let i = fd - 1; i >= 0; i--) {
      arr.push({ key: fmtKey(prevY, prevM, prevDim - i), day: prevDim - i, current: false });
    }

    // Current month days
    for (let d = 1; d <= dim; d++) {
      arr.push({ key: fmtKey(viewYear, viewMonth, d), day: d, current: true });
    }

    // Next month filler (to fill 6 rows = 42 cells)
    const rem = 42 - arr.length;
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
    for (let d = 1; d <= rem; d++) {
      arr.push({ key: fmtKey(nextY, nextM, d), day: d, current: false });
    }
    return arr;
  }, [viewYear, viewMonth]);

  // ── Helpers ───────────────────────────────────────────────

  const isBlocked = useCallback(
    (key: string) => {
      if (key < getTodayKey()) return true;
      return (leaveMap[key] || []).some(
        l => l.status === 'PENDING' || l.status === 'APPROVED',
      );
    },
    [leaveMap],
  );

  const getDayStatus = (key: string): 'APPROVED' | 'PENDING' | 'REJECTED' | null => {
    const lvs = leaveMap[key] || [];
    if (lvs.length === 0) return null;
    if (lvs.some(l => l.status === 'APPROVED')) return 'APPROVED';
    if (lvs.some(l => l.status === 'PENDING')) return 'PENDING';
    return 'REJECTED';
  };

  const inRange = (key: string) => {
    if (!selStart) return false;
    const end = selEnd || (hoverDate && hoverDate >= selStart ? hoverDate : selStart);
    return key >= selStart && key <= (end || selStart);
  };

  // ── Navigation ────────────────────────────────────────────

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  // ── Apply Mode handlers ───────────────────────────────────

  const exitApply = () => {
    setApplyMode(false);
    setSelStart(null);
    setSelEnd(null);
    setHoverDate(null);
    setShowDialog(false);
  };

  const handleDayClick = (key: string) => {
    if (!applyMode || isBlocked(key)) return;

    if (!selStart || selEnd) {
      // First click or restart after a completed selection
      setSelStart(key);
      setSelEnd(null);
      return;
    }

    // Second click
    if (key < selStart) {
      setSelStart(key);
      setSelEnd(null);
      return;
    }

    // Verify no blocked dates in the range
    const sd = new Date(selStart + 'T00:00:00');
    const ed = new Date(key + 'T00:00:00');
    for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
      const k = fmtKey(d.getFullYear(), d.getMonth(), d.getDate());
      if (isBlocked(k)) {
        // Blocked date in range — restart with this date
        setSelStart(key);
        setSelEnd(null);
        return;
      }
    }

    setSelEnd(key);
    openDialog();
  };

  // ── Dialog ────────────────────────────────────────────────

  const isSelfApprovingRole = user?.role === 'HR' || user?.role === 'MANAGER' || user?.role === 'LEADERSHIP';

  const openDialog = async () => {
    setShowDialog(true);
    setLeaveType(LEAVE_TYPES[0].value);
    setReason('');
    setSubmitError('');
    setLoadingApprovers(true);

    try {
      const res = await employeeApi.approversList();
      if (res.data) {
        setApprovers(res.data.approvers);
        const pre: number[] = [];
        res.data.approvers.forEach(a => {
          if (isSelfApprovingRole) {
            // Self-approving roles only pre-select their designated manager(s) if they report to someone
            if (managerEmployeeIds.has(a.employeeId)) {
              pre.push(a.userId);
            }
          } else {
            // Standard employees pre-select direct manager and always include HR
            if (a.role === 'HR') pre.push(a.userId);
            if (managerEmployeeIds.has(a.employeeId)) {
              pre.push(a.userId);
            }
          }
        });
        setSelectedApprovers([...new Set(pre)]);
      }
    } catch {
      /* silent */
    }
    setLoadingApprovers(false);
  };

  const toggleApprover = (uid: number) => {
    // Standard employees must always send the request to HR
    if (!isSelfApprovingRole && approvers.find(a => a.userId === uid)?.role === 'HR') return;
    setSelectedApprovers(p =>
      p.includes(uid) ? p.filter(i => i !== uid) : [...p, uid],
    );
  };

  const handleSubmit = async () => {
    if (!selStart || !selEnd) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await leaveApi.apply({
        type: leaveType,
        startDate: selStart,
        endDate: selEnd,
        days: isShortLeave(leaveType) ? 0 : workingDayCount(selStart, selEnd, holidayNames),
        reason: reason || undefined,
        approverIds: selectedApprovers.length > 0 ? selectedApprovers.join(',') : undefined,
      });
      exitApply();
      onRefresh();
    } catch (e: any) {
      setSubmitError(e.message || 'Failed to submit leave application');
    }
    setSubmitting(false);
  };

  // ── Computed for dialog ───────────────────────────────────

  const selDays = selStart && selEnd ? workingDayCount(selStart, selEnd, holidayNames) : 0;
  const selTypeInfo = LEAVE_TYPES.find(t => t.value === leaveType);
  const shortSelected = isShortLeave(leaveType);
  // Short leaves already taken (pending/approved) in the month of the selected date
  const shortUsedThisMonth = selStart
    ? myLeaves.filter(
        l => isShortLeave(l.type) && l.status !== 'REJECTED' && l.startDate.slice(0, 7) === selStart.slice(0, 7),
      ).length
    : 0;
  const shortLeaveBlocked = shortSelected && (selStart !== selEnd || selDays !== 1 || shortUsedThisMonth >= SHORT_LEAVES_PER_MONTH);
  const willExceed =
    selTypeInfo?.consumesQuota && paidBalance.remaining - selDays < 0;

  const tKey = getTodayKey();

  /* ═══════════════════════════════════════════════════════════
   *  R E N D E R
   * ═══════════════════════════════════════════════════════════ */

  return (
    <div className={`space-y-6 relative ${isLight ? 'hr-panel-light' : ''}`}>
      {/* ── Summary Cards ─────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: 'Total Requests', value: stats.total, color: 'text-white', accent: 'from-slate-600 to-slate-700' },
          { label: 'Approved Days', value: stats.approvedDays, color: 'text-emerald-400', accent: 'from-emerald-600/20 to-emerald-700/10' },
          { label: 'Pending', value: stats.pending, color: 'text-amber-400', accent: 'from-amber-600/20 to-amber-700/10' },
          { label: 'Rejected', value: stats.rejected, color: 'text-red-400', accent: 'from-red-600/20 to-red-700/10' },
          { label: 'Paid Balance', value: paidBalance.remaining, color: paidBalance.remaining > 0 ? 'text-blue-400' : 'text-red-400', accent: 'from-blue-600/20 to-blue-700/10' },
        ].map(s => (
          <div
            key={s.label}
            className={isLight
              ? 'hr-surface-solid rounded-xl p-2.5 sm:p-4 text-center transition-transform hover:scale-[1.02]'
              : 'bg-gradient-to-br bg-slate-800 rounded-xl p-4 border border-slate-700/50 text-center transition-transform hover:scale-[1.02]'
            }
          >
            <p className={`text-xl sm:text-2xl font-bold tabular-nums ${isLight ? 'text-stone-900' : s.color}`}>{s.value}</p>
            <p className={`text-[10px] sm:text-[11px] mt-1 font-medium uppercase tracking-wider leading-tight ${isLight ? 'text-stone-600' : 'text-slate-400'}`}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Calendar ──────────────────────────────────────── */}
      <div className={isLight
        ? 'hr-surface-solid rounded-2xl overflow-hidden'
        : 'bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg shadow-black/10'
      }>
        {/* Header bar */}
        <div className={isLight
          ? 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 sm:px-5 py-3 sm:py-4 border-b border-[rgba(var(--hr-border),0.85)] bg-white/40'
          : 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 sm:px-5 py-3 sm:py-4 border-b border-slate-700/40 bg-slate-800/80'
        }>
          <div className="flex items-center justify-between sm:justify-start gap-2">
            <button
              onClick={prevMonth}
              className={isLight
                ? 'p-1.5 rounded-lg hover:bg-orange-100 text-slate-655 hover:text-slate-800 transition-colors'
                : 'p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors'
              }
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className={`text-base sm:text-lg font-semibold sm:min-w-[180px] text-center select-none ${isLight ? 'text-stone-900' : 'text-white'}`}>
              {MONTHS[viewMonth]} {viewYear}
            </h3>
            <button
              onClick={nextMonth}
              className={isLight
                ? 'p-1.5 rounded-lg hover:bg-orange-100 text-slate-655 hover:text-slate-800 transition-colors'
                : 'p-1.5 rounded-lg hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors'
              }
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                setViewMonth(now.getMonth());
                setViewYear(now.getFullYear());
              }}
              className={isLight
                ? 'text-xs text-slate-500 hover:text-[#f46617] ml-1 px-2 py-1 rounded-md hover:bg-orange-50 transition-all'
                : 'text-xs text-slate-500 hover:text-blue-400 ml-1 px-2 py-1 rounded-md hover:bg-slate-700/40 transition-all'
              }
            >
              Today
            </button>
          </div>

          {isOwnProfile && (
            <button
              onClick={applyMode ? exitApply : () => { setApplyMode(true); setSelStart(null); setSelEnd(null); }}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl text-sm font-medium transition-all w-full sm:w-auto ${
                applyMode
                  ? (isLight ? 'bg-orange-500/10 text-orange-700 border border-orange-500/20 hover:bg-orange-500/15' : 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25')
                  : (isLight ? 'btn-orange' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20 hover:shadow-blue-600/35 hover:brightness-110')
              }`}
            >
              {applyMode ? (
                <><X className="w-4 h-4" /> Cancel</>
              ) : (
                <><Plus className="w-4 h-4" /> Apply Leave</>
              )}
            </button>
          )}
        </div>

        {/* Apply mode instruction banner */}
        {applyMode && (
          <div className={isLight
            ? 'px-5 py-2.5 bg-orange-50 border-b border-orange-100 flex items-center gap-2 animate-fadeIn'
            : 'px-5 py-2.5 bg-blue-500/8 border-b border-blue-500/15 flex items-center gap-2 animate-fadeIn'
          }>
            <Info className={`w-4 h-4 flex-shrink-0 ${isLight ? 'text-[#f46617]' : 'text-blue-400'}`} />
            <p className={`text-xs ${isLight ? 'text-stone-700' : 'text-blue-300'}`}>
              {!selStart
                ? 'Click on a start date to begin selecting your leave range.'
                : !selEnd
                  ? 'Now click on an end date (or the same date for a single day).'
                  : 'Range selected! Fill in the details in the dialog.'}
            </p>
          </div>
        )}

        {/* Day-of-week headers */}
        <div className={isLight ? 'grid grid-cols-7 border-b border-orange-100 bg-orange-50/60' : 'grid grid-cols-7 border-b border-slate-700/30 bg-slate-800/50'}>
          {DAYS_OF_WEEK.map(d => (
            <div
              key={d}
              className={`py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider ${
                d === 'Sun' ? (isLight ? 'text-[#f46617]' : 'text-red-400/60') : (isLight ? 'text-slate-655' : 'text-slate-500')
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {cells.map(cell => {
            const status = getDayStatus(cell.key);
            const blocked = applyMode && isBlocked(cell.key);
            const selected = applyMode && inRange(cell.key);
            const isToday = cell.key === tKey;
            const dayLeaves = leaveMap[cell.key] || [];
            const isSunday = new Date(cell.key + 'T00:00:00').getDay() === 0;

            return (
              <div
                key={cell.key}
                onClick={() => cell.current && handleDayClick(cell.key)}
                onMouseEnter={e => {
                  // Hover preview for range selection
                  if (applyMode && selStart && !selEnd && !isBlocked(cell.key) && cell.current) {
                    setHoverDate(cell.key);
                  }
                  // Show tooltip for leave days
                  if (dayLeaves.length > 0 && cell.current) {
                    setTooltip({
                      leave: dayLeaves[0],
                      rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                    });
                  }
                }}
                onMouseLeave={() => {
                  setHoverDate(null);
                  setTooltip(null);
                }}
                className={[
                  `relative min-h-[68px] p-1.5 border-b border-r transition-all duration-150 ${
                    isLight ? 'border-[rgba(var(--hr-border),0.7)]' : 'border-slate-700/15'
                  }`,
                  !cell.current && 'opacity-25 pointer-events-none',
                  cell.current && applyMode && !blocked && (isLight ? 'cursor-pointer hover:bg-orange-50/50' : 'cursor-pointer hover:bg-slate-700/30'),
                  cell.current && applyMode && blocked && 'cursor-not-allowed opacity-35',
                  selected && (isLight ? 'bg-orange-100/50 ring-1 ring-inset ring-brand-orange/40' : 'bg-blue-600/15 ring-1 ring-inset ring-blue-500/30'),
                  isToday && !selected && (isLight ? 'bg-orange-50/70' : 'bg-slate-700/25'),
                ].filter(Boolean).join(' ')}
              >
                {/* Day number badge */}
                <span
                  className={[
                    'text-sm font-medium inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                    isToday && (isLight ? 'bg-[#f46617] text-white shadow-sm shadow-orange-500/40' : 'bg-blue-500 text-white shadow-sm shadow-blue-500/40'),
                    !isToday && cell.current && !selected && (isSunday ? (isLight ? 'text-orange-600/70' : 'text-red-400/70') : (isLight ? 'text-slate-700' : 'text-slate-300')),
                    !isToday && !cell.current && (isLight ? 'text-slate-400' : 'text-slate-600'),
                    selected && !isToday && (isLight ? 'text-[#f46617]' : 'text-blue-200'),
                  ].filter(Boolean).join(' ')}
                >
                  {cell.day}
                </span>

                {/* Company holiday label (only when there's no leave on that day) */}
                {cell.current && dayLeaves.length === 0 && holidayNames[cell.key] && (
                  <div
                    className="absolute top-[34px] left-1 right-1 text-center rounded-md px-0.5 py-[3px] text-[9px] font-semibold leading-tight truncate bg-sky-100 text-sky-800"
                    title={`Holiday: ${holidayNames[cell.key]}`}
                  >
                    {holidayNames[cell.key]}
                  </div>
                )}

                {/* Leave type label */}
                {cell.current && dayLeaves.length > 0 && (
                  <div
                    className={[
                      'absolute top-[34px] left-1 right-1 text-center rounded-md px-0.5 py-[3px] text-[9px] font-semibold leading-tight truncate',
                      status === 'APPROVED' && (isLight ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-500/20 text-emerald-300'),
                      status === 'PENDING' && (isLight ? 'bg-amber-100 text-amber-800' : 'bg-amber-500/20 text-amber-300'),
                      status === 'REJECTED' && (isLight ? 'bg-red-100 text-red-700 line-through' : 'bg-red-500/15 text-red-400/70 line-through'),
                    ].filter(Boolean).join(' ')}
                  >
                    {dayLeaves[0].type.replace(' Leave', '')}
                  </div>
                )}

                {/* Status dot */}
                {cell.current && status && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                    <span
                      className={[
                        'w-[6px] h-[6px] rounded-full',
                        status === 'APPROVED' && 'bg-emerald-400 shadow-sm shadow-emerald-400/50',
                        status === 'PENDING' && 'bg-amber-400 shadow-sm shadow-amber-400/50 animate-pulse',
                        status === 'REJECTED' && 'bg-red-400/60',
                      ].filter(Boolean).join(' ')}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend bar */}
        <div className={isLight ? 'px-5 py-3 border-t border-orange-100 flex items-center gap-5 flex-wrap bg-orange-50/60' : 'px-5 py-3 border-t border-slate-700/30 flex items-center gap-5 flex-wrap bg-slate-800/50'}>
          {[
            { color: 'bg-emerald-400', label: 'Approved' },
            { color: 'bg-amber-400', label: 'Pending' },
            { color: 'bg-red-400', label: 'Rejected' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${l.color}`} />
              <span className={`text-[11px] ${isLight ? 'text-slate-550' : 'text-slate-400'}`}>{l.label}</span>
            </div>
          ))}
          <div className={`ml-auto text-[11px] ${isLight ? 'text-slate-555' : 'text-slate-500'}`}>
            Paid balance: <span className={`font-semibold ${paidBalance.remaining > 0 ? (isLight ? 'text-[#f46617]' : 'text-blue-400') : (isLight ? 'text-red-600' : 'text-red-400')}`}>
              {paidBalance.remaining}
            </span>
            {' / '}{paidBalance.total} (used {paidBalance.used})
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════
       *  TOOLTIP  (fixed positioned, viewport-relative)
       * ═════════════════════════════════════════════════════ */}
      {tooltip && createPortal(
        <div
          className="fixed z-[60] pointer-events-none animate-fadeIn"
          style={{
            left: tooltip.rect.left + tooltip.rect.width / 2,
            top: tooltip.rect.top - 8,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div
            className={isLight
              ? 'backdrop-blur-md rounded-2xl p-4 min-w-[230px] max-w-[290px] shadow-2xl shadow-orange-200/20 border border-orange-100 bg-white'
              : 'bg-slate-900/95 backdrop-blur-sm border border-slate-600/60 rounded-xl p-3.5 shadow-2xl shadow-black/40 min-w-[230px] max-w-[290px]'}
          >
            {/* Status badge */}
            <div className="flex items-center gap-2 mb-2">
              {tooltip.leave.status === 'APPROVED' && <CheckCircle className={`w-3.5 h-3.5 ${isLight ? 'text-emerald-650' : 'text-emerald-400'}`} />}
              {tooltip.leave.status === 'PENDING' && <Clock className={`w-3.5 h-3.5 ${isLight ? 'text-amber-650' : 'text-amber-400'}`} />}
              {tooltip.leave.status === 'REJECTED' && <XCircle className={`w-3.5 h-3.5 ${isLight ? 'text-red-650' : 'text-red-400'}`} />}
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  tooltip.leave.status === 'APPROVED'
                    ? (isLight ? 'text-emerald-750' : 'text-emerald-400')
                    : tooltip.leave.status === 'PENDING'
                      ? (isLight ? 'text-amber-750' : 'text-amber-400')
                      : (isLight ? 'text-red-750' : 'text-red-400')
                }`}
              >
                {tooltip.leave.status}
              </span>
            </div>

            <p className={`text-sm font-semibold ${isLight ? 'text-stone-900' : 'text-white'}`}>{tooltip.leave.type}</p>
            <p className={`${isLight ? 'text-stone-600' : 'text-slate-400'} text-xs mt-1`}>
              {fmtDisplay(tooltip.leave.startDate.split('T')[0])} →{' '}
              {fmtDisplay(tooltip.leave.endDate.split('T')[0])}
              {' · '}
              {tooltip.leave.days} day{tooltip.leave.days !== 1 ? 's' : ''}
            </p>

            {tooltip.leave.reason && (
              <p className={`${isLight ? 'text-stone-600 border-t-[rgba(var(--hr-border),0.6)] pt-2' : 'text-slate-500 mt-2 italic leading-relaxed border-t border-slate-700/40 pt-2'} text-xs italic leading-relaxed`}>
                "{tooltip.leave.reason}"
              </p>
            )}

            {tooltip.leave.approvedBy && (
              <p className={`text-[11px] mt-1.5 ${isLight ? 'text-stone-600' : 'text-slate-500'}`}>
                Reviewed by:{' '}
                <span className={`${isLight ? 'text-stone-700 font-medium' : 'text-slate-300 font-medium'}`}>{tooltip.leave.approvedBy.username}</span>
              </p>
            )}

            {tooltip.leave.comment && (
              <p className={`text-[11px] mt-0.5 ${isLight ? 'text-stone-600' : 'text-slate-500'}`}>
                Comment: <span className={`${isLight ? 'text-stone-700' : 'text-slate-400'}`}>"{tooltip.leave.comment}"</span>
              </p>
            )}

            {/* Arrow */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full">
              <div className={isLight ? 'w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-orange-105' : 'w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-600/60'} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ═════════════════════════════════════════════════════
       *  APPLY LEAVE DIALOG  (modal overlay)
       * ═════════════════════════════════════════════════════ */}
      {showDialog && selStart && selEnd && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDialog(false)}
          />

          {/* Dialog card */}
          <div className={isLight ? 'relative rounded-[32px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-orange-100/50' : 'relative bg-slate-800 rounded-2xl border border-slate-600/50 shadow-2xl shadow-black/50 w-full max-w-lg max-h-[90vh] overflow-y-auto'}>
            {/* Dialog header */}
            <div className={isLight ? 'flex items-center justify-between p-6 border-b border-orange-100 sticky top-0 bg-white/80 backdrop-blur z-10' : 'flex items-center justify-between p-5 border-b border-slate-700/50 sticky top-0 bg-slate-800 z-10'}>
              <div>
                <h3 className={`text-lg font-black text-slate-800 tracking-tight flex items-center gap-2`}>
                  <Calendar className={`w-5 h-5 text-[#f46617]`} />
                  Apply for Leave
                </h3>
                <p className={`text-xs mt-1 text-slate-500 font-bold uppercase tracking-wider`}>
                  {shortSelected ? fmtDisplay(selStart) : <>{fmtDisplay(selStart)} → {fmtDisplay(selEnd)}</>} ·{' '}
                  <span className={`font-black text-slate-850`}>
                    {shortSelected ? `${SHORT_LEAVE_HOURS} hours` : `${selDays} day${selDays !== 1 ? 's' : ''}`}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowDialog(false)}
                className={isLight ? 'p-1.5 rounded-xl hover:bg-orange-50 text-slate-500 hover:text-slate-750 transition-colors' : 'p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={isLight ? 'p-5 space-y-5' : 'p-5 space-y-5'}>
              {/* ── Leave Type Selector ─────────────────────── */}
              <div>
                <label className={`block text-xs font-semibold mb-2.5 uppercase tracking-wider ${isLight ? 'text-stone-600' : 'text-slate-400'}`}>
                  Leave Type
                </label>
                <div className="space-y-2">
                  {LEAVE_TYPES.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setLeaveType(t.value)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        leaveType === t.value
                          ? `${t.bg} ${t.border} ${t.text}`
                          : isLight ? 'border-orange-105 text-slate-600 hover:bg-orange-50/50 hover:text-slate-850' : 'border-slate-700/40 text-slate-400 hover:bg-slate-700/30 hover:text-slate-300'
                      }`}
                    >
                      <div
                        className={`w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-1 ${isLight ? 'ring-offset-white' : 'ring-offset-slate-800'}`}
                        style={{
                          backgroundColor: leaveType === t.value ? t.color : 'transparent',
                          borderColor: t.color,
                          // Tailwind's ring-2 reads its colour from this variable.
                          '--tw-ring-color': t.color,
                        } as React.CSSProperties}
                      />
                      <div className="flex-1">
                        <span className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>{t.label}</span>
                        {t.consumesQuota && (
                          <span className={`ml-2 text-[10px] opacity-50 ${isLight ? 'text-stone-600' : 'text-slate-400'}`}>uses paid quota</span>
                        )}
                        {t.value === 'Comp Off' && (
                          <span className="ml-2 text-[10px] opacity-50">no quota usage</span>
                        )}
                        {t.value === 'Unpaid Leave' && (
                          <span className="ml-2 text-[10px] opacity-50">salary deduction</span>
                        )}
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                          leaveType === t.value ? 'border-current' : 'border-slate-600'
                        }`}
                      >
                        {leaveType === t.value && (
                          <div className="w-2 h-2 rounded-full bg-current" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Paid Leave Balance Info ─────────────────── */}
              {selTypeInfo?.consumesQuota && (
                  <div
                    className={`rounded-2xl p-4 border transition-colors ${
                      willExceed
                        ? isLight ? 'bg-red-100/50 border-red-200' : 'bg-red-500/10 border-red-500/25'
                        : isLight ? 'bg-orange-50/60 border-orange-100' : 'bg-blue-500/8 border-blue-500/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {willExceed ? (
                        <AlertTriangle className={`w-4 h-4 ${isLight ? 'text-red-650' : 'text-red-400'}`} />
                      ) : (
                        <Info className={`w-4 h-4 ${isLight ? 'text-[#f46617]' : 'text-blue-400'}`} />
                      )}
                      <span
                        className={`text-xs font-bold ${
                          willExceed ? (isLight ? 'text-red-750' : 'text-red-400') : (isLight ? 'text-[#f46617]' : 'text-blue-400')
                        }`}
                      >
                        {willExceed ? 'Exceeds Paid Leave Quota!' : 'Paid Leave Balance'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-4 mt-1">
                      <span className={`text-sm ${isLight ? 'text-slate-700 font-semibold' : 'text-slate-300'}`}>
                        Remaining:{' '}
                        <span
                          className={`font-bold ${
                            paidBalance.remaining > 0 ? (isLight ? 'text-[#f46617]' : 'text-blue-300') : 'text-red-450'
                          }`}
                        >
                          {paidBalance.remaining}
                        </span>{' '}
                        / {paidBalance.total}
                      </span>
                      <span className={`text-xs ${isLight ? 'text-slate-500 font-semibold' : 'text-slate-550'}`}>Used: {paidBalance.used}</span>
                    </div>
                  {willExceed && (
                    <p className={`text-xs mt-2 leading-relaxed ${isLight ? 'text-red-700' : 'text-red-400/80'}`}>
                      ⚠ Applying {selDays} day(s) will exceed your paid quota by{' '}
                      {selDays - paidBalance.remaining} day(s). The excess will be treated as
                      unpaid leave with salary deduction.
                    </p>
                  )}
                </div>
              )}

              {leaveType === 'Unpaid Leave' && (
                <div className={`rounded-xl p-4 border ${isLight ? 'bg-amber-100/50 border-amber-200' : 'bg-amber-500/8 border-amber-500/20'}`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-4 h-4 ${isLight ? 'text-amber-700' : 'text-amber-400'}`} />
                    <span className={`text-xs font-bold ${isLight ? 'text-amber-800' : 'text-amber-400'}`}>
                      Salary Deduction Warning
                    </span>
                  </div>
                  <p className={`text-xs mt-1.5 leading-relaxed ${isLight ? 'text-amber-700' : 'text-amber-300/70'}`}>
                    Unpaid leave will result in a proportional salary deduction for{' '}
                    {selDays} day(s).
                  </p>
                </div>
              )}

              {shortSelected && (
                <div className={`rounded-2xl p-4 border ${shortLeaveBlocked ? 'bg-red-50 border-red-200' : 'bg-teal-50/70 border-teal-200'}`}>
                  <div className="flex items-center gap-2">
                    {shortLeaveBlocked ? <AlertTriangle className="w-4 h-4 text-red-600" /> : <Info className="w-4 h-4 text-teal-600" />}
                    <span className={`text-xs font-bold ${shortLeaveBlocked ? 'text-red-700' : 'text-teal-800'}`}>
                      {selStart !== selEnd
                        ? 'Short leave is for a single day — select just one date'
                        : selDays !== 1
                          ? 'Short leave must be on a working day (not a Sunday or holiday)'
                        : shortUsedThisMonth >= SHORT_LEAVES_PER_MONTH
                          ? "You've already used this month's short leave"
                          : `Short leave · ${SHORT_LEAVE_HOURS} hours`}
                    </span>
                  </div>
                  <p className={`text-xs mt-1.5 leading-relaxed ${shortLeaveBlocked ? 'text-red-700' : 'text-teal-700'}`}>
                    {leaveType === SHORT_LEAVE_MORNING ? 'Morning' : 'Evening'}, {SHORT_LEAVE_WINDOWS[leaveType]}.{' '}
                    One short leave per month · unused ones don't carry forward · doesn't use your paid leave.
                  </p>
                </div>
              )}

              {/* ── Reason ─────────────────────────────────── */}
              <div>
                <label className={`block text-xs font-semibold mb-2 uppercase tracking-wider ${isLight ? 'text-stone-600' : 'text-slate-400'}`}>
                  Reason
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder="Enter the reason for your leave..."
                  className={`w-full text-sm rounded-2xl px-4 py-3 border focus:outline-none resize-none transition-all ${
                    isLight
                      ? 'bg-white text-slate-800 border-orange-105 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange'
                      : 'bg-slate-700/40 text-white border-slate-600/40 placeholder-slate-500 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25'
                  }`}
                />
              </div>

              {/* ── Approvers ──────────────────────────────── */}
              <div>
                <label className={`block text-xs font-semibold mb-2.5 uppercase tracking-wider ${isLight ? 'text-stone-600' : 'text-slate-400'}`}>
                  {isSelfApprovingRole ? 'Inform / Notify (Optional)' : 'Send to Approvers'}
                </label>
                {loadingApprovers ? (
                  <div className="flex items-center gap-2 py-6 justify-center">
                    <Loader2 className={`w-4 h-4 animate-spin ${isLight ? 'text-[#f46617]' : 'text-blue-400'}`} />
                    <span className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Loading approvers…</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1 scrollbar-thin">
                    {visibleApprovers.map(a => {
                      const isHRApprover = a.role === 'HR';
                      const isLeadershipApprover = a.role === 'LEADERSHIP';
                      const isManager = managerEmployeeIds.has(a.employeeId);
                      const checked = selectedApprovers.includes(a.userId);
                      const cannotToggle = !isSelfApprovingRole && isHRApprover;
                      return (
                        <label
                          key={a.userId}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition-all select-none ${
                            checked
                              ? isLight ? 'bg-orange-50/60 border-orange-150' : 'bg-blue-500/8 border-blue-500/25'
                              : isLight ? 'border-orange-100 hover:bg-orange-50/30' : 'border-slate-700/40 hover:bg-slate-700/20'
                          } ${cannotToggle ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={cannotToggle}
                            onChange={() => toggleApprover(a.userId)}
                            className={`w-4 h-4 rounded border ${isLight ? 'border-orange-200 bg-white accent-[#f46617]' : 'border-slate-500 bg-slate-700 accent-blue-500'} ${isLight ? 'focus:ring-brand-orange/30' : 'focus:ring-blue-500/30'} focus:ring-offset-0`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold truncate ${isLight ? 'text-slate-800' : 'text-white'}`}>
                                {a.name}
                              </span>
                              {isHRApprover && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isLight ? 'bg-orange-100 text-[#f46617]' : 'bg-blue-500/20 text-blue-300'}`}>
                                  HR
                                </span>
                              )}
                              {isLeadershipApprover && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isLight ? 'bg-amber-100 text-amber-700' : 'bg-amber-500/20 text-amber-300'}`}>
                                  Leadership
                                </span>
                              )}
                              {isManager && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/20 text-emerald-300'}`}>
                                  Manager
                                </span>
                              )}
                            </div>
                            {(a.position || a.department) && (
                              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                {[a.position, a.department].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                    {visibleApprovers.length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-4 italic">
                        No supervisors available
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Error display ──────────────────────────── */}
              {submitError && (
                <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400 leading-relaxed">{submitError}</p>
                </div>
              )}
            </div>

            {/* Dialog footer */}
            <div className={isLight ? 'flex items-center gap-3 p-5 border-t border-[rgba(var(--hr-border),0.85)] sticky bottom-0 bg-white/40 z-10' : 'flex items-center gap-3 p-5 border-t border-slate-700/50 sticky bottom-0 bg-slate-800 z-10'}>
              <button
                onClick={() => setShowDialog(false)}
                className={isLight ? 'flex-1 px-4 py-2.5 bg-white text-stone-700 border border-[rgba(var(--hr-border),0.85)] hover:bg-rose-50 text-sm font-medium rounded-xl transition-colors' : 'flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors'}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || shortLeaveBlocked || (!isSelfApprovingRole && selectedApprovers.length === 0)}
                className={isLight ? 'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-medium rounded-xl shadow-lg shadow-rose-400/20 hover:shadow-rose-400/35 hover:brightness-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed' : 'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/35 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed'}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {submitting ? 'Submitting…' : isSelfApprovingRole ? 'Submit & Inform' : 'Submit Application'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ═════════════════════════════════════════════════════
       *  RECENT LEAVE REQUESTS LIST
       * ═════════════════════════════════════════════════════ */}
      <div className={isLight ? 'bg-white rounded-3xl border border-orange-100/50 shadow-card overflow-hidden' : 'bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden'}>
        <div className={isLight ? 'px-5 py-4 border-b border-orange-100/40 bg-orange-50/25' : 'px-5 py-4 border-b border-slate-700/40'}>
          <h3 className={`text-sm font-bold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>
            Recent Requests
          </h3>
        </div>

        {myLeaves.length === 0 ? (
          <div className="text-center py-14">
            <Calendar className={`w-10 h-10 mx-auto mb-2 ${isLight ? 'text-stone-300' : 'text-slate-600'}`} />
            <p className={`text-sm ${isLight ? 'text-stone-600' : 'text-slate-500'}`}>No leave records yet</p>
          </div>
        ) : (
          <div className={isLight ? 'divide-y divide-orange-100/20' : 'divide-y divide-slate-700/25'}>
            {myLeaves.slice(0, 10).map(lv => {
              const typeInfo = LEAVE_TYPES.find(t => t.value === lv.type);
              return (
                <div
                  key={lv.id}
                  className={isLight ? 'px-5 py-3.5 flex items-center gap-4 hover:bg-orange-50/20 transition-colors' : 'px-5 py-3.5 flex items-center gap-4 hover:bg-slate-700/15 transition-colors'}
                >
                  {/* Color accent bar */}
                  <div
                    className="w-1 h-10 rounded-full flex-shrink-0"
                    style={{ backgroundColor: typeInfo?.color || (isLight ? '#d2ccc1' : '#64748b') }}
                  />
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>{lv.type}</p>
                    <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-550' : 'text-slate-400'}`}>
                      {isShortLeave(lv.type)
                        ? fmtDisplay(lv.startDate.split('T')[0])
                        : <>{fmtDisplay(lv.startDate.split('T')[0])} → {fmtDisplay(lv.endDate.split('T')[0])}</>}
                      {' · '}{formatLeaveDuration(lv)}
                    </p>
                    {lv.reason && (
                      <p className={`text-[11px] mt-0.5 truncate italic ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
                        {lv.reason}
                      </p>
                    )}
                    {lv.comment && (
                      <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-555' : 'text-slate-500'}`}>
                        Review: <span className={isLight ? 'text-slate-700' : 'text-slate-400'}>"{lv.comment}"</span>
                      </p>
                    )}
                  </div>
                  {/* Status */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {lv.status === 'APPROVED' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                    {lv.status === 'PENDING' && <Clock className="w-4 h-4 text-amber-400" />}
                    {lv.status === 'REJECTED' && <XCircle className="w-4 h-4 text-red-400" />}
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        lv.status === 'APPROVED'
                          ? isLight ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-500/15 text-emerald-400'
                          : lv.status === 'PENDING'
                            ? isLight ? 'bg-amber-100 text-amber-800' : 'bg-amber-500/15 text-amber-400'
                            : isLight ? 'bg-red-100 text-red-800' : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {lv.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default LeavesTab;
