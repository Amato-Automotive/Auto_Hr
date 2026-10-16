import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, Filter, Users, Building2, UserPlus2, AlertCircle, LayoutGrid, List,
  ChevronRight, ChevronLeft, Mail, Phone, ArrowUpDown, X, Briefcase,
} from 'lucide-react';
import type { Employee } from '../services/api';
import { EmployeeAvatar } from './EmployeeAvatar';
import { DropdownSelect } from './DropdownSelect';

type SortKey = 'name-asc' | 'name-desc' | 'joined-desc' | 'department';
type ViewMode = 'table' | 'grid';

const PAGE_SIZE = 25;
const VIEW_STORAGE_KEY = 'employee-directory-view';

// Stable, distinct colour per department so the same team always reads the same.
const DEPARTMENT_STYLES = [
  'bg-orange-50 text-orange-700 ring-orange-200/70',
  'bg-sky-50 text-sky-700 ring-sky-200/70',
  'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  'bg-violet-50 text-violet-700 ring-violet-200/70',
  'bg-rose-50 text-rose-700 ring-rose-200/70',
  'bg-amber-50 text-amber-800 ring-amber-200/70',
  'bg-teal-50 text-teal-700 ring-teal-200/70',
  'bg-indigo-50 text-indigo-700 ring-indigo-200/70',
];

function departmentStyle(department: string): string {
  let hash = 0;
  for (const char of department) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DEPARTMENT_STYLES[hash % DEPARTMENT_STYLES.length]!;
}

const ROLE_LABELS: Partial<Record<string, string>> = { MANAGER: 'Manager', HR: 'HR', LEADERSHIP: 'Leadership' };

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const isIncomplete = (e: Employee) => !e.department || !e.position || (!e.email && !e.phone);

const Empty: React.FC = () => <span className="text-slate-300">—</span>;

const DepartmentChip: React.FC<{ department: string | null }> = ({ department }) =>
  department ? (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ring-1 ring-inset whitespace-nowrap ${departmentStyle(department)}`}>
      {department}
    </span>
  ) : (
    <span className="text-xs font-semibold text-slate-300">Unassigned</span>
  );

const RolePill: React.FC<{ employee: Employee }> = ({ employee }) => {
  const label = employee.user?.role ? ROLE_LABELS[employee.user.role] : undefined;
  if (!label) return null;
  return (
    <span className="px-1.5 py-0.5 rounded-md bg-slate-900/5 text-slate-600 text-[10px] font-bold uppercase tracking-wide flex-shrink-0">
      {label}
    </span>
  );
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}> = ({ icon, label, value, hint, active, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`text-left rounded-2xl border p-4 transition-all ${
        active
          ? 'border-[#f46617]/50 bg-orange-50/60 ring-2 ring-[#f46617]/15'
          : 'border-slate-200/70 bg-white hover:border-orange-200'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#f46617] flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-black text-slate-800 leading-none tabular-nums">{value}</p>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1 truncate">{label}</p>
        </div>
      </div>
      {hint && <p className="text-[11px] text-slate-400 font-semibold mt-2">{hint}</p>}
    </Tag>
  );
};

export interface EmployeeDirectoryProps {
  employees: Employee[];
  onOpenProfile: (employeeId: number) => void;
  /** Page actions (e.g. Add Employee) rendered in the header. */
  actions?: React.ReactNode;
  /** Shows HR-oriented insights such as incomplete profiles. */
  showAdminInsights?: boolean;
}

