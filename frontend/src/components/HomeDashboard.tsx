import React, { useEffect, useState } from 'react';
import {
  Users, Calendar, CalendarCheck, CalendarClock, Clock, GraduationCap, UserPlus, Megaphone,
  Upload, FileText, ChevronRight, AlertTriangle, CheckCircle2, Building2, Wallet, Palmtree,
  TrendingUp, ClipboardCheck, Loader2, LogIn, LogOut as LogOutIcon,
} from 'lucide-react';
import { dashboardApi, type DashboardSummary, type AttendanceSnapshot, type UserRole } from '../services/api';
import { EmployeeAvatar } from './EmployeeAvatar';
import { formatLeaveDuration } from '../utils/leaveRules';

type NavTab = 'employees' | 'leaves' | 'attendance' | 'salary' | 'learning' | 'announcements' | 'documents' | 'my-profile' | 'holidays';

// ─── Formatting helpers ───────────────────────────────────────

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(iso).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });

const fmtRange = (start: string, end: string) =>
  start.slice(0, 10) === end.slice(0, 10) ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;

const fmtMonth = (yyyyMm: string) =>
  new Date(`${yyyyMm}-01T00:00:00.000Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function daysUntil(iso: string, today: string): number {
  return Math.round((new Date(iso.slice(0, 10)).getTime() - new Date(today).getTime()) / 86_400_000);
}

const relativeDay = (iso: string, today: string) => {
  const d = daysUntil(iso, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 0) return `${-d} days ago`;
  return `In ${d} days`;
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', HALF_DAY: 'Half day', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday',
  WFH: 'Work from home', ON_DUTY: 'On duty', CLIENT_VISIT: 'Client visit', BUSINESS_TRAVEL: 'Business travel',
};

// ─── Building blocks ──────────────────────────────────────────

const Card: React.FC<{
  title: string;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, action, subtitle, className = '', children }) => (
  <section className={`bg-white rounded-[24px] border border-orange-100/50 shadow-card p-4 sm:p-6 min-w-0 ${className}`}>
    <div className="flex items-start justify-between gap-3 mb-3 sm:mb-5">
      <div className="min-w-0">
        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
          {icon && <span className="text-[#f46617]">{icon}</span>}
          {title}
        </h3>
        {subtitle && <p className="text-xs text-slate-400 font-semibold mt-0.5">{subtitle}</p>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="text-xs font-bold text-[#f46617] hover:text-[#d85512] flex items-center gap-0.5 flex-shrink-0"
        >
          {action.label} <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
    {children}
  </section>
);

const Kpi: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ElementType;
  tone: string;
  onClick?: () => void;
}> = ({ label, value, hint, icon: Icon, tone, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className="text-left bg-white rounded-[24px] p-4 sm:p-5 border border-orange-100/50 min-w-0 shadow-card hover:shadow-card-hover enabled:hover:-translate-y-0.5 transition-all duration-300 group disabled:cursor-default"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] sm:text-[11px] text-slate-500 font-bold uppercase tracking-wider leading-tight">{label}</p>
        <p className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight mt-1.5 tabular-nums leading-none truncate">{value}</p>
      </div>
      <div className={`hidden sm:flex w-11 h-11 rounded-2xl bg-gradient-to-br ${tone} items-center justify-center shadow-lg shadow-orange-500/5 group-hover:scale-110 transition-transform duration-300 flex-shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
    </div>
    {hint && <p className="text-[11px] sm:text-xs text-slate-500 font-semibold mt-2 sm:mt-3 truncate">{hint}</p>}
  </button>
);

const EmptyNote: React.FC<{ icon?: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex flex-col items-center justify-center text-center py-6 text-slate-400">
    {icon ?? <CheckCircle2 className="w-8 h-8 mb-2 text-emerald-400" />}
    <p className="text-sm font-semibold">{text}</p>
  </div>
);

