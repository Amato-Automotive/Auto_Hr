import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Mail, Phone, Calendar, Building2, Users,
  Loader2, AlertCircle, Briefcase, GraduationCap, Sparkles, Camera,
  Shield, CheckCircle, AlertTriangle, Send, Cake
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  employeeApi,
  leaveApi,
  authApi,
  type EmployeeDetail,
  type Leave,
  type UserRole,
} from '../services/api';
import { performanceApi } from '../services/api';
import { type Kra, type PerformanceSummary } from '../types';
import PerformanceTab from '../components/tabs/PerformanceTab';
import LeavesTab from '../components/tabs/LeavesTab';
import { AttendanceTab } from '../components/tabs/AttendanceTab';
import { EmployeeDocumentsTab } from '../components/tabs/EmployeeDocumentsTab';
import { AssetsTab } from '../components/tabs/AssetsTab';
import SalaryTab from '../components/tabs/SalaryTab';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { AvatarUploadPicker } from '../components/AvatarUploadPicker';
import { compressAvatarImage } from '../utils/imageCompression';
import { PayrollDetailsCard } from '../components/PayrollDetailsCard';
import { LEAVES_ENABLED } from '../utils/features';
import ConfirmDialog from '../components/ConfirmDialog';
import { DEPARTMENTS, EMPLOYEE_TYPES, optionsWithCurrent } from '../utils/employeeOptions';

const getRoleBadgeClasses = (role: UserRole) => (
  role === 'HR'
    ? 'bg-orange-500/15 text-orange-700 border border-orange-500/20'
    : role === 'LEADERSHIP'
      ? 'bg-amber-500/15 text-amber-800 border border-amber-500/20'
      : role === 'MANAGER'
        ? 'bg-teal-500/15 text-teal-800 border border-teal-500/20'
        : 'bg-slate-500/10 text-slate-700 border border-slate-500/15'
);

// ─── Score Display ───────────────────────────────────────────

const ScoreDisplay: React.FC<{ score: number | null }> = ({ score }) => {
  const size = 96;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score !== null ? Math.min(score, 100) : 0;
  const offset = circumference - (pct / 100) * circumference;
  const color = score === null ? '#94a3b8' : score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className="text-2xl font-bold" style={{ color }}>{score !== null ? Math.round(score) : '—'}</span>
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">/100</span>
      </div>
    </div>
  );
};

// ─── Profile Page ────────────────────────────────────────────

type Tab = 'about' | 'performance' | 'leaves' | 'attendance' | 'assets' | 'documents' | 'salary' | 'account';

