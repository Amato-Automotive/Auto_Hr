import React, { useState, useEffect } from 'react';
import { Clock, Plus, Loader2, AlertCircle, Check, X, Calendar } from 'lucide-react';
import { attendanceApi, type Attendance, type AttendanceSummary } from '../../services/api';
import { AttendanceDayList } from '../AttendanceDayList';

interface AttendanceTabProps {
  employeeId: number;
  isHR: boolean;
  theme?: 'dark' | 'light';
}

export const AttendanceTab: React.FC<AttendanceTabProps> = ({ employeeId, isHR, theme: _theme = 'dark' }) => {
  const [targetMonth, setTargetMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Manual Adjust form state
  const [showManualForm, setShowManualForm] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    date: '',
    checkIn: '',
    checkOut: '',
    status: 'PRESENT' as 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY',
  });

  useEffect(() => {
    loadAttendance();
  }, [employeeId, targetMonth]);

  const loadAttendance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await attendanceApi.get(employeeId, { month: targetMonth });
      if (res.data) {
        setAttendance(res.data.attendance);
        setSummary(res.data.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance logs');
    } finally {
      setLoading(false);
    }
  };

  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.date) return;
    setSavingManual(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const payload = {
        employeeId,
        date: manualForm.date,
        checkIn: manualForm.checkIn || undefined,
        checkOut: manualForm.checkOut || undefined,
        status: manualForm.status,
      };
      await attendanceApi.saveManual(payload);
      setSuccessMsg('Attendance record updated successfully');
      setShowManualForm(false);
      // Reset form
      setManualForm({
        date: '',
        checkIn: '',
        checkOut: '',
        status: 'PRESENT',
      });
      loadAttendance();
    } catch (err: any) {
      setError(err.message || 'Failed to save manual attendance');
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Controls Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* Month Picker */}
        <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-white border border-orange-100 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-550">Select Month</span>
          <input
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            className="bg-orange-50/50 text-slate-800 text-sm font-bold border border-orange-100 rounded-xl px-3 py-1 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange cursor-pointer"
          />
        </div>

        {/* HR Manual adjust button */}
        {isHR && !showManualForm && (
          <button
            onClick={() => setShowManualForm(true)}
            className="btn-orange px-4 py-2.5 text-xs font-bold rounded-2xl"
          >
            <Plus className="w-4 h-4" /> Add/Edit Log
          </button>
        )}
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border bg-red-50 border-red-100 text-red-600 font-semibold text-xs animate-scale-in">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border bg-emerald-50 border-emerald-100 text-emerald-700 font-semibold text-xs animate-scale-in">
          <Check className="w-5 h-5 flex-shrink-0" />
          <p>{successMsg}</p>
        </div>
      )}

      {/* Manual Entry Form */}
      {showManualForm && (
        <div className="bg-orange-50/20 rounded-3xl p-6 border border-orange-100/50 shadow-sm space-y-4 animate-scale-in">
          <div className="flex items-center justify-between pb-3 border-b border-orange-150">
            <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#f46617]" />
              Manual Attendance Entry
            </h3>
            <button
              onClick={() => setShowManualForm(false)}
              className="p-1 hover:bg-orange-105 rounded-lg text-slate-500 hover:text-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleManualSave} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Date *</label>
              <input
                type="date"
                required
                value={manualForm.date}
                onChange={(e) => setManualForm((p) => ({ ...p, date: e.target.value }))}
                className="w-full bg-white text-slate-850 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={manualForm.status}
                onChange={(e) => setManualForm((p) => ({ ...p, status: e.target.value as any }))}
                className="w-full bg-white text-slate-850 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange cursor-pointer"
              >
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="HALF_DAY">Half Day</option>
                <option value="ON_LEAVE">On Leave</option>
                <option value="HOLIDAY">Holiday</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Check In</label>
              <input
                type="text"
                placeholder="HH:MM:SS"
                value={manualForm.checkIn}
                onChange={(e) => setManualForm((p) => ({ ...p, checkIn: e.target.value }))}
                className="w-full bg-white text-slate-850 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Check Out</label>
              <input
                type="text"
                placeholder="HH:MM:SS"
                value={manualForm.checkOut}
                onChange={(e) => setManualForm((p) => ({ ...p, checkOut: e.target.value }))}
                className="w-full bg-white text-slate-850 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
              />
            </div>

            <div className="md:col-span-4 flex justify-end gap-3 pt-3 border-t border-orange-100/30">
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="px-5 py-2 bg-white border border-slate-250 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingManual}
                className="btn-orange px-5 py-2 text-xs font-bold rounded-xl"
              >
                {savingManual ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                  </>
                ) : (
                  'Save Attendance'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Present', value: summary.present, color: 'text-emerald-600 bg-emerald-50 border border-emerald-100/35' },
            { label: 'Absent', value: summary.absent, color: 'text-red-600 bg-red-50 border border-red-100/35' },
            { label: 'Late Days', value: summary.lateDays, color: 'text-orange-600 bg-orange-50 border border-orange-100/35' },
            { label: 'Grace Lates', value: `${summary.graceLateDays}/3`, color: 'text-amber-600 bg-amber-50 border border-amber-100/35' },
            { label: 'Overtime Days', value: summary.overtimeDays, color: 'text-purple-600 bg-purple-50 border border-purple-100/35' },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-2xl p-4 text-center ${stat.color}`}>
              <p className="text-2xl font-black">{stat.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-85 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Daily log table */}
      <div className="rounded-3xl overflow-hidden border border-orange-100/50 bg-white shadow-card">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#f46617]" />
          </div>
        ) : attendance.length === 0 ? (
          <div className="text-center py-16 bg-orange-50/10">
            <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 font-bold">No attendance logs found for this month</p>
            <p className="text-xs mt-1 text-slate-400 font-medium">Select another month or update logs</p>
          </div>
        ) : (
          <>
          <div className="sm:hidden px-4">
            <AttendanceDayList records={attendance} />
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-orange-100/40 text-slate-400 font-bold uppercase tracking-wider text-[10px] bg-orange-50/60">
                  <th className="py-4 px-6 whitespace-nowrap min-w-[110px]">Date</th>
                  <th className="py-4 px-5 whitespace-nowrap min-w-[85px]">Day</th>
                  <th className="py-4 px-5 whitespace-nowrap min-w-[85px]">Check In</th>
                  <th className="py-4 px-5 whitespace-nowrap min-w-[85px]">Check Out</th>
                  <th className="py-4 px-5 whitespace-nowrap min-w-[95px]">Working Hours</th>
                  <th className="py-4 px-5 whitespace-nowrap min-w-[100px]">Late By</th>
                  <th className="py-4 px-5 whitespace-nowrap min-w-[95px]">Overtime</th>
                  <th className="py-4 px-6 whitespace-nowrap min-w-[80px]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-100/20">
                {attendance.map((record) => (
                  <tr key={`${record.id ?? record.date}`} className="align-middle hover:bg-orange-50/10 transition-colors">
                    <td className="py-4 px-6 font-bold whitespace-nowrap min-w-[110px] text-slate-800">
                      {new Date(record.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap min-w-[85px] text-slate-500 font-semibold">{record.day || '—'}</td>
                    <td className="py-4 px-5 font-mono whitespace-nowrap min-w-[85px] text-slate-600">{record.checkIn || '—'}</td>
                    <td className="py-4 px-5 font-mono whitespace-nowrap min-w-[85px] text-slate-600">{record.checkOut || '—'}</td>
                    <td className="py-4 px-5 font-mono font-bold whitespace-nowrap min-w-[95px] text-[#f46617]">{record.totalWorkingHours || '—'}</td>
                    <td className="py-4 px-5 min-w-[100px] text-slate-700">
                      {record.isLate ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 bg-orange-50 text-orange-600 border border-orange-150 rounded-full inline-block whitespace-nowrap">
                          Late ({record.lateBy})
                        </span>
                      ) : record.isGraceLate ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-full inline-block whitespace-nowrap">
                          Grace ({record.lateBy})
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-5 min-w-[95px] text-slate-700">
                      {record.overtime ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 bg-purple-50 text-purple-650 border border-purple-150 rounded-full inline-block whitespace-nowrap">
                          Yes ({record.otTime})
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-6 min-w-[80px]">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border inline-block whitespace-nowrap ${
                          ['PRESENT', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL'].includes(record.status)
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-150'
                            : record.status === 'ABSENT'
                            ? 'bg-red-50 text-red-650 border-red-150'
                            : record.status === 'HOLIDAY'
                            ? 'bg-blue-50 text-blue-600 border-blue-150'
                            : record.status === 'ON_LEAVE'
                            ? 'bg-purple-50 text-purple-600 border-purple-150'
                            : 'bg-slate-50 text-slate-600 border-slate-150'
                        }`}
                      >
                        {record.status === 'HOLIDAY' && record.holidayName
                          ? `HOLIDAY (${record.holidayName})`
                          : record.status === 'ON_LEAVE' && record.leaveType
                          ? `LEAVE (${record.leaveType})`
                          : record.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
};