const AttendanceBreakdown: React.FC<{ snapshot: AttendanceSnapshot; today: string }> = ({ snapshot, today }) => {
  const total = Math.max(snapshot.headcount, 1);
  const onTime = Math.max(0, snapshot.present - snapshot.late);
  const segments = [
    { label: 'On time', value: onTime, color: 'bg-emerald-500', dot: 'bg-emerald-500' },
    { label: 'Late', value: snapshot.late, color: 'bg-amber-400', dot: 'bg-amber-400' },
    { label: 'On leave', value: snapshot.onLeave, color: 'bg-sky-400', dot: 'bg-sky-400' },
    { label: 'Not marked', value: snapshot.notMarked, color: 'bg-slate-200', dot: 'bg-slate-300' },
  ];
  const rate = Math.round((snapshot.present / total) * 100);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <p className="text-4xl font-black text-slate-800 tabular-nums leading-none">
            {snapshot.present}<span className="text-lg text-slate-400 font-bold"> / {snapshot.headcount}</span>
          </p>
          <p className="text-xs font-semibold text-slate-500 mt-1.5">present · {rate}% attendance</p>
        </div>
        {!snapshot.isToday && (
          <span className="text-[11px] font-bold text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200/70 px-2.5 py-1 rounded-lg">
            Latest data: {fmtDay(snapshot.date, { weekday: 'short', day: 'numeric', month: 'short' })}
            {daysUntil(snapshot.date, today) < -1 ? ` (${-daysUntil(snapshot.date, today)} days ago)` : ''}
          </span>
        )}
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${snapshot.present} of ${snapshot.headcount} present`}>
        {segments.map(s => s.value > 0 && (
          <div key={s.label} className={`${s.color} h-full`} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {segments.map(s => (
          <div key={s.label} className="rounded-xl bg-slate-50/80 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} /> {s.label}
            </p>
            <p className="text-lg font-black text-slate-800 tabular-nums mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const PersonRow: React.FC<{
  person: { name: string; department: string | null; avatar: string | null; gender: string | null };
  meta: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
}> = ({ person, meta, right, onClick }) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-3 rounded-2xl px-2 py-2 -mx-2 text-left enabled:hover:bg-orange-50/50 transition-colors disabled:cursor-default"
    >
      <EmployeeAvatar name={person.name} avatar={person.avatar} gender={person.gender} size="w-10 h-10" shape="rounded" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800 truncate">{person.name}</p>
        <p className="text-xs text-slate-500 font-medium truncate">{meta}</p>
      </div>
      {right}
    </button>
  </li>
);

// ─── Sections ─────────────────────────────────────────────────

/** Phones skip cards that would only show an empty state or repeat a KPI tile. */
const PHONE_HIDDEN = 'hidden sm:block';

const ApprovalsCard: React.FC<{ data: DashboardSummary; go: (t: NavTab) => void }> = ({ data, go }) => (
  <Card
    className={data.approvals.items.length === 0 ? PHONE_HIDDEN : ''}
    title="Pending approvals"
    icon={<ClipboardCheck className="w-4 h-4" />}
    subtitle={data.approvals.count ? `${data.approvals.count} leave ${data.approvals.count === 1 ? 'request needs' : 'requests need'} your decision` : undefined}
    action={data.approvals.count ? { label: 'Review all', onClick: () => go('leaves') } : undefined}
  >
    {data.approvals.items.length === 0 ? (
      <EmptyNote text="You're all caught up — no requests waiting." />
    ) : (
      <ul className="space-y-1">
        {data.approvals.items.map(item => (
          <PersonRow
            key={item.id}
            person={item.employee}
            meta={`${item.type} · ${fmtRange(item.startDate, item.endDate)} · ${formatLeaveDuration(item)}`}
            onClick={() => go('leaves')}
            right={
              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-lg flex-shrink-0">
                {relativeDay(item.startDate, data.today)}
              </span>
            }
          />
        ))}
      </ul>
    )}
  </Card>
);

const HolidaysCard: React.FC<{ data: DashboardSummary; go: (t: NavTab) => void }> = ({ data, go }) => (
  <Card title="Upcoming holidays" icon={<Palmtree className="w-4 h-4" />} action={{ label: 'View all', onClick: () => go('holidays') }}>
    {data.holidays.length === 0 ? (
      <EmptyNote icon={<Palmtree className="w-8 h-8 mb-2 text-slate-300" />} text="No upcoming holidays added yet." />
    ) : (
      <ul className="space-y-3">
        {data.holidays.map((h, i) => (
          <li key={h.id} className={`${i >= 3 ? 'hidden sm:flex' : 'flex'} items-center gap-3`}>
            <div className="w-12 h-12 rounded-2xl bg-orange-50 text-[#f46617] flex flex-col items-center justify-center flex-shrink-0 leading-none">
              <span className="text-[10px] font-bold uppercase">{fmtDay(h.date, { month: 'short' })}</span>
              <span className="text-lg font-black">{fmtDay(h.date, { day: 'numeric' })}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{h.name}</p>
              <p className="text-xs text-slate-500 font-medium">
                {fmtDay(h.date, { weekday: 'long' })} · {relativeDay(h.date, data.today)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

const OnLeaveCard: React.FC<{ data: DashboardSummary; title: string }> = ({ data, title }) => (
  <Card title={title} icon={<Calendar className="w-4 h-4" />} className={data.onLeaveToday.length === 0 ? PHONE_HIDDEN : ''}>
    {data.onLeaveToday.length === 0 ? (
      <EmptyNote text="Everyone's in today." />
    ) : (
      <ul className="space-y-1">
        {data.onLeaveToday.map(l => (
          <PersonRow
            key={l.id}
            person={l.employee}
            meta={`${l.type} · back after ${fmtDay(l.endDate)}`}
          />
        ))}
      </ul>
    )}
  </Card>
);

// ─── Role layouts ─────────────────────────────────────────────

const EmployeeHome: React.FC<{ data: DashboardSummary; go: (t: NavTab) => void }> = ({ data, go }) => {
  const me = data.me;
  if (!me) return null;
  const today = me.attendanceToday;

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi
          label="Today"
          value={today ? (STATUS_LABELS[today.status] ?? today.status) : 'Not marked'}
          hint={today?.checkIn ? `In ${today.checkIn.slice(0, 5)}${today.checkOut ? ` · Out ${today.checkOut.slice(0, 5)}` : ''}${today.isLate ? ' · Late' : ''}` : 'Attendance syncs from the biometric device'}
          icon={Clock}
          tone="from-emerald-400 to-teal-500"
          onClick={() => go('attendance')}
        />
        <Kpi
          label="Present this month"
          value={me.month.present}
          hint={me.month.late ? `${me.month.late} late ${me.month.late === 1 ? 'arrival' : 'arrivals'}` : 'No late arrivals 👏'}
          icon={CalendarCheck}
          tone="from-blue-400 to-indigo-500"
          onClick={() => go('attendance')}
        />
        <Kpi
          label="Leave taken this year"
          value={me.leaves.takenThisYear}
          hint={me.leaves.pending ? `${me.leaves.pending} request${me.leaves.pending === 1 ? '' : 's'} awaiting approval` : 'days approved'}
          icon={Calendar}
          tone="from-orange-400 to-[#f46617]"
          onClick={() => go('leaves')}
        />
        <Kpi
          label="Active courses"
          value={me.learning.active}
          hint={me.learning.overdue ? `${me.learning.overdue} overdue` : `${me.learning.completed} completed`}
          icon={GraduationCap}
          tone="from-violet-400 to-purple-500"
          onClick={() => go('learning')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Card title="My learning" icon={<GraduationCap className="w-4 h-4" />} action={{ label: 'Open learning', onClick: () => go('learning') }}>
            {me.learning.nextDue ? (
              <div className={`rounded-2xl p-4 ${daysUntil(me.learning.nextDue.dueDate, data.today) < 0 ? 'bg-red-50/70' : 'bg-orange-50/50'}`}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Next due</p>
                <p className="text-base font-black text-slate-800 mt-1">{me.learning.nextDue.title}</p>
                <p className={`text-xs font-bold mt-1 ${daysUntil(me.learning.nextDue.dueDate, data.today) < 0 ? 'text-red-600' : 'text-[#c2410c]'}`}>
                  Due {fmtDay(me.learning.nextDue.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })} · {relativeDay(me.learning.nextDue.dueDate, data.today)}
                </p>
              </div>
            ) : me.learning.active ? (
              <p className="text-sm text-slate-600 font-semibold">You have {me.learning.active} course{me.learning.active === 1 ? '' : 's'} in progress with no due date.</p>
            ) : (
              <EmptyNote icon={<GraduationCap className="w-8 h-8 mb-2 text-slate-300" />} text="No courses assigned right now — browse the catalog." />
            )}
            <div className="hidden sm:grid grid-cols-3 gap-3 mt-4">
              {[
                ['In progress', me.learning.active],
                ['Overdue', me.learning.overdue],
                ['Completed', me.learning.completed],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50/80 px-3 py-2.5 text-center">
                  <p className="text-lg font-black text-slate-800 tabular-nums">{value}</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Leave & payslips" icon={<Wallet className="w-4 h-4" />}>
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={() => go('leaves')} className="text-left rounded-2xl border border-slate-100 p-4 hover:border-orange-200 hover:bg-orange-50/30 transition-colors">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Upcoming leave</p>
                {me.leaves.upcoming ? (
                  <>
                    <p className="text-sm font-black text-slate-800 mt-1">{me.leaves.upcoming.type}</p>
                    <p className="text-xs font-semibold text-slate-500 mt-0.5">
                      {fmtRange(me.leaves.upcoming.startDate, me.leaves.upcoming.endDate)} · {formatLeaveDuration(me.leaves.upcoming)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-500 mt-1">None planned — apply when you need a break.</p>
                )}
              </button>
              <button onClick={() => go('salary')} className="text-left rounded-2xl border border-slate-100 p-4 hover:border-orange-200 hover:bg-orange-50/30 transition-colors">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Latest payslip</p>
                {me.latestSlipMonth ? (
                  <>
                    <p className="text-sm font-black text-slate-800 mt-1">{fmtMonth(me.latestSlipMonth)}</p>
                    <p className="text-xs font-semibold text-[#c2410c] mt-0.5">View & download →</p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-500 mt-1">No payslips published yet.</p>
                )}
              </button>
            </div>
          </Card>
        </div>
        <div className="space-y-4 sm:space-y-6">
          {data.approvals.count > 0 && <ApprovalsCard data={data} go={go} />}
          <HolidaysCard data={data} go={go} />
        </div>
      </div>
    </>
  );
};

const ManagerHome: React.FC<{ data: DashboardSummary; go: (t: NavTab) => void }> = ({ data, go }) => {
  const team = data.team;
  const att = team?.attendance;
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="My team" value={team?.size ?? 0} hint="people in your reporting line" icon={Users} tone="from-blue-400 to-indigo-500" onClick={() => go('employees')} />
        <Kpi
          label="Team present"
          value={att ? `${att.present}/${att.headcount}` : '—'}
          hint={att ? `${att.late} late · ${att.onLeave} on leave${att.isToday ? '' : ` · ${fmtDay(att.date)}`}` : 'No attendance data yet'}
          icon={CalendarCheck}
          tone="from-emerald-400 to-teal-500"
          onClick={() => go('attendance')}
        />
        <Kpi
          label="Pending approvals"
          value={data.approvals.count}
          hint={data.approvals.count ? 'leave requests waiting on you' : 'All caught up'}
          icon={ClipboardCheck}
          tone="from-orange-400 to-[#f46617]"
          onClick={() => go('leaves')}
        />
        <Kpi
          label="Team learning overdue"
          value={team?.learningOverdue ?? 0}
          hint={team?.learningOverdue ? 'courses past their due date' : 'Everyone on track'}
          icon={GraduationCap}
          tone="from-violet-400 to-purple-500"
          onClick={() => go('learning')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* On phones this column holds only the approvals card (the rest is hidden there) */}
        <div className={`lg:col-span-2 space-y-4 sm:space-y-6 ${data.approvals.items.length === 0 ? 'hidden sm:block' : ''}`}>
          <Card className={PHONE_HIDDEN} title="Team attendance" icon={<Clock className="w-4 h-4" />} action={{ label: 'Open attendance', onClick: () => go('attendance') }}>
            {att ? <AttendanceBreakdown snapshot={att} today={data.today} /> : (
              <EmptyNote icon={<Clock className="w-8 h-8 mb-2 text-slate-300" />} text={team?.size ? 'No attendance uploaded for your team yet.' : 'No one reports to you yet.'} />
            )}
          </Card>
          <ApprovalsCard data={data} go={go} />
        </div>
        <div className="space-y-4 sm:space-y-6">
          <OnLeaveCard data={data} title="Team on leave today" />
          <HolidaysCard data={data} go={go} />
        </div>
      </div>
    </>
  );
};

const OrgHome: React.FC<{ data: DashboardSummary; role: UserRole; go: (t: NavTab) => void }> = ({ data, role, go }) => {
  const org = data.org!;
  const att = org.attendance;
  const maxDept = Math.max(...org.departments.map(d => d.count), 1);
  const isHR = role === 'HR';

  const attention = [
    isHR && org.incompleteProfiles > 0 && {
      key: 'profiles', icon: Users, tone: 'text-amber-600 bg-amber-50',
      text: `${org.incompleteProfiles} employee profile${org.incompleteProfiles === 1 ? ' is' : 's are'} incomplete`,
      sub: 'Missing department, designation or contact', tab: 'employees' as NavTab,
    },
    org.learning.overdue > 0 && {
      key: 'learning', icon: GraduationCap, tone: 'text-red-600 bg-red-50',
      text: `${org.learning.overdue} course enrolment${org.learning.overdue === 1 ? ' is' : 's are'} overdue`,
      sub: 'Learners past their due date', tab: 'learning' as NavTab,
    },
    att && !att.isToday && daysUntil(att.date, data.today) < -1 && {
      key: 'attendance', icon: Clock, tone: 'text-sky-600 bg-sky-50',
      text: `Attendance last uploaded for ${fmtDay(att.date)}`,
      sub: 'Upload the latest biometric data', tab: 'attendance' as NavTab,
    },
  ].filter(Boolean) as { key: string; icon: React.ElementType; tone: string; text: string; sub: string; tab: NavTab }[];

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi
          label="Headcount"
          value={org.headcount}
          hint={org.newJoinersThisMonth ? `+${org.newJoinersThisMonth} joined this month` : `${org.departments.length} departments`}
          icon={Users}
          tone="from-blue-400 to-indigo-500"
          onClick={() => go('employees')}
        />
        <Kpi
          label={att?.isToday ? 'Present today' : 'Present (latest)'}
          value={att ? `${att.present}/${att.headcount}` : '—'}
          hint={att ? `${att.late} late · ${att.onLeave} on leave${att.isToday ? '' : ` · ${fmtDay(att.date)}`}` : 'No attendance uploaded yet'}
          icon={CalendarCheck}
          tone="from-emerald-400 to-teal-500"
          onClick={() => go('attendance')}
        />
        <Kpi
          label="Pending approvals"
          value={data.approvals.count}
          hint={data.approvals.count ? 'leave requests to review' : 'All caught up'}
          icon={ClipboardCheck}
          tone="from-orange-400 to-[#f46617]"
          onClick={() => go('leaves')}
        />
        <Kpi
          label="Learning completion"
          value={org.learning.completionRate === null ? '—' : `${org.learning.completionRate}%`}
          hint={`${org.learning.active} active · ${org.learning.overdue} overdue`}
          icon={TrendingUp}
          tone="from-violet-400 to-purple-500"
          onClick={() => go('learning')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* On phones this column holds only the approvals card (the rest is hidden there) */}
        <div className={`lg:col-span-2 space-y-4 sm:space-y-6 ${data.approvals.items.length === 0 ? 'hidden sm:block' : ''}`}>
          <Card className={PHONE_HIDDEN} title="Attendance" icon={<Clock className="w-4 h-4" />} subtitle="Company-wide" action={{ label: 'Open attendance', onClick: () => go('attendance') }}>
            {att ? <AttendanceBreakdown snapshot={att} today={data.today} /> : (
              <EmptyNote icon={<Clock className="w-8 h-8 mb-2 text-slate-300" />} text="No attendance has been uploaded yet." />
            )}
          </Card>

          <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
            <Card className={PHONE_HIDDEN} title="People by department" icon={<Building2 className="w-4 h-4" />} action={{ label: 'Directory', onClick: () => go('employees') }}>
              <ul className="space-y-3">
                {org.departments.slice(0, 7).map(d => (
                  <li key={d.name}>
                    <div className="flex items-center justify-between text-xs font-bold mb-1">
                      <span className={`truncate ${d.name === 'Unassigned' ? 'text-slate-400' : 'text-slate-700'}`}>{d.name}</span>
                      <span className="text-slate-500 tabular-nums ml-2">{d.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${d.name === 'Unassigned' ? 'bg-slate-300' : 'bg-gradient-to-r from-orange-400 to-[#f46617]'}`}
                        style={{ width: `${(d.count / maxDept) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <ApprovalsCard data={data} go={go} />
          </div>
        </div>

        <div className="space-y-4 sm:space-y-6">
          {attention.length > 0 && (
            <Card title="Needs attention" icon={<AlertTriangle className="w-4 h-4" />}>
              <ul className="space-y-2">
                {attention.map(a => (
                  <li key={a.key}>
                    <button onClick={() => go(a.tab)} className="w-full flex items-start gap-3 rounded-2xl p-2.5 -mx-1 text-left hover:bg-orange-50/50 transition-colors">
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${a.tone}`}><a.icon className="w-4 h-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-800">{a.text}</span>
                        <span className="block text-xs text-slate-500 font-medium">{a.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <OnLeaveCard data={data} title="On leave today" />
          {isHR && (
            <Card title="Payroll" icon={<Wallet className="w-4 h-4" />} action={{ label: 'Salary', onClick: () => go('salary') }}>
              {org.payroll ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Last import</p>
                  <p className="text-lg font-black text-slate-800 mt-0.5">{fmtMonth(org.payroll.month)}</p>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5">
                    {org.payroll.importedCount} payslip{org.payroll.importedCount === 1 ? '' : 's'} · uploaded {fmtDay(org.payroll.createdAt)}
                  </p>
                </div>
              ) : (
                <EmptyNote icon={<Wallet className="w-8 h-8 mb-2 text-slate-300" />} text="No payroll imported yet." />
              )}
            </Card>
          )}
          <HolidaysCard data={data} go={go} />
        </div>
      </div>
    </>
  );
};

