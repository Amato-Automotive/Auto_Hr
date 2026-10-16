import React, { useState, useEffect } from 'react';
import { Clock, Upload, RefreshCw, Check, AlertCircle, FileText, Plus, X, Calendar, Pencil } from 'lucide-react';
import { attendanceApi, type Employee, type Attendance, type AuthUser, type EmployeeAttendanceStatus } from '../services/api';
import { BiometricDeviceCard } from './BiometricDeviceCard';
import { AttendanceCorrectionRequests } from './AttendanceCorrectionRequests';
import { AttendanceDayList } from './AttendanceDayList';

interface AttendancePanelProps {
  user: AuthUser | null;
  employees: Employee[];
  focusEmployeeId?: number | null;
}

export const AttendancePanel: React.FC<AttendancePanelProps> = ({ user, employees, focusEmployeeId }) => {
  const isHR = user?.role === 'HR';
  const isLeadership = user?.role === 'LEADERSHIP';
  const isManager = user?.role === 'MANAGER';
  const canBrowseEmployeeAttendance = isHR || isLeadership || isManager;
  const canViewAllEmployees = isHR || isLeadership;
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [targetMonth, setTargetMonth] = useState<string>(() => {
    const d = new Date();
    // Default to current month, format YYYY-MM
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // File Upload states
  const [uploadType, setUploadType] = useState<'biometric' | 'excel'>('biometric');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Manual Adjust form state
  const [showManualForm, setShowManualForm] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [showSelfCorrection, setShowSelfCorrection] = useState(false);
  // Phones: HR's device status + sheet upload stay folded away until asked for.
  const [showHrTools, setShowHrTools] = useState(false);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionRefreshKey, setCorrectionRefreshKey] = useState(0);
  const [correctionForm, setCorrectionForm] = useState({
    startDate: '',
    endDate: '',
    status: 'WFH' as EmployeeAttendanceStatus,
    checkIn: '',
    checkOut: '',
    reason: '',
  });
  const [manualForm, setManualForm] = useState({
    date: '',
    checkIn: '',
    checkOut: '',
    status: 'PRESENT' as 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY',
  });

  const selfEmployee = employees.find(emp => emp.id === user?.employeeId) || null;
  const teamEmployees = employees.filter(emp => emp.id !== user?.employeeId);
  // Everyone who can browse others still gets their own attendance pinned at the top.
  const sidebarSections = canBrowseEmployeeAttendance
    ? [
        ...(selfEmployee ? [{ title: 'My Attendance', employees: [selfEmployee] }] : []),
        {
          title: canViewAllEmployees ? 'Employees' : 'Team Members',
          employees: teamEmployees,
        },
      ]
    : [];

  // Default to the viewer's own attendance; HR/Leadership without a linked profile start on the first employee.
  useEffect(() => {
    if (selectedEmployeeId !== null) return;
    if (user?.employeeId) {
      setSelectedEmployeeId(user.employeeId);
    } else if (canBrowseEmployeeAttendance && employees.length > 0) {
      setSelectedEmployeeId(employees[0]!.id);
    }
  }, [canBrowseEmployeeAttendance, employees, selectedEmployeeId, user]);

  // Jump to the employee referenced by an incoming notification
  useEffect(() => {
    if (focusEmployeeId && canBrowseEmployeeAttendance) {
      setSelectedEmployeeId(focusEmployeeId);
    }
  }, [focusEmployeeId, canBrowseEmployeeAttendance]);

  useEffect(() => {
    if (selectedEmployeeId) {
      loadAttendance();
    }
  }, [selectedEmployeeId, targetMonth]);

  const loadAttendance = async () => {
    if (!selectedEmployeeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await attendanceApi.get(selectedEmployeeId, { month: targetMonth });
      if (res.data) {
        setAttendance(res.data.attendance);
        setSummary(res.data.summary);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      let res;
      if (uploadType === 'biometric') {
        res = await attendanceApi.uploadBiometric(file, targetMonth);
      } else {
        res = await attendanceApi.uploadExcel(file, targetMonth);
      }
      setSuccessMsg(res.message || 'Data uploaded successfully!');
      setFile(null);
      // Reset input element
      const fileInput = document.getElementById('attendance-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      
      // Reload logs
      if (selectedEmployeeId) {
        loadAttendance();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload attendance file');
    } finally {
      setUploading(false);
    }
  };

  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeId || !manualForm.date) return;
    setSavingManual(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const payload = {
        employeeId: selectedEmployeeId,
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

  const handleSelfCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.employeeId || !correctionForm.startDate || !correctionForm.reason.trim()) return;
    setSavingCorrection(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const response = await attendanceApi.requestCorrection({
        startDate: correctionForm.startDate,
        endDate: correctionForm.endDate || correctionForm.startDate,
        status: correctionForm.status,
        checkIn: correctionForm.checkIn || undefined,
        checkOut: correctionForm.checkOut || undefined,
        reason: correctionForm.reason.trim(),
      });
      setSuccessMsg(response.message || 'Correction sent for approval');
      setShowSelfCorrection(false);
      setCorrectionForm({ startDate: '', endDate: '', status: 'WFH', checkIn: '', checkOut: '', reason: '' });
      // Attendance itself only changes on approval; just show the new pending request.
      setCorrectionRefreshKey(key => key + 1);
    } catch (err: any) {
      setError(err.message || 'Failed to send the correction');
    } finally {
      setSavingCorrection(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Attendance</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
            {isHR
              ? 'Manage and sync biometric attendance sheets'
              : isManager
                ? 'Review attendance for yourself and your reporting team'
                : 'View attendance logs and monthly summaries'}
          </p>
        </div>

        {/* Global target month filter */}
        <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl border border-orange-100 shadow-sm">
          <span className="text-xs font-bold text-slate-550 uppercase tracking-wider">Target Month</span>
          <input
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            className="bg-orange-50/50 text-slate-800 text-sm font-bold border border-orange-100 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange cursor-pointer"
          />
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 font-semibold text-xs animate-scale-in">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-700 font-semibold text-xs animate-scale-in">
          <Check className="w-5 h-5 flex-shrink-0" />
          <p>{successMsg}</p>
        </div>
      )}

      {isHR && (
        <button
          type="button"
          onClick={() => setShowHrTools(open => !open)}
          className="lg:hidden w-full flex items-center justify-between gap-3 px-4 py-3 bg-white rounded-2xl border border-orange-100/60 shadow-card text-sm font-bold text-slate-700"
        >
          <span className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-[#f46617]" /> HR tools: device status & sheet upload
          </span>
          <span className="text-xs text-[#f46617]">{showHrTools ? 'Hide' : 'Show'}</span>
        </button>
      )}

      {isHR && (
        <div className={showHrTools ? '' : 'hidden lg:block'}>
          <BiometricDeviceCard />
        </div>
      )}

      <AttendanceCorrectionRequests
        canReview={canBrowseEmployeeAttendance}
        refreshKey={correctionRefreshKey}
        onApproved={employeeId => {
          if (employeeId === selectedEmployeeId) void loadAttendance();
        }}
      />

      {/* HR Actions Panel */}
      {isHR && (
        <div className={`bg-white rounded-[32px] p-4 sm:p-6 border border-orange-100/50 shadow-card ${showHrTools ? '' : 'hidden lg:block'}`}>
          <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#f46617]" />
            Upload Attendance Data Sheet
          </h3>
          
          {/* File Type tabs */}
          <div className="flex gap-2 mb-4 bg-orange-50/40 p-1.5 rounded-2xl border border-orange-100/30">
            <button
              type="button"
              onClick={() => setUploadType('biometric')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                uploadType === 'biometric' ? 'bg-white text-[#f46617] shadow-sm border border-orange-100/50' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Biometric raw text (.txt)
            </button>
            <button
              type="button"
              onClick={() => setUploadType('excel')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                uploadType === 'excel' ? 'bg-white text-[#f46617] shadow-sm border border-orange-100/50' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Attendance Portal Excel (.xlsx)
            </button>
          </div>

          <form onSubmit={handleFileUpload} className="space-y-4">
            <div className="border-2 border-dashed border-orange-100 hover:border-brand-orange rounded-3xl p-8 flex flex-col items-center justify-center transition-colors bg-orange-50/10 cursor-pointer relative">
              <input
                id="attendance-file-input"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                accept={uploadType === 'biometric' ? '.txt' : '.xlsx'}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                required
              />
              <FileText className="w-12 h-12 text-slate-400 mb-3" />
              <p className="text-sm font-bold text-slate-700">
                {file ? file.name : 'Click to select or drag and drop file'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {uploadType === 'biometric'
                  ? 'Upload the S-FB4K biometric machine output text file'
                  : 'Upload the exported Excel sheet'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                Filtering for month: <strong className="text-slate-800 font-bold">{targetMonth}</strong> (non-matching data ignored)
              </span>
              <button
                type="submit"
                disabled={uploading || !file}
                className="btn-orange px-6 py-2.5 text-sm rounded-xl font-bold"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Processing...
                  </>
                ) : (
                  'Process and Import'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Grid container: Employee selection and attendance log grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
        {/* Phones: a dropdown instead of the long employee list */}
        {canBrowseEmployeeAttendance && (
          <label className="lg:hidden flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-orange-100/60 shadow-card">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">Viewing</span>
            <select
              value={selectedEmployeeId ?? ''}
              onChange={event => setSelectedEmployeeId(Number(event.target.value))}
              className="flex-1 min-w-0 bg-transparent text-sm font-bold text-slate-800 focus:outline-none"
            >
              {sidebarSections.map(section => (
                <optgroup key={section.title} label={section.title}>
                  {section.employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.id === user?.employeeId ? `${emp.name} (You)` : emp.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        {/* Sidebar employee list for scoped attendance browsing (desktop) */}
        {canBrowseEmployeeAttendance && (
          <div className="hidden lg:block bg-white rounded-[32px] p-4 border border-orange-100/50 shadow-card space-y-3 lg:col-span-1">
            <div className="max-h-[450px] overflow-y-auto space-y-4 pr-1">
              {sidebarSections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">
                    {section.title}
                  </h4>
                  {section.employees.map((emp) => {
                    const isSelected = selectedEmployeeId === emp.id;
                    return (
                      <button
                        key={emp.id}
                        onClick={() => setSelectedEmployeeId(emp.id)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-2xl text-left text-sm font-semibold transition-all ${
                          isSelected
                            ? 'bg-orange-50 text-[#f46617] border border-orange-100/50 shadow-sm'
                            : 'text-slate-600 hover:bg-orange-50/30 hover:text-slate-900'
                        }`}
                      >
                        <span className="truncate">
                          {emp.id === user?.employeeId ? `${emp.name} (You)` : emp.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold flex-shrink-0 ml-1">ID: {emp.biometricId || '—'}</span>
                      </button>
                    );
                  })}
                  {section.employees.length === 0 && (
                    <p className="px-2.5 py-1 text-xs text-slate-400 italic">
                      No employees available
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected Employee log panel */}
        <div className={`bg-white rounded-[32px] p-4 sm:p-6 border border-orange-100/50 shadow-card min-w-0 ${canBrowseEmployeeAttendance ? 'lg:col-span-3' : 'lg:col-span-4'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#f46617]" />
              {!canBrowseEmployeeAttendance || selectedEmployeeId === user?.employeeId
                ? 'My Attendance Logs'
                : `Log: ${employees.find((e) => e.id === selectedEmployeeId)?.name || ''}`}
            </h3>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {selectedEmployeeId === user?.employeeId && !showSelfCorrection && (
                <button
                  onClick={() => setShowSelfCorrection(true)}
                  className="btn-orange px-3 py-1.5 text-xs font-bold rounded-xl"
                >
                  <Pencil className="w-3.5 h-3.5" /> Correct My Attendance
                </button>
              )}
              {isHR && !showManualForm && (
                <button
                  onClick={() => setShowManualForm(true)}
                  className="btn-orange px-3 py-1.5 text-xs font-bold rounded-xl"
                >
                  <Plus className="w-3.5 h-3.5" /> Add/Edit Log
                </button>
              )}
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-orange-50 px-2.5 py-1 rounded-full border border-orange-100/30">
                {attendance.length} record{attendance.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {showSelfCorrection && selectedEmployeeId === user?.employeeId && (
            <form onSubmit={handleSelfCorrection} className="bg-orange-50/20 rounded-3xl p-5 border border-orange-100/50 mb-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-orange-100 pb-3">
                <div>
                  <h4 className="text-slate-800 font-black text-sm">Correct My Attendance</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Pick one date or a range. Your manager and HR are notified, and it applies once one of them approves.
                    Sundays, holidays and approved leave in a range are left as they are.
                  </p>
                </div>
                <button type="button" onClick={() => setShowSelfCorrection(false)} className="p-1 text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">From *</label>
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().split('T')[0]}
                    value={correctionForm.startDate}
                    onChange={e => setCorrectionForm(previous => ({
                      ...previous,
                      startDate: e.target.value,
                      // Keep the range valid: an end date before the new start is dropped.
                      endDate: previous.endDate && previous.endDate < e.target.value ? '' : previous.endDate,
                    }))}
                    className="w-full bg-white text-slate-800 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">To (optional)</label>
                  <input
                    type="date"
                    min={correctionForm.startDate || undefined}
                    max={new Date().toISOString().split('T')[0]}
                    value={correctionForm.endDate}
                    onChange={e => setCorrectionForm(previous => ({ ...previous, endDate: e.target.value }))}
                    className="w-full bg-white text-slate-800 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Status *</label>
                  <select
                    value={correctionForm.status}
                    onChange={e => setCorrectionForm(previous => ({ ...previous, status: e.target.value as EmployeeAttendanceStatus }))}
                    className="w-full bg-white text-slate-800 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20"
                  >
                    <option value="WFH">Work From Home</option>
                    <option value="ON_DUTY">On Duty / Field Work</option>
                    <option value="CLIENT_VISIT">Client Visit</option>
                    <option value="BUSINESS_TRAVEL">Business Travel</option>
                    <option value="PRESENT">Present</option>
                    <option value="HALF_DAY">Half Day</option>
                    <option value="ABSENT">Absent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Check In (optional)</label>
                  <input type="time" step="1" value={correctionForm.checkIn} onChange={e => setCorrectionForm(previous => ({ ...previous, checkIn: e.target.value }))} className="w-full bg-white text-slate-800 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Check Out (optional)</label>
                  <input type="time" step="1" value={correctionForm.checkOut} onChange={e => setCorrectionForm(previous => ({ ...previous, checkOut: e.target.value }))} className="w-full bg-white text-slate-800 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Reason *</label>
                <textarea
                  required
                  minLength={3}
                  rows={2}
                  value={correctionForm.reason}
                  onChange={e => setCorrectionForm(previous => ({ ...previous, reason: e.target.value }))}
                  placeholder="Explain the WFH, outside duty, missed attendance, or correction"
                  className="w-full bg-white text-slate-800 text-sm rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowSelfCorrection(false)} disabled={savingCorrection} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl">Cancel</button>
                <button type="submit" disabled={savingCorrection} className="btn-orange px-5 py-2 text-xs font-bold rounded-xl">
                  {savingCorrection ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending...</> : 'Send for Approval'}
                </button>
              </div>
            </form>
          )}

          {/* Manual Entry Form */}
          {showManualForm && (
            <div className="bg-orange-50/20 rounded-3xl p-5 border border-orange-100/50 mb-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-orange-150 pb-3">
                <h3 className="text-slate-800 font-black text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#f46617]" />
                  Manual Attendance Entry
                </h3>
                <button
                  onClick={() => setShowManualForm(false)}
                  className="p-1 hover:bg-orange-100/50 rounded-lg text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleManualSave} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Date *</label>
                  <input
                    type="date"
                    required
                    value={manualForm.date}
                    onChange={(e) => setManualForm((p) => ({ ...p, date: e.target.value }))}
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Status</label>
                  <select
                    value={manualForm.status}
                    onChange={(e) => setManualForm((p) => ({ ...p, status: e.target.value as any }))}
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange cursor-pointer"
                  >
                    <option value="PRESENT">Present</option>
                    <option value="ABSENT">Absent</option>
                    <option value="HALF_DAY">Half Day</option>
                    <option value="ON_LEAVE">On Leave</option>
                    <option value="HOLIDAY">Holiday</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Check In</label>
                  <input
                    type="text"
                    placeholder="HH:MM:SS"
                    value={manualForm.checkIn}
                    onChange={(e) => setManualForm((p) => ({ ...p, checkIn: e.target.value }))}
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wider">Check Out</label>
                  <input
                    type="text"
                    placeholder="HH:MM:SS"
                    value={manualForm.checkOut}
                    onChange={(e) => setManualForm((p) => ({ ...p, checkOut: e.target.value }))}
                    className="w-full bg-white text-slate-800 text-xs rounded-xl px-3 py-2 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange"
                  />
                </div>

                <div className="sm:col-span-4 flex justify-end gap-3 pt-3 border-t border-orange-100/30">
                  <button
                    type="button"
                    onClick={() => setShowManualForm(false)}
                    className="px-4 py-2 bg-white border border-slate-250 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingManual}
                    className="btn-orange px-4 py-2 text-xs font-bold rounded-xl"
                  >
                    {savingManual ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
                      </>
                    ) : (
                      'Save Attendance'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Monthly stats breakdown */}
          {summary && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-6">
              {[
                { label: 'Present', value: summary.present, color: 'text-emerald-600 bg-emerald-50 border border-emerald-100/30' },
                { label: 'Absent', value: summary.absent, color: 'text-red-650 bg-red-50 border border-red-100/30' },
                { label: 'Late Days', value: summary.lateDays, color: 'text-orange-600 bg-orange-50 border border-orange-100/30' },
                { label: 'Grace Lates', value: `${summary.graceLateDays || 0}/3`, color: 'text-amber-600 bg-amber-50 border border-amber-100/30' },
                { label: 'Avg Late Time', value: `${summary.avgLateMinutes || 0}m`, color: 'text-cyan-600 bg-cyan-50 border border-cyan-100/30' },
                { label: 'Overtime Days', value: summary.overtimeDays, color: 'text-purple-600 bg-purple-50 border border-purple-100/30' },
              ].map((stat) => (
                <div key={stat.label} className={`rounded-2xl p-2.5 sm:p-3 text-center ${stat.color}`}>
                  <p className="text-lg sm:text-xl font-black">{stat.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-80 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Attendance Log Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="w-8 h-8 text-[#f46617] animate-spin" />
            </div>
          ) : attendance.length === 0 ? (
            <div className="text-center py-20 text-slate-400 bg-orange-50/10 rounded-2xl border border-orange-100/20">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
              <p className="font-bold text-slate-500">No attendance data found</p>
              <p className="text-xs text-slate-400 mt-1">Try changing the Target Month or uploading a sheet</p>
            </div>
          ) : (
            <>
            <div className="sm:hidden">
              <AttendanceDayList records={attendance} />
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-orange-100/40 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-2">Day</th>
                    <th className="py-3 px-2">Check In</th>
                    <th className="py-3 px-2">Check Out</th>
                    <th className="py-3 px-2">Working Hours</th>
                    <th className="py-3 px-2">Late By</th>
                    <th className="py-3 px-2">Overtime</th>
                    <th className="py-3 px-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-100/20">
                  {attendance.map((record) => (
                    <tr key={`${record.id ?? record.date}`} className="hover:bg-orange-50/10 transition-colors">
                      <td className="py-3.5 px-3 font-bold text-slate-700">
                        {new Date(record.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-3.5 px-2 text-slate-500 font-semibold">{record.day || '—'}</td>
                      <td className="py-3.5 px-2 font-mono text-slate-600">{record.checkIn || '—'}</td>
                      <td className="py-3.5 px-2 font-mono text-slate-600">{record.checkOut || '—'}</td>
                      <td className="py-3.5 px-2 font-mono font-bold text-[#f46617]">{record.totalWorkingHours || '—'}</td>
                      <td className="py-3.5 px-2">
                        {record.isLate ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-full">
                            Late ({record.lateBy})
                          </span>
                        ) : record.isGraceLate ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-full">
                            Grace ({record.lateBy})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-2">
                        {record.overtime ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 bg-purple-50 text-purple-650 border border-purple-100 rounded-full">
                            Yes ({record.otTime})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-2">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            ['PRESENT', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL'].includes(record.status)
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                              : record.status === 'ABSENT'
                              ? 'bg-red-50 text-red-600 border-red-100'
                              : record.status === 'HOLIDAY'
                              ? 'bg-blue-50 text-blue-600 border-blue-100'
                              : record.status === 'ON_LEAVE'
                              ? 'bg-purple-50 text-purple-600 border-purple-100'
                              : 'bg-slate-50 text-slate-600 border-slate-100'
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
    </div>
  );
};