export const ProfileView: React.FC<{
  employeeId: number;
  initialTab?: Tab;
  onBack?: () => void;
  onOpenEmployee?: (employeeId: number) => void;
  theme?: 'dark' | 'light';
  hideBack?: boolean;
  /** Called after HR deactivates or permanently deletes this employee. */
  onEmployeeRemoved?: () => void;
  /** Called after any change saved from this profile, so lists elsewhere on screen can refresh. */
  onChanged?: () => void;
  /** On the My Profile page, drop the tabs that duplicate sidebar pages (Salary, Leaves, Attendance). */
  hideSidebarDuplicates?: boolean;
}> = ({ employeeId, initialTab = 'about', onBack, onOpenEmployee, hideBack = false, onEmployeeRemoved, onChanged, hideSidebarDuplicates = false }) => {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [kras, setKras] = useState<Kra[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isHR = user?.role === 'HR';
  // Managers edit their team's KRAs, not their own (the API enforces the same rule).
  const canEditPerformance = user?.role === 'HR' || (user?.role === 'MANAGER' && user.employeeId !== employeeId);

  useEffect(() => {
    if (!employeeId) return;
    loadProfile();
  }, [employeeId]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // `silent` refetches without the full-page spinner, so the open tab (and any edit in progress) stays mounted.
  const loadProfile = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [empRes, leaveRes, perfRes] = await Promise.allSettled([
        employeeApi.get(employeeId),
        leaveApi.list({ employeeId: String(employeeId) }),
        performanceApi.get(employeeId),
      ]);

      if (empRes.status === 'fulfilled' && empRes.value.data) {
        setEmployee(empRes.value.data.employee);
      } else {
        setError('Employee not found');
      }
      if (leaveRes.status === 'fulfilled' && leaveRes.value.data) {
        setLeaves(leaveRes.value.data.leaves);
      }
      if (perfRes.status === 'fulfilled' && perfRes.value.data) {
        setKras(perfRes.value.data.kras);
        setSummary(perfRes.value.data.summary);
      }
    } catch {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const reloadAfterChange = async () => {
    await loadProfile(true);
    onChanged?.();
    // The header/sidebar show the signed-in user's name and photo from the auth context.
    if (user?.employeeId === employeeId) await refreshUser();
  };

  const refreshPerformance = async () => {
    const res = await performanceApi.get(employeeId);
    if (res.data) {
      setKras(res.data.kras);
      setSummary(res.data.summary);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] bg-transparent flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#f46617]" />
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="min-h-[60vh] bg-transparent flex items-center justify-center">
        <div className="text-center bg-white border border-orange-100 rounded-3xl p-8 shadow-card max-w-sm w-full mx-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-slate-800 font-bold">{error || 'Employee not found'}</p>
          {onBack && (
            <button
              onClick={onBack}
              className="mt-5 btn-orange w-full py-2.5 rounded-xl text-sm"
            >
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  const isOwnProfile = user?.employeeId === employeeId;
  const canViewEmployeeDocuments = !isOwnProfile && ['HR', 'LEADERSHIP', 'MANAGER'].includes(user?.role ?? 'EMPLOYEE');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'about', label: 'About' },
    ...(isOwnProfile && !hideSidebarDuplicates ? [{ id: 'salary' as Tab, label: 'Salary' }] : []),
    { id: 'performance', label: 'Performance' },
    ...(isOwnProfile && hideSidebarDuplicates ? [] : [
      // Leave management launches next year (utils/features)
      ...(LEAVES_ENABLED ? [{ id: 'leaves' as Tab, label: 'Leaves' }] : []),
      { id: 'attendance' as Tab, label: 'Attendance' },
    ]),
    // Same audience as documents, plus the employee themself (no sidebar page duplicates it).
    ...(isOwnProfile || canViewEmployeeDocuments ? [{ id: 'assets' as Tab, label: 'Assets' }] : []),
    ...(canViewEmployeeDocuments ? [{ id: 'documents' as Tab, label: 'Documents' }] : []),
    ...(isOwnProfile ? [{ id: 'account' as Tab, label: 'Account Settings' }] : []),
  ];

  return (
    <div className="bg-white rounded-[28px] sm:rounded-[40px] overflow-hidden border border-orange-100/60 shadow-island font-sans">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-orange-50 via-amber-50/50 to-orange-50/20 border-b border-orange-100/60">
        <div className="mx-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-0">
          {/* Back */}
          {!hideBack && (
            <button
              onClick={() => (onBack ? onBack() : navigate('/'))}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-[#f46617] mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}

          {/* Profile header */}
          <div className="flex flex-row items-start gap-4 md:gap-6 pb-4 md:pb-6">
            {/* Avatar */}
            <EmployeeAvatar
              name={employee.name}
              avatar={employee.avatar}
              gender={employee.gender}
              size="w-16 h-16 md:w-20 md:h-20"
              shape="rounded"
              className="shadow-xl shadow-orange-200/50 flex-shrink-0"
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl md:text-2xl font-black text-slate-800 leading-tight">{employee.name}</h1>
                {employee.user && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${getRoleBadgeClasses(employee.user.role)}`}>
                    {employee.user.role}
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-500 mt-0.5">{employee.position || 'No position set'}</p>
              <div className="flex items-center gap-x-4 gap-y-1.5 mt-2 md:mt-3 flex-wrap">
                {employee.department && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Building2 className="w-3.5 h-3.5 text-[#f46617]" /> {employee.department}
                  </span>
                )}
                {employee.email && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 min-w-0 break-all">
                    <Mail className="w-3.5 h-3.5 text-[#f46617] flex-shrink-0" /> {employee.email}
                  </span>
                )}
                {employee.phone && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Phone className="w-3.5 h-3.5 text-[#f46617]" /> {employee.phone}
                  </span>
                )}
                {employee.dateOfBirth && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Cake className="w-3.5 h-3.5 text-[#f46617]" /> Birthday {new Date(employee.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                  </span>
                )}
                {employee.joinDate && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Calendar className="w-4 h-4 text-[#f46617]" /> Joined {new Date(employee.joinDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>

              {/* Manager + Direct Reports */}
              <div className="flex items-start gap-4 mt-3 md:mt-4 flex-wrap">
                {(employee.managers && employee.managers.length > 0) || employee.manager ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reports to:</span>
                    <div className="flex gap-2 flex-wrap">
                      {employee.managers && employee.managers.length > 0 ? (
                        employee.managers.map(m => (
                          <button
                            key={m.manager.id}
                            onClick={() => (onOpenEmployee ? onOpenEmployee(m.manager.id) : navigate(`/profile/${m.manager.id}`))}
                            className="text-xs px-3 py-1 rounded-full transition-all border font-bold bg-orange-50/50 hover:bg-orange-100 text-[#f46617] border-orange-100"
                          >
                            {m.manager.name}
                          </button>
                        ))
                      ) : employee.manager ? (
                        <button
                          onClick={() => (onOpenEmployee ? onOpenEmployee(employee.manager!.id) : navigate(`/profile/${employee.manager!.id}`))}
                          className="text-xs px-3 py-1 rounded-full transition-all border font-bold bg-orange-50/50 hover:bg-orange-100 text-[#f46617] border-orange-100"
                        >
                          {employee.manager.name}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {employee.directReports && employee.directReports.length > 0 && (
                  <div className="hidden md:flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> Team:
                    </span>
                    <div className="flex gap-2 flex-wrap">
                      {employee.directReports.map(dr => (
                        <button
                          key={dr.id}
                          onClick={() => (onOpenEmployee ? onOpenEmployee(dr.id) : navigate(`/profile/${dr.id}`))}
                          className="text-xs px-3 py-1 rounded-full transition-all border font-semibold bg-white hover:bg-orange-50/30 text-slate-600 hover:text-slate-800 border-orange-100/50"
                        >
                          {dr.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Score Ring */}
            <div className="hidden md:flex flex-shrink-0 flex-col items-center gap-1.5 self-start">
              <ScoreDisplay score={summary?.overallScore ?? null} />
              <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wider mt-1">Performance</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 sm:gap-2 mt-2 sm:mt-4 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar">
            {tabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 sm:px-5 py-3 text-sm font-bold transition-all border-b-2 relative whitespace-nowrap flex-shrink-0 ${
                    isActive
                      ? 'text-[#f46617] border-[#f46617]'
                      : 'text-slate-500 border-transparent hover:text-slate-800'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'leaves' && leaves.length > 0 && (
                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-orange-100 text-[#f46617] rounded-full border border-orange-100">{leaves.length}</span>
                  )}
                  {tab.id === 'performance' && summary && summary.totalKras > 0 && (
                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full border border-amber-200">{summary.totalKras}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 sm:py-6 bg-white">
        {activeTab === 'about' && <AboutSection employee={employee} isHR={isHR} isOwnProfile={isOwnProfile} onRefresh={reloadAfterChange} onEmployeeRemoved={onEmployeeRemoved} />}
        {activeTab === 'performance' && (
          <PerformanceTab
            employeeId={employeeId}
            kras={kras}
            summary={summary}
            isHR={canEditPerformance}
            onRefresh={refreshPerformance}
            theme="light"
          />
        )}
        {activeTab === 'leaves' && <LeavesTab leaves={leaves} employee={employee} isHR={isHR} onRefresh={reloadAfterChange} theme="light" />}
        {activeTab === 'attendance' && <AttendanceTab employeeId={employeeId} isHR={isHR} theme="light" />}
        {activeTab === 'assets' && (isOwnProfile || canViewEmployeeDocuments) && (
          <AssetsTab employeeId={employeeId} employeeName={employee.name} isHR={isHR} isOwnProfile={isOwnProfile} />
        )}
        {activeTab === 'documents' && canViewEmployeeDocuments && (
          <EmployeeDocumentsTab employeeId={employeeId} employeeName={employee.name} />
        )}
        {activeTab === 'salary' && isOwnProfile && employee && (
          <SalaryTab
            employeeId={employeeId}
            employeeName={employee.name}
            employeeDepartment={employee.department || ''}
            employeePosition={employee.position || ''}
          />
        )}
        {activeTab === 'account' && isOwnProfile && (
          <AccountSettingsSection
            employee={employee}
            onAvatarUpdated={reloadAfterChange}
          />
        )}
      </div>
    </div>
  );
};

// ─── About Section ───────────────────────────────────────────

const skillsFromEmployee = (value: EmployeeDetail['skills']): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') {
    try { return (JSON.parse(value) as string[]).join(', '); } catch { return value; }
  }
  return '';
};

const AboutSection: React.FC<{ employee: EmployeeDetail; isHR: boolean; isOwnProfile: boolean; onRefresh: () => void; onEmployeeRemoved?: () => void }> = ({ employee, isHR, isOwnProfile, onRefresh, onEmployeeRemoved }) => {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editingOwnDetails, setEditingOwnDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const isDeactivated = employee.isActive === false;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<string | null>(null);
  type ManagerCandidate = {
    employeeId: number;
    name: string;
    position: string | null;
    department: string | null;
    roleHint?: 'MANAGER' | 'LEADERSHIP';
  };
  const [managerOptions, setManagerOptions] = useState<ManagerCandidate[]>([]);
  const [form, setForm] = useState({
    name: employee.name || '',
    biometricId: employee.biometricId ? String(employee.biometricId) : '',
    bio: employee.bio || '',
    skills: (() => {
      if (Array.isArray(employee.skills)) return (employee.skills as string[]).join(', ');
      if (typeof employee.skills === 'string') {
        try { return (JSON.parse(employee.skills) as string[]).join(', '); } catch { return employee.skills; }
      }
      return '';
    })(),
    education: employee.education || '',
    experience: employee.experience || '',
    position: employee.position || '',
    department: employee.department || '',
    phone: employee.phone || '',
    email: employee.email || '',
    gender: employee.gender || '',
    avatar: employee.avatar || '',
    employeeType: employee.employeeType || '',
    tallyLedgerName: employee.tallyLedgerName || '',
    employeeNumber: employee.employeeNumber || '',
    panNumber: employee.panNumber || '',
    uanNumber: employee.uanNumber || '',
    pfAccountNumber: employee.pfAccountNumber || '',
    esiNumber: employee.esiNumber || '',
    pranNumber: employee.pranNumber || '',
    taxRegime: employee.taxRegime || '',
    joinDate: employee.joinDate ? employee.joinDate.split('T')[0] : '',
    dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.split('T')[0] : '',
    managerId: employee.managerId ?? null as number | null,
    managerIds: employee.managers?.map(m => m.manager.id) ?? (employee.managerId ? [employee.managerId] : []) as number[],
    createUser: false,
    username: employee.user?.username || '',
    password: '',
    systemRole: employee.user?.role || 'EMPLOYEE' as UserRole,
  });

  /** `createLogin` opens the form with "Create login" ticked and scrolled into view. */
  const startEditing = async (options?: { createLogin?: boolean }) => {
    const createLogin = Boolean(options?.createLogin && !employee.user);
    setEditing(true);
    setSaveError(null);
    setAvatarStatus(null);
    setForm({
      name: employee.name || '',
      biometricId: employee.biometricId ? String(employee.biometricId) : '',
      bio: employee.bio || '',
      skills: (() => {
        if (Array.isArray(employee.skills)) return (employee.skills as string[]).join(', ');
        if (typeof employee.skills === 'string') {
          try { return (JSON.parse(employee.skills) as string[]).join(', '); } catch { return employee.skills; }
        }
        return '';
      })(),
      education: employee.education || '',
      experience: employee.experience || '',
      position: employee.position || '',
      department: employee.department || '',
      phone: employee.phone || '',
      email: employee.email || '',
      gender: employee.gender || '',
      avatar: employee.avatar || '',
      employeeType: employee.employeeType || '',
      tallyLedgerName: employee.tallyLedgerName || '',
      employeeNumber: employee.employeeNumber || '',
      panNumber: employee.panNumber || '',
      uanNumber: employee.uanNumber || '',
      pfAccountNumber: employee.pfAccountNumber || '',
      esiNumber: employee.esiNumber || '',
      pranNumber: employee.pranNumber || '',
      taxRegime: employee.taxRegime || '',
      joinDate: employee.joinDate ? employee.joinDate.split('T')[0] : '',
      dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.split('T')[0] : '',
      managerId: employee.managerId ?? null as number | null,
      managerIds: employee.managers?.map(m => m.manager.id) ?? (employee.managerId ? [employee.managerId] : []) as number[],
      createUser: createLogin,
      username: employee.user?.username || (createLogin ? employee.name.trim().split(/\s+/)[0] ?? '' : ''),
      password: '',
      systemRole: employee.user?.role || 'EMPLOYEE' as UserRole,
    });
    if (createLogin) {
      window.setTimeout(() => document.getElementById('login-account-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
    try {
      const mgrRes = await employeeApi.managersList();

      const optionsByEmployeeId = new Map<number, ManagerCandidate>();

      for (const assigned of employee.managers ?? []) {
        optionsByEmployeeId.set(assigned.manager.id, {
          employeeId: assigned.manager.id,
          name: assigned.manager.name,
          position: assigned.manager.position,
          department: assigned.manager.department,
          roleHint: undefined,
        });
      }

      for (const manager of mgrRes.data?.managers ?? []) {
        optionsByEmployeeId.set(manager.employeeId, {
          employeeId: manager.employeeId,
          name: manager.name,
          position: manager.position,
          department: manager.department,
          roleHint: manager.role,
        });
      }

      setManagerOptions(
        Array.from(optionsByEmployeeId.values()).sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch {
      setManagerOptions([]);
    }
  };

  const handleAvatarSelect = async (file: File) => {
    console.log('[Profile/AboutSection] avatar:onSelect:start', {
      employeeId: employee.id,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
    setAvatarSaving(true);
    setAvatarStatus(null);
    try {
      const compressed = await compressAvatarImage(file);
      console.log('[Profile/AboutSection] avatar:compressed', {
        employeeId: employee.id,
        fileName: compressed.name,
        fileType: compressed.type,
        fileSize: compressed.size,
      });
      const response = await employeeApi.updateAvatar(employee.id, compressed);
      console.log('[Profile/AboutSection] avatar:update-response', response);
      const avatar = response.data?.avatar || null;
      setForm(p => ({ ...p, avatar: avatar || '' }));
      setAvatarStatus('Photo updated successfully');
      await onRefresh();
    } catch (err: any) {
      console.error('[Profile/AboutSection] avatar:error', err);
      setAvatarStatus(err.message || 'Failed to update photo');
    } finally {
      console.log('[Profile/AboutSection] avatar:onSelect:done', {
        employeeId: employee.id,
      });
      setAvatarSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const skillsArr = form.skills.split(',').map(s => s.trim()).filter(Boolean);
      const payload: any = {
        name: form.name,
        biometricId: form.biometricId ? parseInt(form.biometricId, 10) : null,
        bio: form.bio,
        skills: skillsArr,
        education: form.education,
        experience: form.experience,
        position: form.position,
        department: form.department,
        phone: form.phone,
        email: form.email.trim() ? form.email.trim() : undefined,
        gender: form.gender || null,
        avatar: form.avatar || null,
        employeeType: form.employeeType,
        tallyLedgerName: form.tallyLedgerName || null,
        employeeNumber: form.employeeNumber || null,
        panNumber: form.panNumber || null,
        uanNumber: form.uanNumber || null,
        pfAccountNumber: form.pfAccountNumber || null,
        esiNumber: form.esiNumber || null,
        pranNumber: form.pranNumber || null,
        taxRegime: form.taxRegime || null,
        joinDate: form.joinDate || null,
        dateOfBirth: form.dateOfBirth || null,
        managerIds: form.managerIds && form.managerIds.length > 0 ? form.managerIds : [],
      };

      if (!employee.user) {
        if (form.createUser) {
          if (!form.username.trim() || !form.password.trim()) {
            throw new Error('Username and password are required for user account creation');
          }
          payload.createUser = true;
          payload.username = form.username;
          payload.password = form.password;
          payload.role = form.systemRole;
        }
      } else {
        const username = form.username.trim();
        if (!username) throw new Error('Username cannot be empty');
        if (form.password && form.password.length < 6) throw new Error('New password must be at least 6 characters');
        if (username !== employee.user.username || form.password) {
          payload.createUser = true;
          payload.username = username;
          if (form.password) payload.password = form.password;
        }
        if (form.systemRole !== employee.user.role) {
          payload.role = form.systemRole;
        }
      }

      await employeeApi.update(employee.id, payload);
      await onRefresh();
      setEditing(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update employee profile';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const startEditingOwnDetails = () => {
    setForm(previous => ({
      ...previous,
      bio: employee.bio || '',
      skills: skillsFromEmployee(employee.skills),
      education: employee.education || '',
      experience: employee.experience || '',
      dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.split('T')[0] : '',
    }));
    setSaveError(null);
    setEditingOwnDetails(true);
  };

  const handleOwnDetailsSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const skills = form.skills.split(',').map(skill => skill.trim()).filter(Boolean);
      await employeeApi.updateProfileDetails(employee.id, {
        bio: form.bio.trim() || null,
        skills,
        education: form.education.trim() || null,
        experience: form.experience.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
      });
      await onRefresh();
      setEditingOwnDetails(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to update profile details');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm(`Are you sure you want to deactivate employee "${employee.name}"?`)) return;
    setDeactivating(true);
    try {
      await employeeApi.delete(employee.id);
      if (onEmployeeRemoved) onEmployeeRemoved();
      else navigate('/');
    } catch (err: any) {
      alert(err.message || 'Failed to deactivate employee');
    } finally {
      setDeactivating(false);
    }
  };

  const handleReactivate = async () => {
    setReactivating(true);
    try {
      await employeeApi.reactivate(employee.id);
      await onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reactivate employee');
    } finally {
      setReactivating(false);
    }
  };

  const handleDeletePermanently = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const res = await employeeApi.deletePermanently(employee.id);
      alert(res.message || `${employee.name} was permanently deleted.`);
      if (onEmployeeRemoved) onEmployeeRemoved();
      else navigate('/');
    } catch (err: any) {
      alert(err.message || 'Failed to delete employee');
    } finally {
      setDeleting(false);
    }
  };

  const skills: string[] = (() => {
    if (Array.isArray(employee.skills)) return employee.skills as string[];
    if (typeof employee.skills === 'string') {
      try { return JSON.parse(employee.skills) as string[]; } catch { return []; }
    }
    return [];
  })();

  return (
    <div className="space-y-6">
      <ConfirmDialog
        isOpen={confirmDelete}
        variant="danger"
        title="Delete employee permanently?"
        message={`This permanently deletes "${employee.name}" and all of their attendance, leaves, salary slips, documents, performance and learning records. Their login is removed too. This cannot be undone — use Deactivate instead if you may need this data later.`}
        confirmLabel="Delete Permanently"
        onConfirm={() => void handleDeletePermanently()}
        onCancel={() => setConfirmDelete(false)}
      />
      {/* Action */}
      {isOwnProfile && !isHR && !editingOwnDetails && (
        <div className="flex justify-end mb-2">
          <button onClick={startEditingOwnDetails} className="btn-orange px-4 py-2 text-xs font-bold rounded-2xl">
            Edit About Details
          </button>
        </div>
      )}
      {isHR && isDeactivated && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 p-4">
          <div>
            <p className="text-sm font-black text-red-700">This profile is deactivated</p>
            <p className="text-xs font-semibold text-red-600/80 mt-0.5">
              {employee.name} can't sign in and is hidden from the directory, attendance and other lists.
            </p>
          </div>
          <button
            onClick={() => void handleReactivate()}
            disabled={reactivating}
            className="btn-orange px-4 py-2 text-xs font-bold rounded-2xl flex-shrink-0"
          >
            {reactivating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Reactivate
          </button>
        </div>
      )}
      {isHR && !isDeactivated && !employee.user && !editing && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-black text-amber-800">No login yet</p>
            <p className="text-xs font-semibold text-amber-700/80 mt-0.5">
              {employee.name} can't sign in to the portal until you create a username and password.
            </p>
          </div>
          <button
            onClick={() => void startEditing({ createLogin: true })}
            className="btn-orange px-4 py-2 text-xs font-bold rounded-2xl flex-shrink-0"
          >
            Create login
          </button>
        </div>
      )}
      {isHR && !editing && (
        <div className="flex flex-wrap justify-end gap-2 sm:gap-3 mb-3">
          {!isOwnProfile && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="px-4 py-2 bg-white hover:bg-red-50 border border-red-300 text-red-600 text-xs font-bold rounded-2xl transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Delete Permanently
            </button>
          )}
          {!isOwnProfile && !isDeactivated && <button
            onClick={handleDeactivate}
            disabled={deactivating}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-2xl transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-sm shadow-red-500/10"
          >
            {deactivating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Deactivate Profile
          </button>}
          <button
            onClick={() => void startEditing()}
            className="btn-orange px-4 py-2 text-xs font-bold rounded-2xl"
          >
            Edit Profile
          </button>
        </div>
      )}

      {editing ? (
        <div className="bg-white rounded-[28px] p-6 border border-orange-100 shadow-sm space-y-5 text-slate-800">
          <h3 className="text-slate-850 font-black text-lg mb-2">Edit Profile Details</h3>
          {saveError && (
            <div className="rounded-xl border border-red-250 bg-red-50 px-4 py-3 text-xs font-semibold text-red-600">
              {saveError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Full Name', key: 'name' },
              { label: 'Biometric ID / EnNo', key: 'biometricId' },
              { label: 'Position', key: 'position' },
              { label: 'Department', key: 'department', options: DEPARTMENTS, placeholder: 'Select department' },
              { label: 'Phone', key: 'phone' },
              { label: 'Email', key: 'email' },
              { label: 'Employee Type', key: 'employeeType', options: EMPLOYEE_TYPES, placeholder: 'Select employee type' },
              { label: 'Join Date', key: 'joinDate', type: 'date' },
              { label: 'Date of Birth', key: 'dateOfBirth', type: 'date' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{f.label}</label>
                {f.options ? (
                  <select
                    value={String(form[f.key as keyof typeof form] ?? '')}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all cursor-pointer"
                  >
                    <option value="">{f.placeholder}</option>
                    {optionsWithCurrent(f.options, String(form[f.key as keyof typeof form] ?? '')).map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type || 'text'}
                    value={String(form[f.key as keyof typeof form] ?? '')}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
                  />
                )}
              </div>
            ))}

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Gender</label>
              <select
                value={form.gender}
                onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all cursor-pointer"
              >
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other / Prefer not to say</option>
              </select>
            </div>

            <div className="col-span-1 sm:col-span-2">
              <AvatarUploadPicker
                name={form.name || employee.name}
                avatar={form.avatar || employee.avatar}
                gender={form.gender || employee.gender}
                disabled={saving}
                loading={avatarSaving}
                status={avatarStatus}
                onSelect={handleAvatarSelect}
              />
            </div>
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Skills (comma separated)</label>
              <input
                value={form.skills}
                onChange={e => setForm(p => ({ ...p, skills: e.target.value }))}
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Bio</label>
              <textarea
                rows={3}
                value={form.bio}
                onChange={e => setForm(p => ({ ...p, bio: e.target.value }))}
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all resize-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Education</label>
              <input
                value={form.education}
                onChange={e => setForm(p => ({ ...p, education: e.target.value }))}
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Experience</label>
              <input
                value={form.experience}
                onChange={e => setForm(p => ({ ...p, experience: e.target.value }))}
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tally Ledger Name</label>
              <input
                value={form.tallyLedgerName}
                onChange={e => setForm(p => ({ ...p, tallyLedgerName: e.target.value }))}
                placeholder="Exact Tally payroll ledger name"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div className="col-span-1 sm:col-span-2 pt-2 border-t border-orange-100/60">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Payroll & Statutory Details</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Employee Number</label>
              <input
                value={form.employeeNumber}
                onChange={e => setForm(p => ({ ...p, employeeNumber: e.target.value }))}
                placeholder="e.g. Afac10375"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tax Regime</label>
              <input
                value={form.taxRegime}
                onChange={e => setForm(p => ({ ...p, taxRegime: e.target.value }))}
                placeholder="e.g. Regular Tax Regime"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">PAN Number</label>
              <input
                value={form.panNumber}
                onChange={e => setForm(p => ({ ...p, panNumber: e.target.value }))}
                placeholder="e.g. IRLPK0350R"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">UAN Number</label>
              <input
                value={form.uanNumber}
                onChange={e => setForm(p => ({ ...p, uanNumber: e.target.value }))}
                placeholder="Universal Account Number"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">PF Account Number</label>
              <input
                value={form.pfAccountNumber}
                onChange={e => setForm(p => ({ ...p, pfAccountNumber: e.target.value }))}
                placeholder="e.g. 1021632"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">ESI Number</label>
              <input
                value={form.esiNumber}
                onChange={e => setForm(p => ({ ...p, esiNumber: e.target.value }))}
                placeholder="ESI account number"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">PR Account Number (PRAN)</label>
              <input
                value={form.pranNumber}
                onChange={e => setForm(p => ({ ...p, pranNumber: e.target.value }))}
                placeholder="Pension Account Number"
                className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
              />
            </div>
            {/* Manager Assignment */}
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Managers (Reports To)</label>
              <div className="bg-white border border-orange-100 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                {managerOptions.length === 0 ? (
                  <p className="text-slate-400 text-xs italic">No managers available</p>
                ) : (
                  managerOptions.map(option => (
                    <label key={option.employeeId} className="flex items-center gap-2.5 cursor-pointer hover:opacity-85 select-none">
                      <input
                        type="checkbox"
                        checked={form.managerIds.includes(option.employeeId)}
                        onChange={e => {
                          if (e.target.checked) {
                            setForm(p => ({
                              ...p,
                              managerIds: [...p.managerIds, option.employeeId]
                            }));
                          } else {
                            setForm(p => ({
                              ...p,
                              managerIds: p.managerIds.filter(id => id !== option.employeeId)
                            }));
                          }
                        }}
                        className="w-4 h-4 rounded border-orange-200 text-[#f46617] focus:ring-brand-orange/30 accent-[#f46617] cursor-pointer"
                      />
                      <span className="text-sm text-slate-700 font-semibold">
                        {option.name}
                        {option.position ? ` - ${option.position}` : ''}
                        {option.roleHint === 'LEADERSHIP' ? ' (Leadership)' : ''}
                        {option.roleHint === 'MANAGER' ? ' (Manager)' : ''}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {form.managerIds.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2 animate-scale-in">
                  {form.managerIds.map(managerId => {
                    const mgr = managerOptions.find(m => m.employeeId === managerId);
                    return mgr ? (
                      <span key={managerId} className="text-xs px-2.5 py-1 bg-orange-50 text-[#f46617] border border-orange-100 rounded-full flex items-center gap-1 font-bold">
                        {mgr.name}
                        <button
                          type="button"
                          onClick={() => setForm(p => ({
                            ...p,
                            managerIds: p.managerIds.filter(id => id !== managerId)
                          }))}
                          className="ml-1 hover:opacity-75"
                        >
                          ✕
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            {/* User Account Details Section */}
            {!employee.user ? (
              <div id="login-account-section" className="col-span-1 sm:col-span-2 pt-2 space-y-4">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.createUser}
                    onChange={e => setForm(p => ({ ...p, createUser: e.target.checked }))}
                    disabled={saving}
                    className="w-4 h-4 rounded border-orange-200 text-[#f46617] focus:ring-brand-orange/30 accent-[#f46617] cursor-pointer bg-white"
                  />
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    Create User Account (System Access)
                  </span>
                </label>

                {form.createUser && (
                  <div className="p-4 rounded-2xl border border-orange-100 bg-orange-50/20 space-y-4 animate-scale-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                          Username *
                        </label>
                        <input
                          type="text"
                          required={form.createUser}
                          value={form.username}
                          onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                          disabled={saving}
                          placeholder="Username for login"
                          className="w-full text-slate-800 bg-white text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                          Password *
                        </label>
                        <input
                          type="password"
                          required={form.createUser}
                          value={form.password}
                          onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                          disabled={saving}
                          placeholder="Min 6 characters"
                          className="w-full text-slate-800 bg-white text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                          Access Role
                        </label>
                        <select
                          value={form.systemRole}
                          onChange={e => setForm(p => ({ ...p, systemRole: e.target.value as UserRole }))}
                          disabled={saving}
                          className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all cursor-pointer"
                        >
                          <option value="EMPLOYEE">Employee (Standard Access)</option>
                          <option value="MANAGER">Manager (Team Approval/Performance)</option>
                          <option value="HR">HR Admin (Full Access)</option>
                          <option value="LEADERSHIP">Leadership (Company-wide Visibility)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div id="login-account-section" className="col-span-1 sm:col-span-2 pt-2 space-y-4">
                <div className="p-4 rounded-2xl border border-orange-100 bg-orange-50/20 space-y-4">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Login Account</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                        Username
                      </label>
                      <input
                        type="text"
                        value={form.username}
                        onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                        disabled={saving}
                        maxLength={50}
                        autoComplete="off"
                        className="w-full text-slate-800 bg-white text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                        disabled={saving}
                        autoComplete="new-password"
                        placeholder="Leave blank to keep current"
                        className="w-full text-slate-800 bg-white text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400"
                      />
                      <p className="text-[10px] text-slate-400 mt-1.5">Set one if the employee forgot theirs, and tell them.</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                        Access Role
                      </label>
                      <select
                        value={form.systemRole}
                        onChange={e => setForm(p => ({ ...p, systemRole: e.target.value as UserRole }))}
                        disabled={saving}
                        className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all cursor-pointer"
                      >
                        <option value="EMPLOYEE">Employee (Standard Access)</option>
                        <option value="MANAGER">Manager (Team Approval/Performance)</option>
                        <option value="HR">HR Admin (Full Access)</option>
                        <option value="LEADERSHIP">Leadership (Company-wide Visibility)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-3 border-t border-orange-100/30">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-orange px-5 py-2.5 text-xs font-bold rounded-xl"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save Changes
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-5 py-2.5 bg-white border border-slate-250 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : editingOwnDetails ? (
        <div className="bg-white rounded-[28px] p-6 border border-orange-100 shadow-sm space-y-5 text-slate-800">
          <div>
            <h3 className="text-slate-850 font-black text-lg">Edit About Details</h3>
            <p className="text-xs text-slate-400 mt-1">Keep your professional profile current for colleagues and managers.</p>
          </div>
          {saveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-600">{saveError}</div>
          )}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Bio Description</label>
            <textarea rows={4} value={form.bio} onChange={event => setForm(previous => ({ ...previous, bio: event.target.value }))} className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 resize-none" placeholder="Write a short professional introduction" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Date of Birth</label>
            <input type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth} onChange={event => setForm(previous => ({ ...previous, dateOfBirth: event.target.value }))} className="w-full sm:w-64 bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20" />
            <p className="text-[11px] text-slate-400 font-semibold mt-1">Colleagues only ever see the day and month, so we can celebrate your birthday.</p>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Specialist Skills</label>
            <input value={form.skills} onChange={event => setForm(previous => ({ ...previous, skills: event.target.value }))} className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20" placeholder="React, Payroll, Recruitment (comma separated)" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Education Details</label>
              <textarea rows={3} value={form.education} onChange={event => setForm(previous => ({ ...previous, education: event.target.value }))} className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 resize-none" placeholder="Degree, institution and specialization" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Professional Experience</label>
              <textarea rows={3} value={form.experience} onChange={event => setForm(previous => ({ ...previous, experience: event.target.value }))} className="w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 resize-none" placeholder="Summarize your professional experience" />
            </div>
          </div>
          <div className="flex gap-3 pt-3 border-t border-orange-100/30">
            <button onClick={handleOwnDetailsSave} disabled={saving} className="btn-orange px-5 py-2.5 text-xs font-bold rounded-xl">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save Details
            </button>
            <button onClick={() => setEditingOwnDetails(false)} disabled={saving} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* About: bio, skills, education, experience in one card — only what's filled in */}
          <div className="md:col-span-2 bg-white rounded-3xl p-4 sm:p-6 border border-orange-100/50 shadow-card">
            <h3 className="text-slate-800 font-black text-sm mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-[#f46617]" />
              About
            </h3>
            {!employee.bio && skills.length === 0 && !employee.education && !employee.experience ? (
              <p className="text-slate-400 text-sm italic font-medium">
                {isOwnProfile ? 'Nothing added yet — use Edit to add a bio, skills, education and experience.' : 'Nothing added yet.'}
              </p>
            ) : (
              <div className="space-y-4">
                {employee.bio && <p className="text-slate-600 text-sm leading-relaxed font-medium">{employee.bio}</p>}
                {skills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-orange-500" /> Skills
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {skills.map((s, i) => (
                        <span key={i} className="text-xs font-bold px-3 py-1 bg-orange-50 text-[#f46617] border border-orange-100/60 rounded-full">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(employee.education || employee.experience) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {employee.education && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <GraduationCap className="w-3.5 h-3.5 text-[#f46617]" /> Education
                        </p>
                        <p className="text-slate-700 text-sm font-semibold">{employee.education}</p>
                      </div>
                    )}
                    {employee.experience && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <Briefcase className="w-3.5 h-3.5 text-[#f46617]" /> Experience
                        </p>
                        <p className="text-slate-700 text-sm font-semibold">{employee.experience}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="md:col-span-2 bg-white rounded-3xl p-4 sm:p-6 border border-orange-100/50 shadow-card">
            <h3 className="text-slate-850 font-black text-sm mb-4">Employee Status Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Biometric ID', value: employee.biometricId ? `#${employee.biometricId}` : '—' },
                { label: 'Employee Type', value: employee.employeeType || '—' },
                { label: 'Department', value: employee.department || '—' },
                { label: 'Tally Ledger', value: employee.tallyLedgerName || '—' },
                { label: 'Username', value: employee.user?.username || '—' },
              ].map(d => (
                <div key={d.label}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{d.label}</p>
                  <p className="text-sm text-slate-800 font-black tracking-tight">{d.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* PAN/bank details are only sent to HR and the employee themselves. */}
          {(isHR || isOwnProfile) && (
            <PayrollDetailsCard
              employee={employee}
              canEdit={isHR || isOwnProfile}
              onSaved={onRefresh}
            />
          )}

          {isHR && !isOwnProfile && isAccountsDepartment(employee.department) && (
            <PayrollAccessCard employee={employee} onSaved={onRefresh} />
          )}
        </div>
      )}
    </div>
  );
};

// ─── Payroll Upload Access (HR → selected Accounts staff) ─────

const isAccountsDepartment = (department: string | null | undefined) =>
  Boolean(department && /\baccounts?\b/i.test(department));

const PayrollAccessCard: React.FC<{ employee: EmployeeDetail; onSaved: () => void }> = ({ employee, onSaved }) => {
  const enabled = Boolean(employee.user?.canImportPayroll);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      await employeeApi.setPayrollAccess(employee.id, !enabled);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payroll access');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-[28px] p-6 border border-orange-100 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-slate-800 font-black text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#f46617]" /> Payroll Upload Access
          </h3>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {employee.user
              ? enabled
                ? `${employee.name} can upload Tally salary sheets and see the payroll import history.`
                : `Allow ${employee.name} to upload Tally salary sheets (Salary → Import).`
              : `${employee.name} needs a login account before access can be given.`}
          </p>
        </div>
        {employee.user && (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Payroll upload access"
            onClick={() => void toggle()}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? 'bg-[#f46617]' : 'bg-slate-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        )}
      </div>
      {error && <p className="text-xs font-semibold text-red-600 mt-3">{error}</p>}
    </div>
  );
};

// ─── Account Settings Section ─────────────────────────────────

const AccountSettingsSection: React.FC<{
  employee: EmployeeDetail;
  onAvatarUpdated: () => Promise<void>;
}> = ({ employee, onAvatarUpdated }) => {
  const { user, refreshUser } = useAuth();

  const [usernameForm, setUsernameForm] = useState({
    newUsername: user?.username || '',
    currentPassword: '',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [usernameStatus, setUsernameStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });

  const [passwordStatus, setPasswordStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });

  const [savingUsername, setSavingUsername] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [showCurrentPw1, setShowCurrentPw1] = useState(false);
  const [showCurrentPw2, setShowCurrentPw2] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<string | null>(null);

  const handleAvatarSelect = async (file: File) => {
    console.log('[Profile/AccountSettings] avatar:onSelect:start', {
      userId: user?.id,
      employeeId: user?.employeeId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
    setAvatarSaving(true);
    setAvatarStatus(null);
    try {
      const compressed = await compressAvatarImage(file);
      console.log('[Profile/AccountSettings] avatar:compressed', {
        userId: user?.id,
        employeeId: user?.employeeId,
        fileName: compressed.name,
        fileType: compressed.type,
        fileSize: compressed.size,
      });
      const response = await authApi.updateAvatar(compressed);
      console.log('[Profile/AccountSettings] avatar:update-response', response);
      setAvatarStatus('Photo updated successfully');
      // Reloads the profile and the signed-in user (header photo).
      await onAvatarUpdated();
      console.log('[Profile/AccountSettings] avatar:onAvatarUpdated-complete');
    } catch (err: any) {
      console.error('[Profile/AccountSettings] avatar:error', err);
      setAvatarStatus(err.message || 'Failed to update photo');
      throw err;
    } finally {
      console.log('[Profile/AccountSettings] avatar:onSelect:done', {
        userId: user?.id,
        employeeId: user?.employeeId,
      });
      setAvatarSaving(false);
    }
  };

  const handleUpdateUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameForm.currentPassword.trim()) {
      setUsernameStatus({ type: 'error', message: 'Current password is required to confirm identity.' });
      return;
    }
    if (!usernameForm.newUsername.trim()) {
      setUsernameStatus({ type: 'error', message: 'New username cannot be empty.' });
      return;
    }
    if (usernameForm.newUsername.trim() === user?.username) {
      setUsernameStatus({ type: 'error', message: 'New username is the same as your current one.' });
      return;
    }

    setSavingUsername(true);
    setUsernameStatus({ type: null, message: '' });
    try {
      await authApi.updateCredentials({
        username: usernameForm.newUsername.trim(),
        currentPassword: usernameForm.currentPassword,
      });
      setUsernameStatus({ type: 'success', message: 'Username updated successfully! Your new username is active immediately.' });
      setUsernameForm(p => ({ ...p, currentPassword: '' }));
      await refreshUser();
    } catch (err: any) {
      setUsernameStatus({ type: 'error', message: err.message || 'Failed to update username.' });
    } finally {
      setSavingUsername(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordForm.currentPassword.trim()) {
      setPasswordStatus({ type: 'error', message: 'Current password is required.' });
      return;
    }
    if (!passwordForm.newPassword.trim()) {
      setPasswordStatus({ type: 'error', message: 'New password cannot be empty.' });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordStatus({ type: 'error', message: 'New password must be at least 6 characters.' });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'New password and confirm password do not match.' });
      return;
    }
    if (passwordForm.currentPassword === passwordForm.newPassword) {
      setPasswordStatus({ type: 'error', message: 'New password must be different from your current password.' });
      return;
    }

    setSavingPassword(true);
    setPasswordStatus({ type: null, message: '' });
    try {
      await authApi.updateCredentials({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordStatus({ type: 'success', message: 'Password updated successfully! Use your new password the next time you log in.' });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      setPasswordStatus({ type: 'error', message: err.message || 'Failed to update password.' });
    } finally {
      setSavingPassword(false);
    }
  };

  const inputClass = "w-full bg-white text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 pr-10";
  const labelClass = "block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5";

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-orange-400 to-[#f46617] flex items-center justify-center shadow-lg shadow-orange-500/20">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-800 leading-tight">Account Settings</h3>
          <p className="text-xs text-slate-500 font-semibold">Manage your login credentials privately</p>
        </div>
      </div>

      <div className="rounded-2xl bg-amber-50/60 border border-amber-100 px-4 py-3 text-xs text-amber-700 font-semibold flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
        <span>For your privacy, changes to credentials are hashed and encrypted. Even system administrators cannot read your password.</span>
      </div>

      {/* ── Change Username ── */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-orange-100/50 shadow-card space-y-3">
        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center text-[#f46617] border border-orange-100">
            <Camera className="w-3.5 h-3.5" />
          </span>
          Profile Photo
        </h4>
        <AvatarUploadPicker
          name={employee.name}
          avatar={employee.avatar}
          gender={employee.gender}
          loading={avatarSaving}
          status={avatarStatus}
          onSelect={handleAvatarSelect}
        />
      </div>

      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-orange-100/50 shadow-card space-y-4">
        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center text-[#f46617] text-[10px] font-black border border-orange-100">@</span>
          Change Username
        </h4>
        <p className="text-xs text-slate-500 font-medium -mt-1">
          Current username: <span className="font-black text-slate-700">{user?.username}</span>
        </p>

        <form onSubmit={handleUpdateUsername} className="space-y-4">
          <div>
            <label className={labelClass}>New Username</label>
            <input
              type="text"
              value={usernameForm.newUsername}
              onChange={e => setUsernameForm(p => ({ ...p, newUsername: e.target.value }))}
              placeholder="Enter new username"
              disabled={savingUsername}
              className={inputClass.replace('pr-10', '')}
            />
          </div>

          <div>
            <label className={labelClass}>Confirm with Current Password</label>
            <div className="relative">
              <input
                type={showCurrentPw1 ? 'text' : 'password'}
                value={usernameForm.currentPassword}
                onChange={e => setUsernameForm(p => ({ ...p, currentPassword: e.target.value }))}
                placeholder="Enter current password to confirm"
                disabled={savingUsername}
                className={inputClass}
              />
              <button type="button" onClick={() => setShowCurrentPw1(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold">
                {showCurrentPw1 ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {usernameStatus.type && (
            <div className={`flex items-start gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 ${usernameStatus.type === 'success' ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-red-50 border border-red-100 text-red-600'}`}>
              {usernameStatus.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <span>{usernameStatus.message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={savingUsername}
            className="btn-orange px-5 py-2.5 text-xs font-bold rounded-xl flex items-center gap-2 disabled:opacity-60"
          >
            {savingUsername ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {savingUsername ? 'Updating...' : 'Update Username'}
          </button>
        </form>
      </div>

      {/* ── Change Password ── */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-orange-100/50 shadow-card space-y-4">
        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center text-[#f46617] border border-orange-100">
            <Shield className="w-3 h-3" />
          </span>
          Change Password
        </h4>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <label className={labelClass}>Current Password</label>
            <div className="relative">
              <input
                type={showCurrentPw2 ? 'text' : 'password'}
                value={passwordForm.currentPassword}
                onChange={e => setPasswordForm(p => ({ ...p, currentPassword: e.target.value }))}
                placeholder="Enter your current password"
                disabled={savingPassword}
                className={inputClass}
              />
              <button type="button" onClick={() => setShowCurrentPw2(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold">
                {showCurrentPw2 ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass}>New Password</label>
            <div className="relative">
              <input
                type={showNewPw ? 'text' : 'password'}
                value={passwordForm.newPassword}
                onChange={e => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))}
                placeholder="Min 6 characters"
                disabled={savingPassword}
                className={inputClass}
              />
              <button type="button" onClick={() => setShowNewPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold">
                {showNewPw ? 'Hide' : 'Show'}
              </button>
            </div>
            {/* Password strength indicator */}
            {passwordForm.newPassword && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all ${
                      passwordForm.newPassword.length >= i * 3
                        ? i <= 1 ? 'bg-red-400' : i <= 2 ? 'bg-amber-400' : i <= 3 ? 'bg-yellow-400' : 'bg-emerald-400'
                        : 'bg-slate-100'
                    }`} />
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 font-semibold">
                  {passwordForm.newPassword.length < 6 ? 'Too short' : passwordForm.newPassword.length < 9 ? 'Fair' : passwordForm.newPassword.length < 12 ? 'Good' : 'Strong'}
                </p>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Confirm New Password</label>
            <div className="relative">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                value={passwordForm.confirmPassword}
                onChange={e => setPasswordForm(p => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="Repeat your new password"
                disabled={savingPassword}
                className={inputClass}
              />
              <button type="button" onClick={() => setShowConfirmPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold">
                {showConfirmPw ? 'Hide' : 'Show'}
              </button>
            </div>
            {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
              <p className="text-[10px] text-red-500 font-semibold mt-1">Passwords do not match</p>
            )}
            {passwordForm.confirmPassword && passwordForm.newPassword === passwordForm.confirmPassword && passwordForm.newPassword.length >= 6 && (
              <p className="text-[10px] text-emerald-600 font-semibold mt-1 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Passwords match</p>
            )}
          </div>

          {passwordStatus.type && (
            <div className={`flex items-start gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 ${passwordStatus.type === 'success' ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-red-50 border border-red-100 text-red-600'}`}>
              {passwordStatus.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <span>{passwordStatus.message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={savingPassword}
            className="btn-orange px-5 py-2.5 text-xs font-bold rounded-xl flex items-center gap-2 disabled:opacity-60"
          >
            {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {savingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

const Profile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const employeeId = parseInt(id || '', 10);

  const initialTab = (() => {
    const param = new URLSearchParams(location.search).get('tab');
    if (param === 'leaves' || param === 'performance' || param === 'attendance' || param === 'assets' || param === 'documents' || param === 'salary') return param as Tab;
    return 'about' as Tab;
  })();

  return (
    <div className="min-h-screen bg-app-bg relative flex flex-col font-sans p-4 lg:p-6 overflow-x-hidden">
      {/* Background Glowing Blobs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-brand-orange/10 blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-400/5 blur-[120px] pointer-events-none animate-pulse-slow" />

      <div className="max-w-5xl w-full mx-auto relative z-10 flex-1 flex flex-col justify-center animate-scale-in">
        <ProfileView
          employeeId={employeeId}
          initialTab={initialTab}
          onBack={() => navigate('/')}
          onOpenEmployee={(empId) => navigate(`/profile/${empId}`)}
        />
      </div>
    </div>
  );
};

export default Profile;
