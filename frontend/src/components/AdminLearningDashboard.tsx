import React, { useEffect, useState } from 'react';
import { BarChart3, Loader2, AlertTriangle, ChevronRight, ChevronDown, ArrowLeft, Users, User } from 'lucide-react';
import { learningApi, type DepartmentLearningSummary, type TeamLearningSummary, type MemberLearningSummary } from '../services/api';
import { EmployeeAvatar } from './EmployeeAvatar';
import { matchesSearch, type PageFilterState } from '../utils/pageFilters';

type DrillLevel =
  | { level: 'departments' }
  | { level: 'teams'; department: string }
  | { level: 'members'; department: string; managerId: number | 'none'; managerName: string };

const RollupRow: React.FC<{
  label: string;
  sub?: string;
  stats: { total: number; completed: number; inProgress: number; overdue: number; completionRate: number };
  onClick?: () => void;
  avatar?: { name: string; avatar: string | null; gender: string | null };
}> = ({ label, sub, stats, onClick, avatar }) => (
  <div
    onClick={onClick}
    className={`px-5 py-4 space-y-2 ${onClick ? 'cursor-pointer hover:bg-orange-50/30 transition-colors' : ''}`}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {avatar && <EmployeeAvatar name={avatar.name} avatar={avatar.avatar} gender={avatar.gender} size="w-8 h-8" shape="rounded" />}
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">{label}</p>
          {sub && <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">{sub}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-400 flex-shrink-0">
        <span>{stats.total} enrolled</span>
        <span className="text-emerald-600">{stats.completed} done</span>
        <span>{stats.inProgress} in progress</span>
        {stats.overdue > 0 && (
          <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {stats.overdue} overdue</span>
        )}
        {onClick && <ChevronRight className="w-4 h-4 text-slate-300" />}
      </div>
    </div>
    <div className="w-full h-2 bg-orange-50 rounded-full overflow-hidden">
      <div className="h-full bg-[#f46617] rounded-full transition-all duration-500" style={{ width: `${stats.completionRate}%` }} />
    </div>
    <p className="text-[11px] font-bold text-slate-400">{stats.completionRate}% complete</p>
  </div>
);

export const AdminLearningDashboard: React.FC<{ filters?: PageFilterState }> = ({ filters }) => {
  const [departments, setDepartments] = useState<DepartmentLearningSummary[]>([]);
  const [teams, setTeams] = useState<TeamLearningSummary[]>([]);
  const [members, setMembers] = useState<MemberLearningSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drill, setDrill] = useState<DrillLevel>({ level: 'departments' });

  useEffect(() => {
    learningApi.getDepartmentSummary()
      .then(res => { if (res.data) setDepartments(res.data.departments); })
      .finally(() => setLoading(false));
  }, []);

  const openTeams = (department: string) => {
    setDrillLoading(true);
    setDrill({ level: 'teams', department });
    learningApi.getDepartmentTeams(department)
      .then(res => { if (res.data) setTeams(res.data.teams); })
      .finally(() => setDrillLoading(false));
  };

  const openMembers = (department: string, managerId: number | null, managerName: string) => {
    const key = managerId ?? 'none';
    setDrillLoading(true);
    setDrill({ level: 'members', department, managerId: key, managerName });
    learningApi.getTeamMembers(key, department)
      .then(res => { if (res.data) setMembers(res.data.members); })
      .finally(() => setDrillLoading(false));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-[#f46617] animate-spin" />
      </div>
    );
  }

  const totals = departments.reduce(
    (acc, d) => ({
      total: acc.total + d.total,
      completed: acc.completed + d.completed,
      overdue: acc.overdue + d.overdue,
    }),
    { total: 0, completed: 0, overdue: 0 }
  );
  const overallRate = totals.total > 0 ? Math.round((totals.completed / totals.total) * 100) : 0;
  const maxDeptTotal = Math.max(1, ...departments.map(d => d.total));
  const filteredDepartments = filters
    ? departments.filter(d => matchesSearch(filters.search, [d.department, d.total, d.completed, d.inProgress, d.overdue, d.completionRate]))
    : departments;
  const filteredTeams = filters
    ? teams.filter(t => matchesSearch(filters.search, [t.managerName, t.total, t.completed, t.inProgress, t.overdue, t.completionRate]))
    : teams;
  const filteredMembers = filters
    ? members.filter(m => matchesSearch(filters.search, [m.name, m.position, m.total, m.completed, m.inProgress, m.overdue, m.completionRate]))
    : members;

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Org-wide completion — click a row to drill down</p>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Enrollments', value: totals.total },
          { label: 'Overall Completion', value: `${overallRate}%` },
          { label: 'Overdue', value: totals.overdue, danger: totals.overdue > 0 },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-[24px] p-5 border border-orange-100/50 shadow-card text-center">
            <p className={`text-3xl font-black tracking-tight ${'danger' in s && s.danger ? 'text-red-500' : 'text-slate-800'}`}>{s.value}</p>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Cross-department comparison chart (FR-6.10) */}
      {departments.length > 1 && (
        <div className="bg-white rounded-[24px] border border-orange-100/50 shadow-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Completion by Department
          </h3>
          <div className="space-y-3">
            {filteredDepartments.map(d => (
              <div key={d.department} className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-600 w-28 truncate flex-shrink-0">{d.department}</span>
                <div className="flex-1 h-5 bg-orange-50 rounded-lg overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-orange-300 to-[#f46617] rounded-lg transition-all duration-500"
                    style={{ width: `${Math.max(2, (d.total / maxDeptTotal) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-700 w-12 text-right flex-shrink-0">{d.completionRate}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      {drill.level !== 'departments' && (
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <button onClick={() => setDrill({ level: 'departments' })} className="flex items-center gap-1 hover:text-[#f46617] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Departments
          </button>
          <ChevronDown className="w-3 h-3 -rotate-90 text-slate-300" />
          {drill.level === 'teams' && <span className="text-slate-800">{drill.department}</span>}
          {drill.level === 'members' && (
            <>
              <button onClick={() => openTeams(drill.department)} className="hover:text-[#f46617] transition-colors">{drill.department}</button>
              <ChevronDown className="w-3 h-3 -rotate-90 text-slate-300" />
              <span className="text-slate-800">{drill.managerName}</span>
            </>
          )}
        </div>
      )}

      {drillLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#f46617] animate-spin" />
        </div>
      ) : drill.level === 'departments' ? (
        filteredDepartments.length === 0 ? (
          <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
            <p className="font-semibold">No enrollment data yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-[24px] border border-orange-100/50 shadow-card overflow-hidden divide-y divide-orange-100/40">
            {filteredDepartments.map(d => (
              <RollupRow key={d.department} label={d.department} stats={d} onClick={() => openTeams(d.department)} />
            ))}
          </div>
        )
      ) : drill.level === 'teams' ? (
        filteredTeams.length === 0 ? (
          <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
            <p className="font-semibold">No teams found in this department</p>
          </div>
        ) : (
          <div className="bg-white rounded-[24px] border border-orange-100/50 shadow-card overflow-hidden divide-y divide-orange-100/40">
            {filteredTeams.map(t => (
              <RollupRow
                key={t.managerId ?? 'none'}
                label={t.managerName}
                sub="Team"
                stats={t}
                onClick={() => openMembers(drill.department, t.managerId, t.managerName)}
              />
            ))}
          </div>
        )
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <User className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No team members found</p>
        </div>
      ) : (
        <div className="bg-white rounded-[24px] border border-orange-100/50 shadow-card overflow-hidden divide-y divide-orange-100/40">
          {filteredMembers.map(m => (
            <RollupRow
              key={m.employeeId}
              label={m.name}
              sub={m.position || undefined}
              stats={m}
              avatar={{ name: m.name, avatar: m.avatar, gender: m.gender }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