export const EmployeeDirectory: React.FC<EmployeeDirectoryProps> = ({
  employees,
  onOpenProfile,
  actions,
  showAdminInsights = false,
}) => {
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('ALL');
  const [employeeType, setEmployeeType] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('name-asc');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [page, setPage] = useState(1);
  // Phones show only the search box until "Filters" is tapped.
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'table';
    } catch {
      return 'table';
    }
  });

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore — the choice just won't be remembered
    }
  };

  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter((d): d is string => Boolean(d)))).sort(),
    [employees]
  );
  const employeeTypes = useMemo(
    () => Array.from(new Set(employees.map(e => e.employeeType).filter((t): t is string => Boolean(t)))).sort(),
    [employees]
  );

  const stats = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      total: employees.length,
      departments: departments.length,
      newJoiners: employees.filter(e => e.joinDate && new Date(e.joinDate).getTime() >= thirtyDaysAgo).length,
      incomplete: employees.filter(isIncomplete).length,
    };
  }, [employees, departments]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = employees.filter(e => {
      if (department !== 'ALL' && e.department !== department) return false;
      if (employeeType !== 'ALL' && e.employeeType !== employeeType) return false;
      if (onlyIncomplete && !isIncomplete(e)) return false;
      if (!query) return true;
      return [e.name, e.position, e.email, e.phone, e.department, e.employeeNumber, e.manager?.name, e.biometricId?.toString()]
        .some(value => value?.toLowerCase().includes(query));
    });

    const byName = (a: Employee, b: Employee) => a.name.localeCompare(b.name);
    switch (sort) {
      case 'name-desc':
        return result.sort((a, b) => byName(b, a));
      case 'joined-desc':
        return result.sort((a, b) => (b.joinDate ?? '').localeCompare(a.joinDate ?? '') || byName(a, b));
      case 'department':
        return result.sort((a, b) =>
          (a.department ?? '￿').localeCompare(b.department ?? '￿') || byName(a, b)
        );
      default:
        return result.sort(byName);
    }
  }, [employees, search, department, employeeType, onlyIncomplete, sort]);

  // Back to page 1 whenever the result set changes shape.
  useEffect(() => setPage(1), [search, department, employeeType, onlyIncomplete, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filtered.length);

  const activeFilters = [
    search.trim() && { key: 'search', label: `“${search.trim()}”`, clear: () => setSearch('') },
    department !== 'ALL' && { key: 'department', label: department, clear: () => setDepartment('ALL') },
    employeeType !== 'ALL' && { key: 'type', label: employeeType, clear: () => setEmployeeType('ALL') },
    onlyIncomplete && { key: 'incomplete', label: 'Incomplete profiles', clear: () => setOnlyIncomplete(false) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const clearAll = () => {
    setSearch('');
    setDepartment('ALL');
    setEmployeeType('ALL');
    setOnlyIncomplete(false);
  };

  const openOnKey = (event: React.KeyboardEvent, id: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenProfile(id);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Employees</h2>
          <p className="hidden sm:block text-sm text-slate-500 font-medium mt-0.5">Your company directory — search, filter and open any profile.</p>
        </div>
        {actions && <div className="flex items-center gap-3 self-start md:self-auto">{actions}</div>}
      </div>

      {/* Stats (tablet/desktop; phones get the count line and an "incomplete" chip below) */}
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Users className="w-5 h-5" />} label="Total employees" value={stats.total} />
        <StatCard icon={<Building2 className="w-5 h-5" />} label="Departments" value={stats.departments} />
        <StatCard icon={<UserPlus2 className="w-5 h-5" />} label="Joined (30 days)" value={stats.newJoiners} />
        {showAdminInsights ? (
          <StatCard
            icon={<AlertCircle className="w-5 h-5" />}
            label="Incomplete profiles"
            value={stats.incomplete}
            hint={onlyIncomplete ? 'Showing only these — click to clear' : 'Missing department, role or contact'}
            active={onlyIncomplete}
            onClick={() => setOnlyIncomplete(value => !value)}
          />
        ) : (
          <StatCard icon={<Briefcase className="w-5 h-5" />} label="Employee types" value={employeeTypes.length} />
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row gap-3">
        <div className="flex gap-2 flex-1 min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            placeholder="Search name, email, phone, employee code, manager…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search employees"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(open => !open)}
          className={`sm:hidden flex items-center gap-1.5 px-3.5 rounded-2xl border text-xs font-bold transition-colors ${
            showFilters || department !== 'ALL' || employeeType !== 'ALL' ? 'bg-orange-50 border-orange-200 text-[#f46617]' : 'bg-white border-slate-200 text-slate-600'
          }`}
        >
          <Filter className="w-4 h-4" /> Filters
        </button>
        </div>
        <div className={`${showFilters ? 'flex' : 'hidden'} sm:flex flex-wrap sm:flex-nowrap gap-3`}>
          <DropdownSelect
            value={department}
            onChange={setDepartment}
            placeholder="All departments"
            variant="filter"
            leadingIcon={<Filter className="w-4 h-4" />}
            className="w-full sm:w-[190px]"
            options={[{ value: 'ALL', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]}
          />
          <DropdownSelect
            value={employeeType}
            onChange={setEmployeeType}
            placeholder="All types"
            variant="filter"
            leadingIcon={<Briefcase className="w-4 h-4" />}
            className="w-full sm:w-[160px]"
            options={[{ value: 'ALL', label: 'All types' }, ...employeeTypes.map(t => ({ value: t, label: t }))]}
          />
          <DropdownSelect
            value={sort}
            onChange={value => setSort(value as SortKey)}
            placeholder="Sort"
            variant="filter"
            leadingIcon={<ArrowUpDown className="w-4 h-4" />}
            className="w-full sm:w-[170px]"
            options={[
              { value: 'name-asc', label: 'Name (A–Z)' },
              { value: 'name-desc', label: 'Name (Z–A)' },
              { value: 'joined-desc', label: 'Recently joined' },
              { value: 'department', label: 'Department' },
            ]}
          />
          <div className="hidden md:flex bg-slate-100 p-1 rounded-2xl flex-shrink-0" role="group" aria-label="View">
            {([['table', List, 'Table view'], ['grid', LayoutGrid, 'Card view']] as const).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => changeView(mode)}
                aria-pressed={view === mode}
                title={label}
                className={`px-3 rounded-xl transition-all ${
                  view === mode ? 'bg-white text-[#f46617] shadow-sm' : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result summary + active filters */}
      <div className="flex flex-wrap items-center gap-2 min-h-[28px]">
        <p className="text-xs font-bold text-slate-500 mr-1">
          {filtered.length === employees.length
            ? `${employees.length} ${employees.length === 1 ? 'employee' : 'employees'}`
            : `${filtered.length} of ${employees.length} employees`}
        </p>
        {showAdminInsights && stats.incomplete > 0 && !onlyIncomplete && (
          <button
            type="button"
            onClick={() => setOnlyIncomplete(true)}
            className="sm:hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-[11px] font-bold ring-1 ring-inset ring-amber-200/70"
          >
            <AlertCircle className="w-3 h-3" /> {stats.incomplete} incomplete
          </button>
        )}
        {activeFilters.map(filter => (
          <button
            key={filter.key}
            type="button"
            onClick={filter.clear}
            className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg bg-orange-50 text-[#c2410c] text-[11px] font-bold ring-1 ring-inset ring-orange-200/70 hover:bg-orange-100 transition-colors"
          >
            {filter.label}
            <X className="w-3 h-3" />
          </button>
        ))}
        {activeFilters.length > 1 && (
          <button type="button" onClick={clearAll} className="text-[11px] font-bold text-slate-400 hover:text-slate-700 px-1">
            Clear all
          </button>
        )}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-slate-200">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
            <Users className="w-7 h-7 text-slate-300" />
          </div>
          <p className="font-black text-slate-700">No employees match your filters</p>
          <p className="text-sm text-slate-400 font-medium mt-1">Try a different search or clear the filters.</p>
          {activeFilters.length > 0 && (
            <button type="button" onClick={clearAll} className="btn-orange mt-5 px-4 py-2 text-xs font-bold rounded-xl mx-auto">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Table (md+, when selected) */}
          {view === 'table' && (
            <div className="hidden md:block bg-white rounded-3xl border border-slate-200/70 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200/70 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th scope="col" className="px-5 py-3">Employee</th>
                      <th scope="col" className="px-4 py-3">Department</th>
                      <th scope="col" className="px-4 py-3 hidden lg:table-cell">Designation</th>
                      <th scope="col" className="px-4 py-3 hidden xl:table-cell">Type</th>
                      <th scope="col" className="px-4 py-3 hidden lg:table-cell">Reports to</th>
                      <th scope="col" className="px-4 py-3 hidden xl:table-cell">Joined</th>
                      <th scope="col" className="px-4 py-3 w-10"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pageItems.map(e => (
                      <tr
                        key={e.id}
                        tabIndex={0}
                        onClick={() => onOpenProfile(e.id)}
                        onKeyDown={event => openOnKey(event, e.id)}
                        className="group cursor-pointer hover:bg-orange-50/40 focus:bg-orange-50/60 focus:outline-none transition-colors"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <EmployeeAvatar name={e.name} avatar={e.avatar} gender={e.gender} size="w-10 h-10" shape="rounded" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate group-hover:text-[#f46617] transition-colors">{e.name}</p>
                                <RolePill employee={e} />
                              </div>
                              <p className="text-xs text-slate-400 font-medium truncate">
                                {e.email || e.phone || (e.employeeNumber ? `Emp. code ${e.employeeNumber}` : 'No contact details')}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><DepartmentChip department={e.department} /></td>
                        <td className="px-4 py-3 hidden lg:table-cell text-sm text-slate-600 font-medium max-w-[200px] truncate">
                          {e.position || <Empty />}
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell text-sm text-slate-600 font-medium whitespace-nowrap">
                          {e.employeeType || <Empty />}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-sm text-slate-600 font-medium max-w-[180px] truncate">
                          {e.manager?.name || <Empty />}
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell text-sm text-slate-500 font-medium whitespace-nowrap tabular-nums">
                          {formatDate(e.joinDate) || <Empty />}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#f46617] group-hover:translate-x-0.5 transition-all inline-block" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cards (always on mobile; md+ when card view selected) */}
          <div className={`grid gap-2 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3 ${view === 'table' ? 'md:hidden' : ''}`}>
            {pageItems.map(e => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenProfile(e.id)}
                onKeyDown={event => openOnKey(event, e.id)}
                className="group bg-white rounded-2xl sm:rounded-3xl border border-slate-200/70 p-3 sm:p-5 hover:border-orange-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#f46617]/25 transition-all cursor-pointer flex flex-col"
              >
                <div className="flex items-center sm:items-start gap-3">
                  <EmployeeAvatar name={e.name} avatar={e.avatar} gender={e.gender} size="w-11 h-11 sm:w-12 sm:h-12" shape="rounded" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-black text-slate-800 truncate group-hover:text-[#f46617] transition-colors">{e.name}</p>
                      <RolePill employee={e} />
                    </div>
                    <p className="text-xs text-slate-500 font-medium truncate mt-0.5">{e.position || 'No designation set'}</p>
                    <div className="mt-1.5 sm:mt-2"><DepartmentChip department={e.department} /></div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#f46617] transition-colors flex-shrink-0 mt-1" />
                </div>
                {/* Contact details: on the profile for phones */}
                <div className="hidden sm:block mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-xs font-medium text-slate-500">
                  <p className="flex items-center gap-2 truncate"><Mail className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />{e.email || <Empty />}</p>
                  <p className="flex items-center gap-2 truncate"><Phone className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />{e.phone || <Empty />}</p>
                  {e.manager?.name && (
                    <p className="flex items-center gap-2 truncate"><Users className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />Reports to {e.manager.name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs font-bold text-slate-500 tabular-nums">
                Showing {rangeStart}–{rangeEnd} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-slate-600 px-2 tabular-nums">
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  disabled={currentPage === pageCount}
                  className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