// ─── Quick actions ────────────────────────────────────────────

const QUICK_ACTIONS: Record<UserRole, { label: string; icon: React.ElementType; tab: NavTab; primary?: boolean }[]> = {
  EMPLOYEE: [
    { label: 'Apply leave', icon: Calendar, tab: 'leaves', primary: true },
    { label: 'My payslips', icon: FileText, tab: 'salary' },
    { label: 'My learning', icon: GraduationCap, tab: 'learning' },
  ],
  MANAGER: [
    { label: 'Review approvals', icon: ClipboardCheck, tab: 'leaves', primary: true },
    { label: 'Team attendance', icon: Clock, tab: 'attendance' },
    { label: 'Apply leave', icon: CalendarClock, tab: 'leaves' },
  ],
  HR: [
    { label: 'Add employee', icon: UserPlus, tab: 'employees', primary: true },
    { label: 'Post announcement', icon: Megaphone, tab: 'announcements' },
    { label: 'Upload payroll', icon: Upload, tab: 'salary' },
  ],
  LEADERSHIP: [
    { label: 'Review approvals', icon: ClipboardCheck, tab: 'leaves', primary: true },
    { label: 'Employees', icon: Users, tab: 'employees' },
    { label: 'Attendance', icon: Clock, tab: 'attendance' },
  ],
};

// ─── Main ─────────────────────────────────────────────────────

export const HomeDashboard: React.FC<{
  role: UserRole;
  name: string;
  onNavigate: (tab: NavTab) => void;
}> = ({ role, name, onNavigate }) => {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .summary()
      .then(res => { if (!cancelled && res.data) setData(res.data); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your dashboard'); });
    return () => { cancelled = true; };
  }, []);

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const firstName = name.split(' ')[0];
  const attendanceToday = data?.me?.attendanceToday;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Greeting + quick actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{todayLabel}</p>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight leading-tight mt-1">
            {greeting()}, {firstName} 👋
          </h2>
          {attendanceToday?.checkIn && (
            <p className="hidden sm:flex text-sm text-slate-500 font-semibold mt-1 items-center gap-3">
              <span className="inline-flex items-center gap-1"><LogIn className="w-3.5 h-3.5 text-emerald-500" /> Checked in {attendanceToday.checkIn.slice(0, 5)}</span>
              {attendanceToday.checkOut && (
                <span className="inline-flex items-center gap-1"><LogOutIcon className="w-3.5 h-3.5 text-slate-400" /> Out {attendanceToday.checkOut.slice(0, 5)}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS[role].map(a => (
            <button
              key={a.label}
              onClick={() => onNavigate(a.tab)}
              className={a.primary
                ? 'btn-orange px-4 py-2.5 text-xs font-bold rounded-2xl'
                : 'hidden sm:flex items-center gap-2 px-4 py-2.5 bg-white border border-orange-100 hover:border-orange-200 hover:bg-orange-50/50 text-slate-700 text-xs font-bold rounded-2xl transition-all'}
            >
              <a.icon className="w-4 h-4" /> {a.label}
              {a.tab === 'leaves' && a.primary && data && data.approvals.count > 0 && (
                <span className="ml-0.5 bg-white/25 px-1.5 rounded-md">{data.approvals.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="bg-white rounded-[24px] border border-red-100 p-6 text-sm font-semibold text-red-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      ) : !data ? (
        <div className="space-y-4 sm:space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-[120px] rounded-[24px] bg-white border border-orange-100/50 animate-pulse" />)}
          </div>
          <div className="h-64 rounded-[24px] bg-white border border-orange-100/50 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-[#f46617] animate-spin" />
          </div>
        </div>
      ) : role === 'HR' || role === 'LEADERSHIP' ? (
        data.org && <OrgHome data={data} role={role} go={onNavigate} />
      ) : role === 'MANAGER' ? (
        <ManagerHome data={data} go={onNavigate} />
      ) : (
        <EmployeeHome data={data} go={onNavigate} />
      )}
    </div>
  );
};
