import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import LoginForm from '../components/LoginForm';
import {
  Users, Calendar, Clock, DollarSign, Megaphone,
  LogOut,
  Home, FileText, Loader2,
  CheckCircle, XCircle, MessageSquare, X, Send, AlertTriangle,
  UserPlus, Search, Filter, RefreshCw, RotateCcw, GraduationCap, Bell, Palmtree
} from 'lucide-react';
import { LEAVES_ENABLED, LEAVES_LAUNCH_LABEL } from '../utils/features';
import {
  employeeApi,
  leaveApi,
  announcementApi,
  heroBannerApi,
  notificationApi,
  type Employee,
  type Leave,
  type Announcement,
  type HeroBanner,
  type AuthUser,
  type UserRole,
  type AppNotification,
} from '../services/api';
import { AttendancePanel } from '../components/AttendancePanel';
import { ProfileDrawer } from '../components/ProfileDrawer';
import { ProfileView } from './Profile';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { DropdownSelect } from '../components/DropdownSelect';
import { DEPARTMENTS, EMPLOYEE_TYPES, optionsWithCurrent } from '../utils/employeeOptions';
import { AnnouncementSpotlight } from '../components/AnnouncementSpotlight';
import { AnnouncementComposer } from '../components/AnnouncementComposer';
import { AnnouncementDetailDialog } from '../components/AnnouncementDetailDialog';
import { HeroBannerCarousel } from '../components/HeroBannerCarousel';
import { HeroBannerComposer } from '../components/HeroBannerComposer';
import { NotificationBell } from '../components/NotificationBell';
import { MobileTabBar } from '../components/MobileTabBar';
import { BirthdayCelebration } from '../components/BirthdayCelebration';
import { EmployeeDirectory } from '../components/EmployeeDirectory';
import { formatLeaveDuration } from '../utils/leaveRules';
import { HomeDashboard } from '../components/HomeDashboard';
import logoImg from '../images/autoform-logo.png';
import {
  EMPTY_PAGE_FILTERS,
  matchesDateFilter,
  matchesSearch,
  type DateFilterMode,
  type PageFilterState,
} from '../utils/pageFilters';

// Tab-specific panels are split into their own chunks and loaded when first opened.
const SalaryTab = lazy(() => import('../components/tabs/SalaryTab'));
const PayrollImportPanel = lazy(() => import('../components/PayrollImportPanel').then((m) => ({ default: m.PayrollImportPanel })));
const PayrollImportHistory = lazy(() => import('../components/PayrollImportHistory').then((m) => ({ default: m.PayrollImportHistory })));
const LearningCatalogPanel = lazy(() => import('../components/LearningCatalogPanel').then((m) => ({ default: m.LearningCatalogPanel })));
const MyLearningPanel = lazy(() => import('../components/MyLearningPanel').then((m) => ({ default: m.MyLearningPanel })));
const TeamLearningPanel = lazy(() => import('../components/TeamLearningPanel').then((m) => ({ default: m.TeamLearningPanel })));
const LearningPathsPanel = lazy(() => import('../components/LearningPathsPanel').then((m) => ({ default: m.LearningPathsPanel })));
const ILTSessionsPanel = lazy(() => import('../components/ILTSessionsPanel').then((m) => ({ default: m.ILTSessionsPanel })));
const BadgeCatalogPanel = lazy(() => import('../components/BadgeCatalogPanel').then((m) => ({ default: m.BadgeCatalogPanel })));
const AdminLearningDashboard = lazy(() => import('../components/AdminLearningDashboard').then((m) => ({ default: m.AdminLearningDashboard })));
const DocumentManagerPanel = lazy(() => import('../components/DocumentManagerPanel').then((m) => ({ default: m.DocumentManagerPanel })));
const ELibraryTab = lazy(() => import('../components/tabs/ELibraryTab').then((m) => ({ default: m.ELibraryTab })));
const HolidaysPanel = lazy(() => import('../components/HolidaysPanel').then((m) => ({ default: m.HolidaysPanel })));

// Each page's address. Pages are switched by URL, so the browser's Back button moves between pages
// instead of leaving the site, and a refresh stays on the same page.
const TAB_PATHS: Record<string, string> = {
  overview: '/',
  announcements: '/announcements',
  attendance: '/attendance',
  leaves: LEAVES_ENABLED ? '/leaves' : '/holidays',
  salary: '/salary',
  documents: '/documents',
  learning: '/learning',
  employees: '/employees',
  'my-profile': '/my-profile',
  notifications: '/notifications',
};

/** The page for an address; both /leaves and /holidays open the Leaves & Holidays page. Null if unknown. */
const tabFromPath = (pathname: string): string | null => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/leaves' || path === '/holidays') return 'leaves';
  return Object.keys(TAB_PATHS).find((tab) => TAB_PATHS[tab] === path) ?? null;
};

const ALL_ACCESS_ROLES: UserRole[] = ['HR', 'LEADERSHIP'];
const MANAGEMENT_ROLES: UserRole[] = ['HR', 'LEADERSHIP', 'MANAGER'];

const getRoleBadgeClasses = (role: UserRole) => (
  role === 'HR'
    ? 'bg-orange-500/15 text-orange-700 border border-orange-500/20'
    : role === 'LEADERSHIP'
      ? 'bg-amber-500/15 text-amber-850 border border-amber-500/20'
      : role === 'MANAGER'
        ? 'bg-teal-500/15 text-teal-800 border border-teal-500/20'
        : 'bg-slate-500/10 text-slate-700 border border-slate-500/15'
);

// ─── Dashboard Page ──────────────────────────────────────────

const Dashboard: React.FC = () => {
  const { user, isLoggedIn, isLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname) ?? 'overview';
  // Opening a page adds a history entry; re-opening the current page adds nothing.
  const setActiveTab = (tab: string) => {
    const path = TAB_PATHS[tab] ?? '/';
    if (path !== location.pathname) navigate(path);
  };
  const signOut = () => {
    logout();
    navigate('/', { replace: true });
  };

  // An address that isn't a page (old link, typo) goes Home without leaving a Back entry.
  useEffect(() => {
    if (tabFromPath(location.pathname) === null) navigate('/', { replace: true });
  }, [location.pathname, navigate]);
  // Holidays live inside Leaves, and E-Library inside Learning (one menu item each).
  const [leavesSubTab, setLeavesSubTab] = useState<LeavesSubTab>(LEAVES_ENABLED ? 'leaves' : 'holidays');
  const [learningStartTab, setLearningStartTab] = useState<LearningSubTab>('catalog');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [unreadAnnouncementCount, setUnreadAnnouncementCount] = useState(0);
  const [heroBanners, setHeroBanners] = useState<HeroBanner[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [focusAttendanceEmployeeId, setFocusAttendanceEmployeeId] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [profileDrawer, setProfileDrawer] = useState<{ open: boolean; employeeId: number | null; tab: 'about' | 'performance' | 'leaves' | 'attendance' }>({
    open: false,
    employeeId: null,
    tab: 'about',
  });

  useEffect(() => {
    if (isLoggedIn) {
      loadDashboardData(true);
    }
  }, [isLoggedIn]);

  const refreshNotifications = async () => {
    try {
      const response = await notificationApi.list();
      if (response.data) {
        setNotifications(response.data.notifications);
        setUnreadNotificationCount(response.data.unreadCount);
      }
    } catch {
      // Keep notification refresh non-blocking.
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = window.setInterval(refreshNotifications, 30_000);
    return () => window.clearInterval(interval);
  }, [isLoggedIn]);

  // Only the first load shows the spinner; refreshes after a save swap the data in place,
  // so the open panel keeps its filters and scroll position.
  const loadDashboardData = async (showSpinner = false) => {
    if (showSpinner) setDataLoading(true);
    try {
      const [empRes, leaveRes, annRes, heroRes, notificationRes] = await Promise.allSettled([
        // Whole directory in one call (the API defaults to 50 per page).
        employeeApi.list({ limit: '1000' }),
        leaveApi.list(),
        announcementApi.list(),
        heroBannerApi.list(),
        notificationApi.list(),
      ]);

      if (empRes.status === 'fulfilled' && empRes.value.data) {
        setEmployees(empRes.value.data.employees);
      }
      if (leaveRes.status === 'fulfilled' && leaveRes.value.data) {
        setLeaves(leaveRes.value.data.leaves);
      }
      if (annRes.status === 'fulfilled' && annRes.value.data) {
        setAnnouncements(annRes.value.data.announcements);
        setUnreadAnnouncementCount(annRes.value.data.unreadCount);
      }
      if (heroRes.status === 'fulfilled' && heroRes.value.data) {
        setHeroBanners(heroRes.value.data.banners);
      }
      if (notificationRes.status === 'fulfilled' && notificationRes.value.data) {
        setNotifications(notificationRes.value.data.notifications);
        setUnreadNotificationCount(notificationRes.value.data.unreadCount);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setDataLoading(false);
    }
  };

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center relative">
        <Loader2 className="w-10 h-10 text-[#f46617] animate-spin" />
      </div>
    );
  }

  // Show login if not authenticated
  if (!isLoggedIn) {
    return <LoginForm />;
  }

  const role: UserRole = user?.role || 'EMPLOYEE';
  const name = user?.employee?.name || user?.username || 'User';

  const handleOpenNotification = (notification: AppNotification) => {
    switch (notification.type) {
      case 'ATTENDANCE_CORRECTION':
      case 'ATTENDANCE_CORRECTION_REQUESTED':
      case 'ATTENDANCE_CORRECTION_APPROVED':
      case 'ATTENDANCE_CORRECTION_REJECTED':
        setFocusAttendanceEmployeeId(notification.employeeId);
        setActiveTab('attendance');
        break;
      case 'LEAVE_APPLIED':
      case 'LEAVE_APPROVED':
      case 'LEAVE_REJECTED':
        setActiveTab('leaves');
        break;
      case 'SALARY_SLIP_READY':
        setActiveTab('salary');
        break;
      case 'ANNOUNCEMENT_PUBLISHED':
        setActiveTab('announcements');
        break;
      case 'COURSE_ASSIGNED':
      case 'COURSE_DUE_REMINDER':
      case 'COURSE_OVERDUE':
      case 'COURSE_NUDGE':
      case 'COURSE_CERTIFICATE_EXPIRING':
      case 'PATH_ASSIGNED':
      case 'COURSE_NOMINATED':
      case 'COURSE_APPROVAL_REQUESTED':
      case 'COURSE_APPROVAL_DECIDED':
      case 'ILT_SESSION_CANCELLED':
      case 'ILT_WAITLIST_PROMOTED':
      case 'BADGE_EARNED':
      case 'COURSE_PUBLISHED':
      case 'COURSE_COMPLETED':
      case 'QUIZ_AUTO_SUBMITTED':
      case 'CERTIFICATE_ISSUED':
      case 'COURSE_CONTENT_UPDATED':
        setActiveTab('learning');
        break;
      case 'DOCUMENT_DOWNLOADED':
        setActiveTab('documents');
        break;
      case 'LIBRARY_DOCUMENT_ADDED':
        openTab('elibrary');
        break;
      case 'PAYROLL_DETAILS_CHANGED':
        if (notification.employeeId) {
          setProfileDrawer({ open: true, employeeId: notification.employeeId, tab: 'about' });
        } else {
          setActiveTab('notifications');
        }
        break;
      default:
        setActiveTab('notifications');
    }
  };

  // Sidebar navigation: one entry per page. My Profile is the user card above the menu.
  const navItems = [
    { id: 'overview', label: 'Home', icon: Home },
    { id: 'announcements', label: 'Announcements', icon: Megaphone },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'leaves', label: LEAVES_ENABLED ? 'Leaves & Holidays' : 'Holidays', icon: LEAVES_ENABLED ? Calendar : Palmtree },
    { id: 'salary', label: 'Salary', icon: DollarSign },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'learning', label: 'Learning', icon: GraduationCap },
    ...(role !== 'EMPLOYEE' ? [{ id: 'employees', label: 'Employees', icon: Users }] : []),
  ];

  /** Opens a page; also accepts the old standalone ids ('holidays', 'elibrary') still used by links. */
  const openTab = (tab: string) => {
    setFocusAttendanceEmployeeId(null);
    if (tab === 'holidays' || tab === 'leaves') {
      // While leave management is off, the page opens on Holidays.
      setLeavesSubTab(tab === 'holidays' || !LEAVES_ENABLED ? 'holidays' : 'leaves');
      setActiveTab('leaves');
    } else if (tab === 'elibrary' || tab === 'learning') {
      setLearningStartTab(tab === 'elibrary' ? 'elibrary' : 'catalog');
      setActiveTab('learning');
    } else if (tab === 'employees' && role === 'EMPLOYEE') {
      setActiveTab('my-profile');
    } else {
      setActiveTab(tab);
    }
  };

  const pendingLeaves = leaves.filter(l => l.status === 'PENDING').length;
  const allDepartments = Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[];

  return (
    <div data-app-shell className="bg-app-bg flex flex-col lg:flex-row lg:gap-4 lg:p-6 h-[100dvh] w-full overflow-hidden relative font-sans">
      {/* Background Glowing Blobs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-brand-orange/10 blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-400/5 blur-[120px] pointer-events-none animate-pulse-slow" />

      {/* Mobile top bar (below lg) — frosted, like the tab bar; navigation lives at the bottom */}
      <header className="mobile-glass lg:hidden relative z-20 grid grid-cols-[1fr_auto_1fr] items-center px-4 pt-[env(safe-area-inset-top)] min-h-[64px] border-b border-orange-100/60 flex-shrink-0">
        <div className="justify-self-start">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadNotificationCount}
            onRefresh={refreshNotifications}
            onViewAll={() => setActiveTab('notifications')}
            onOpenNotification={handleOpenNotification}
          />
        </div>
        <img src={logoImg} alt="Autoform" className="h-10 w-auto select-none" draggable={false} />
        <button
          type="button"
          onClick={() => user?.employeeId && openTab('my-profile')}
          disabled={!user?.employeeId}
          aria-label="My profile"
          className={`justify-self-end rounded-xl p-0.5 transition-all ${activeTab === 'my-profile' ? 'ring-2 ring-[#f46617]/70' : ''}`}
        >
          <EmployeeAvatar name={name} avatar={user?.employee?.avatar} gender={user?.employee?.gender} size="w-9 h-9" shape="rounded" />
        </button>
      </header>

      {/* Sidebar — desktop (lg+) only; phones use the bottom tab bar */}
      <aside className="hidden lg:flex lg:z-10 lg:w-72 lg:rounded-[40px] lg:animate-scale-in bg-white border border-orange-100/60 shadow-island flex-col h-full overflow-hidden flex-shrink-0">
        {/* Logo */}
        <div className="px-6 pt-5 pb-4 border-b border-orange-100/70 flex flex-col items-start lg:items-center">
          <img src={logoImg} alt="Autoform Logo" className="w-28 lg:w-36 h-auto mb-1 select-none" />
          <h1 className="text-lg lg:text-xl font-script text-slate-800 leading-none">Autoform Connect</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 py-3 lg:py-4 px-3 overflow-y-auto space-y-0.5 lg:space-y-1">
          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => openTab(item.id)}
                className={isActive ? 'nav-item-active' : 'nav-item'}
              >
                <div className={`p-1 rounded-lg transition-colors ${isActive ? 'text-[#f46617]' : 'text-slate-400'}`}>
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                </div>
                <span>{item.label}</span>
                {item.id === 'leaves' && LEAVES_ENABLED && pendingLeaves > 0 && (
                  <span className="ml-auto bg-[#f46617] text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {pendingLeaves}
                  </span>
                )}
                {item.id === 'announcements' && unreadAnnouncementCount > 0 && (
                  <span className="ml-auto bg-[#f46617] text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {unreadAnnouncementCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom: user card (opens My Profile) and a labelled Sign out button */}
        <div className="px-3 pt-3 pb-3 border-t border-orange-100/70 space-y-2">
          <button
            type="button"
            onClick={() => user?.employeeId && openTab('my-profile')}
            disabled={!user?.employeeId}
            title={user?.employeeId ? 'My profile' : undefined}
            className={`w-full min-w-0 flex items-center gap-3 p-2 rounded-2xl text-left border transition-all ${
              activeTab === 'my-profile' ? 'bg-orange-50 border-orange-100/60' : 'border-transparent hover:bg-orange-50/50'
            }`}
          >
            <EmployeeAvatar
              name={name}
              avatar={user?.employee?.avatar}
              gender={user?.employee?.gender}
              size="w-10 h-10"
              shape="rounded"
              className="shadow-md shadow-orange-200/60"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
              <span className={`inline-block text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full mt-0.5 ${getRoleBadgeClasses(role)}`}>
                {role}
              </span>
            </div>
          </button>
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-600 bg-white border border-orange-100 rounded-2xl hover:text-[#f46617] hover:border-[#f46617]/40 hover:bg-orange-50/50 transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-0 min-w-0 bg-white lg:rounded-[40px] lg:border border-orange-100/60 lg:shadow-island flex flex-col lg:h-full overflow-hidden relative z-10 lg:animate-scale-in">
        <div className="hidden lg:flex items-center justify-end px-8 pt-5 flex-shrink-0">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadNotificationCount}
            onRefresh={refreshNotifications}
            onViewAll={() => setActiveTab('notifications')}
            onOpenNotification={handleOpenNotification}
          />
        </div>
        {/* Bottom padding on phones keeps content clear of the tab bar (60px + home indicator). */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 lg:pt-2 pb-[calc(76px+env(safe-area-inset-bottom))] sm:pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-8">
          {dataLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 text-[#f46617] animate-spin" />
            </div>
          ) : (
            <Suspense
              fallback={(
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 text-[#f46617] animate-spin" />
                </div>
              )}
            >
              {activeTab === 'overview' && (
                <OverviewPanel
                  role={role}
                  name={name}
                  onNavigate={openTab}
                  employeeCount={employees.length}
                  pendingLeaves={pendingLeaves}
                  announcementCount={announcements.length}
                  announcements={announcements}
                  heroBanners={heroBanners}
                  onViewAllAnnouncements={() => setActiveTab('announcements')}
                  onRefreshAnnouncements={() => loadDashboardData()}
                />
              )}
              {activeTab === 'employees' && role !== 'EMPLOYEE' && (
                <EmployeesPage
                  employees={employees}
                  role={role}
                  currentEmployeeId={user?.employeeId ?? null}
                  onRefresh={() => loadDashboardData()}
                  onOpenProfile={(employeeId: number) => setProfileDrawer({ open: true, employeeId, tab: 'about' })}
                />
              )}
              {activeTab === 'my-profile' && user?.employeeId && (
                <ProfileView
                  employeeId={user.employeeId}
                  hideBack={true}
                  hideSidebarDuplicates
                  onChanged={() => void loadDashboardData()}
                />
              )}
              {activeTab === 'announcements' && (
                <AnnouncementsPanel
                  announcements={announcements}
                  role={role}
                  departments={allDepartments}
                  onRefresh={() => loadDashboardData()}
                />
              )}
              {activeTab === 'leaves' && (
                <div className="space-y-4">
                  <SubTabs
                    tabs={[
                      { id: 'leaves', label: LEAVES_ENABLED ? 'Leaves' : `Leaves · ${LEAVES_LAUNCH_LABEL}` },
                      { id: 'holidays', label: 'Holidays' },
                    ]}
                    active={leavesSubTab}
                    onChange={setLeavesSubTab}
                  />
                  {leavesSubTab === 'leaves' && !LEAVES_ENABLED ? (
                    <LeavesComingSoon onShowHolidays={() => setLeavesSubTab('holidays')} />
                  ) : leavesSubTab === 'leaves' ? (
                    <LeavesPanel
                      leaves={leaves}
                      role={role}
                      user={user}
                      onRefresh={() => loadDashboardData()}
                      onOpenApplyLeave={(employeeId: number) => setProfileDrawer({ open: true, employeeId, tab: 'leaves' })}
                    />
                  ) : (
                    <HolidaysPanel role={role} />
                  )}
                </div>
              )}
              {activeTab === 'attendance' && (
                <AttendancePanel
                  user={user}
                  employees={employees}
                  focusEmployeeId={focusAttendanceEmployeeId}
                />
              )}
              {activeTab === 'salary' && (
                <SalaryPage role={role} user={user} />
              )}
              {activeTab === 'documents' && (
                <DocumentManagerPanel role={role} currentEmployeeId={user?.employeeId ?? null} />
              )}
              {activeTab === 'learning' && (
                // Keyed so following an E-Library link reopens the page on that tab.
                <LearningPage key={learningStartTab} role={role} user={user} departments={allDepartments} initialSubTab={learningStartTab} />
              )}
              {activeTab === 'notifications' && (
                <NotificationsPanel
                  notifications={notifications}
                  onRefresh={refreshNotifications}
                  onOpenNotification={handleOpenNotification}
                />
              )}
            </Suspense>
          )}
        </div>
      </main>

      <MobileTabBar
        primary={[
          { id: 'overview', label: 'Home', icon: Home },
          { id: 'attendance', label: 'Attendance', icon: Clock },
          // While leave management is off, Announcements takes the Leaves slot; Holidays moves to More.
          LEAVES_ENABLED
            ? { id: 'leaves', label: 'Leaves', icon: Calendar, badge: pendingLeaves }
            : { id: 'announcements', label: 'Announcements', icon: Megaphone, badge: unreadAnnouncementCount },
          { id: 'salary', label: 'Salary', icon: DollarSign },
        ]}
        more={[
          LEAVES_ENABLED
            ? { id: 'announcements', label: 'Announcements', icon: Megaphone, badge: unreadAnnouncementCount }
            : { id: 'leaves', label: 'Holidays', icon: Palmtree },
          { id: 'documents', label: 'Documents', icon: FileText },
          { id: 'learning', label: 'Learning', icon: GraduationCap },
          ...(role !== 'EMPLOYEE' ? [{ id: 'employees', label: 'Employees', icon: Users }] : []),
          { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotificationCount },
        ]}
        activeTab={activeTab}
        onSelect={openTab}
        onSignOut={signOut}
      />

      {user && <BirthdayCelebration currentEmployeeId={user.employeeId} viewerName={name} />}

      {profileDrawer.open && profileDrawer.employeeId && (
        <ProfileDrawer
          employeeId={profileDrawer.employeeId}
          initialTab={profileDrawer.tab}
          onClose={() => setProfileDrawer({ open: false, employeeId: null, tab: 'about' })}
          onChanged={() => void loadDashboardData()}
          onEmployeeRemoved={() => {
            setProfileDrawer({ open: false, employeeId: null, tab: 'about' });
            void loadDashboardData();
          }}
        />
      )}
    </div>
  );
};

// ─── Overview Panel ──────────────────────────────────────────

interface OverviewProps {
  role: UserRole;
  name: string;
  onNavigate: (tab: string) => void;
  employeeCount: number;
  pendingLeaves: number;
  announcementCount: number;
  announcements: Announcement[];
  heroBanners: HeroBanner[];
  onViewAllAnnouncements: () => void;
  onRefreshAnnouncements: () => void;
}

const OverviewPanel: React.FC<OverviewProps> = ({
  role, name, announcements, heroBanners, onNavigate, onViewAllAnnouncements, onRefreshAnnouncements
}) => {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [showHeroComposer, setShowHeroComposer] = useState(false);

  const handleOpenAnnouncement = async (ann: Announcement) => {
    setSelectedAnnouncement(ann);
    if (ann.isRead) return;
    try {
      await announcementApi.markRead(ann.id);
      onRefreshAnnouncements();
    } catch {
      // non-critical
    }
  };

  const handleDeleteHeroBanner = async (id: number) => {
    if (!window.confirm('Remove this hero banner?')) return;
    try {
      await heroBannerApi.delete(id);
      onRefreshAnnouncements();
    } catch {
      // non-critical
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Decorative — skipped on phones so the greeting and today's numbers lead (managed from desktop) */}
      <div className="hidden sm:block">
        <HeroBannerCarousel
          banners={heroBanners}
          role={role}
          onAdd={() => setShowHeroComposer(true)}
          onDelete={handleDeleteHeroBanner}
        />
      </div>

      {/* Role-specific home: greeting, quick actions, KPIs and panels for this user's data */}
      <HomeDashboard role={role} name={name} onNavigate={onNavigate} />

      <AnnouncementSpotlight
        announcements={announcements}
        onViewAll={onViewAllAnnouncements}
        onOpenAnnouncement={handleOpenAnnouncement}
      />

      {selectedAnnouncement && (
        <AnnouncementDetailDialog
          announcement={selectedAnnouncement}
          onClose={() => setSelectedAnnouncement(null)}
        />
      )}

      {showHeroComposer && (
        <HeroBannerComposer
          onClose={() => setShowHeroComposer(false)}
          onCreated={() => {
            setShowHeroComposer(false);
            onRefreshAnnouncements();
          }}
        />
      )}
    </div>
  );
};

// ─── Salary Page (tabbed: Import / History / My Salary) ──────

type SalarySubTab = 'import' | 'history' | 'my-salary';

const PageFilterBar: React.FC<{
  filters: PageFilterState;
  onChange: (filters: PageFilterState) => void;
  searchPlaceholder: string;
}> = ({ filters, onChange, searchPlaceholder }) => {
  const update = (patch: Partial<PageFilterState>) => onChange({ ...filters, ...patch });
  const setMode = (dateMode: DateFilterMode) => {
    onChange({
      ...filters,
      dateMode,
      date: dateMode === 'DATE' ? filters.date : '',
      month: dateMode === 'MONTH' ? filters.month : '',
      year: dateMode === 'YEAR' ? filters.year : '',
    });
  };

  return (
    <div className="space-y-3 mb-4 sm:mb-6">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={filters.search}
          onChange={e => update({ search: e.target.value })}
          placeholder={searchPlaceholder}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm transition-all"
        />
      </div>

      {/* One swipeable row on phones; wraps on wider screens */}
      <div className="flex flex-nowrap sm:flex-wrap items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        {(['ALL', 'DATE', 'MONTH', 'YEAR'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            onClick={() => setMode(mode)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex-shrink-0 ${
              filters.dateMode === mode
                ? 'bg-[#f46617] text-white shadow-sm shadow-orange-500/30'
                : 'bg-orange-50/60 text-slate-500 hover:bg-orange-50'
            }`}
          >
            {mode !== 'ALL' && <Calendar className="w-3.5 h-3.5" />}
            {mode === 'ALL' ? 'All Dates' : mode === 'DATE' ? 'Date' : mode === 'MONTH' ? 'Month' : 'Year'}
          </button>
        ))}

        {filters.dateMode === 'DATE' && (
          <input
            type="date"
            value={filters.date}
            onChange={e => update({ date: e.target.value })}
            className="px-3 py-2 bg-white border border-orange-100 rounded-xl text-slate-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm"
          />
        )}
        {filters.dateMode === 'MONTH' && (
          <input
            type="month"
            value={filters.month}
            onChange={e => update({ month: e.target.value })}
            className="px-3 py-2 bg-white border border-orange-100 rounded-xl text-slate-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm"
          />
        )}
        {filters.dateMode === 'YEAR' && (
          <input
            type="number"
            min="1900"
            max="2100"
            value={filters.year}
            onChange={e => update({ year: e.target.value })}
            placeholder="Year"
            className="w-28 px-3 py-2 bg-white border border-orange-100 rounded-xl text-slate-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm"
          />
        )}

        {(filters.search || filters.dateMode !== 'ALL' || filters.date || filters.month || filters.year) && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_PAGE_FILTERS)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        )}
      </div>
    </div>
  );
};

const SalaryPage: React.FC<{ role: UserRole; user: AuthUser | null }> = ({ role, user }) => {
  // HR, plus Accounts staff HR has granted payroll-upload access to.
  const isHR = role === 'HR' || Boolean(user?.canImportPayroll);
  const [subTab, setSubTab] = useState<SalarySubTab>(isHR ? 'import' : 'my-salary');
  const [filters, setFilters] = useState<PageFilterState>(EMPTY_PAGE_FILTERS);

  const tabs: { id: SalarySubTab; label: string }[] = [
    ...(isHR ? [
      { id: 'import' as const, label: 'Import' },
      { id: 'history' as const, label: 'History' },
    ] : []),
    ...(user?.employeeId ? [{ id: 'my-salary' as const, label: 'My Salary' }] : []),
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Salary</h2>
        {tabs.length > 1 && (
          <div className="flex max-w-full overflow-x-auto no-scrollbar bg-orange-50/60 p-1.5 rounded-2xl border border-orange-100/50">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap flex-shrink-0 ${
                  subTab === tab.id
                    ? 'bg-white text-[#f46617] shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nothing to search or filter on the import form */}
      {subTab !== 'import' && (
        <PageFilterBar
          filters={filters}
          onChange={setFilters}
          searchPlaceholder="Search salary slips, payroll files, amounts, dates..."
        />
      )}

      {subTab === 'import' && isHR && <PayrollImportPanel />}
      {subTab === 'history' && isHR && <PayrollImportHistory filters={filters} />}
      {subTab === 'my-salary' && user?.employeeId && (
        <SalaryTab
          employeeId={user.employeeId}
          employeeName={user.employee?.name || ''}
          employeeDepartment={user.employee?.department || ''}
          employeePosition={user.employee?.position || ''}
          filters={filters}
        />
      )}
    </div>
  );
};

// ─── Learning Page (tabbed: Catalog / My Learning / Team / Overview) ─

type LearningSubTab = 'catalog' | 'paths' | 'ilt' | 'badges' | 'elibrary' | 'my-learning' | 'team' | 'overview';
type LeavesSubTab = 'leaves' | 'holidays';

/** Shown on the Leaves tab while leave management is switched off (utils/features). */
const LeavesComingSoon: React.FC<{ onShowHolidays: () => void }> = ({ onShowHolidays }) => (
  <div className="bg-white rounded-[28px] border border-orange-100/60 shadow-card px-6 py-12 sm:py-16 text-center">
    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-50 text-[#f46617] mb-4">
      <Calendar className="w-7 h-7" />
    </div>
    <p className="text-[11px] font-bold uppercase tracking-wider text-[#f46617]">Coming in {LEAVES_LAUNCH_LABEL}</p>
    <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight mt-1">Leave management is on its way</h2>
    <p className="text-sm text-slate-500 font-medium mt-2 max-w-md mx-auto">
      Applying for and approving leave here starts next year. Until then, request leave the usual way with your manager or HR.
    </p>
    <button type="button" onClick={onShowHolidays} className="btn-orange mt-6 px-5 py-2.5 text-xs font-bold rounded-2xl mx-auto">
      <Palmtree className="w-4 h-4" /> See this year's holidays
    </button>
  </div>
);

/** Segmented control for in-page tabs (same look as the Salary/Learning tabs). */
function SubTabs<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex w-fit max-w-full overflow-x-auto no-scrollbar bg-orange-50/60 p-1.5 rounded-2xl border border-orange-100/50">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap flex-shrink-0 ${
            active === tab.id ? 'bg-white text-[#f46617] shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

const LearningPage: React.FC<{ role: UserRole; user: AuthUser | null; departments: string[]; initialSubTab?: LearningSubTab }> = ({ role, user, departments, initialSubTab = 'catalog' }) => {
  const isManagement = MANAGEMENT_ROLES.includes(role);
  const isAdmin = ALL_ACCESS_ROLES.includes(role);
  const [subTab, setSubTab] = useState<LearningSubTab>(initialSubTab);
  const [filters, setFilters] = useState<PageFilterState>(EMPTY_PAGE_FILTERS);

  const tabs: { id: LearningSubTab; label: string }[] = [
    { id: 'catalog', label: 'Catalog' },
    { id: 'paths', label: 'Paths' },
    { id: 'ilt', label: 'Live Training' },
    { id: 'badges', label: 'Badges' },
    { id: 'elibrary', label: 'E-Library' },
    ...(user?.employeeId ? [{ id: 'my-learning' as const, label: 'My Learning' }] : []),
    ...(isManagement ? [{ id: 'team' as const, label: 'Team' }] : []),
    ...(isAdmin ? [{ id: 'overview' as const, label: 'Overview' }] : []),
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Learning</h2>
        {tabs.length > 1 && (
          <div className="flex max-w-full overflow-x-auto no-scrollbar bg-orange-50/60 p-1.5 rounded-2xl border border-orange-100/50">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap flex-shrink-0 ${
                  subTab === tab.id
                    ? 'bg-white text-[#f46617] shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* E-Library has its own search */}
      {subTab !== 'elibrary' && (
        <PageFilterBar
          filters={filters}
          onChange={setFilters}
          searchPlaceholder="Search courses, paths, sessions, employees, badges, departments..."
        />
      )}

      {subTab === 'catalog' && <LearningCatalogPanel role={role} departments={departments} filters={filters} />}
      {subTab === 'paths' && <LearningPathsPanel role={role} departments={departments} filters={filters} />}
      {subTab === 'ilt' && <ILTSessionsPanel role={role} departments={departments} filters={filters} />}
      {subTab === 'badges' && <BadgeCatalogPanel role={role} filters={filters} />}
      {subTab === 'elibrary' && <ELibraryTab role={role} />}
      {subTab === 'my-learning' && user?.employeeId && <MyLearningPanel filters={filters} />}
      {subTab === 'team' && isManagement && <TeamLearningPanel filters={filters} />}
      {subTab === 'overview' && isAdmin && <AdminLearningDashboard filters={filters} />}
    </div>
  );
};

// ─── Employees Page ──────────────────────────────────────────
// The logged-in user's own record is reached via "My Profile" in the sidebar, not the directory.

const EmployeesPage: React.FC<EmployeesPanelProps & { currentEmployeeId: number | null }> = ({
  employees,
  currentEmployeeId,
  ...rest
}) => (
  <EmployeesPanel
    {...rest}
    employees={currentEmployeeId ? employees.filter(employee => employee.id !== currentEmployeeId) : employees}
    allEmployees={employees}
  />
);

// ─── Employees Panel ─────────────────────────────────────────

interface EmployeesPanelProps {
  employees: Employee[];
  /** Full list incl. the logged-in user — used for manager options. Defaults to `employees`. */
  allEmployees?: Employee[];
  role: UserRole;
  onRefresh: () => void;
  onOpenProfile: (employeeId: number) => void;
}

const EmployeesPanel: React.FC<EmployeesPanelProps> = ({ employees, allEmployees = employees, role, onRefresh, onOpenProfile }) => {
  const [syncingMasterData, setSyncingMasterData] = useState(false);
  
  // Add employee modal states
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [biometricId, setBiometricId] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [employeeType, setEmployeeType] = useState('Full-time');
  const [tallyLedgerName, setTallyLedgerName] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [uanNumber, setUanNumber] = useState('');
  const [pfAccountNumber, setPfAccountNumber] = useState('');
  const [esiNumber, setEsiNumber] = useState('');
  const [pranNumber, setPranNumber] = useState('');
  const [taxRegime, setTaxRegime] = useState('');
  const [createUser, setCreateUser] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [systemRole, setSystemRole] = useState<UserRole>('EMPLOYEE');
  const [managerId, setManagerId] = useState('');
  type ManagerCandidate = {
    employeeId: number;
    name: string;
    position: string | null;
    department: string | null;
    userId?: number;
    roleHint?: 'MANAGER' | 'LEADERSHIP';
  };
  const [availableManagers, setAvailableManagers] = useState<ManagerCandidate[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetForm = () => {
    setName('');
    setBiometricId('');
    setPosition('');
    setDepartment('');
    setEmail('');
    setPhone('');
    setGender('');
    setDateOfBirth('');
    setAvatarUrl('');
    setEmployeeType('Full-time');
    setTallyLedgerName('');
    setEmployeeNumber('');
    setPanNumber('');
    setUanNumber('');
    setPfAccountNumber('');
    setEsiNumber('');
    setPranNumber('');
    setTaxRegime('');
    setCreateUser(false);
    setUsername('');
    setPassword('');
    setSystemRole('EMPLOYEE');
    setManagerId('');
    setError('');
  };

  const loadManagerOptions = async () => {
    setLoadingManagers(true);
    try {
      const res = await employeeApi.managersList();
      const managerMap = new Map<number, ManagerCandidate>();

      (allEmployees ?? []).forEach(employee => {
        managerMap.set(employee.id, {
          employeeId: employee.id,
          name: employee.name,
          position: employee.position,
          department: employee.department,
        });
      });

      (res.data?.managers ?? []).forEach(manager => {
        managerMap.set(manager.employeeId, {
          employeeId: manager.employeeId,
          userId: manager.userId,
          name: manager.name,
          position: manager.position,
          department: manager.department,
          roleHint: manager.role,
        });
      });

      setAvailableManagers(
        Array.from(managerMap.values()).sort((a, b) => {
          const aRank = a.roleHint ? 0 : 1;
          const bRank = b.roleHint ? 0 : 1;
          return aRank - bRank || a.name.localeCompare(b.name);
        })
      );
    } catch {
      setAvailableManagers(
        allEmployees.map(e => ({
          employeeId: e.id,
          name: e.name,
          position: e.position,
          department: e.department,
        }))
      );
    } finally {
      setLoadingManagers(false);
    }
  };

  useEffect(() => {
    if (showModal) {
      void loadManagerOptions();
    }
  }, [showModal, allEmployees]);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Employee name is required');
      return;
    }
    if (createUser && (!username.trim() || !password.trim())) {
      setError('Username and password are required for user account creation');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const payload: any = {
        name,
        position: position || undefined,
        department: department || undefined,
        email: email || undefined,
        phone: phone || undefined,
        gender: gender || undefined,
        dateOfBirth: dateOfBirth || undefined,
        avatar: avatarUrl || undefined,
        employeeType: employeeType || undefined,
        tallyLedgerName: tallyLedgerName || undefined,
        employeeNumber: employeeNumber || undefined,
        panNumber: panNumber || undefined,
        uanNumber: uanNumber || undefined,
        pfAccountNumber: pfAccountNumber || undefined,
        esiNumber: esiNumber || undefined,
        pranNumber: pranNumber || undefined,
        taxRegime: taxRegime || undefined,
        biometricId: biometricId ? parseInt(biometricId, 10) : undefined,
        managerId: managerId ? parseInt(managerId, 10) : undefined,
      };

      if (createUser) {
        payload.createUser = true;
        payload.username = username;
        payload.password = password;
        payload.role = systemRole;
      }

      const res = await employeeApi.create(payload);
      if (res.success) {
        setShowModal(false);
        resetForm();
        onRefresh();
      } else {
        setError('Failed to create employee profile');
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred while creating employee');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncMasterData = async () => {
    setSyncingMasterData(true);
    setError('');
    try {
      const res = await employeeApi.syncMasterData();
      if (res.success) {
        onRefresh();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sync master employee data');
    } finally {
      setSyncingMasterData(false);
    }
  };

  return (
    <div>
      <EmployeeDirectory
        employees={employees}
        onOpenProfile={onOpenProfile}
        showAdminInsights={role === 'HR'}
        actions={role === 'HR' ? (
          <>
            <button
              onClick={handleSyncMasterData}
              disabled={syncingMasterData}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-bold rounded-2xl transition-all"
            >
              {syncingMasterData ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync Master Data
            </button>
            <button
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="btn-orange px-4 py-2.5 text-xs font-bold rounded-2xl"
            >
              <UserPlus className="w-4 h-4" /> Add Employee
            </button>
          </>
        ) : undefined}
      />

      {/* Add Employee Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!submitting) setShowModal(false); }} />
          
          {/* Dialog Box */}
          <div className="relative bg-white rounded-[32px] border border-orange-100/50 shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-orange-100/50 flex-shrink-0">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#f46617]" />
                Add New Employee
              </h3>
              <button
                disabled={submitting}
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-xl hover:bg-orange-50 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Avatar preview */}
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-orange-50/30 border border-orange-100/60">
                <EmployeeAvatar
                  name={name || '?'}
                  avatar={avatarUrl || undefined}
                  gender={gender || undefined}
                  size="w-16 h-16"
                  shape="rounded"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Avatar Preview</p>
                  <p className="text-xs text-slate-400 font-medium">
                    {avatarUrl ? 'Photo URL set' : gender ? `${gender} clipart will be used` : 'Initials shown until gender or photo set'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Employee details */}
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. John Doe"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Gender
                  </label>
                  <DropdownSelect
                    value={gender}
                    onChange={setGender}
                    disabled={submitting}
                    placeholder="Select gender"
                    options={[
                      { value: 'Male', label: 'Male' },
                      { value: 'Female', label: 'Female' },
                      { value: 'Other', label: 'Other / Prefer not to say' },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => setDateOfBirth(e.target.value)}
                    disabled={submitting}
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Biometric ID / EnNo
                  </label>
                  <input
                    type="number"
                    value={biometricId}
                    onChange={e => setBiometricId(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. 48"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Profile Photo URL
                  </label>
                  <input
                    type="url"
                    value={avatarUrl}
                    onChange={e => setAvatarUrl(e.target.value)}
                    disabled={submitting}
                    placeholder="https://example.com/photo.jpg (optional)"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Employee Type
                  </label>
                  <DropdownSelect
                    value={employeeType}
                    onChange={setEmployeeType}
                    disabled={submitting}
                    placeholder="Select employee type"
                    options={optionsWithCurrent(EMPLOYEE_TYPES, employeeType)}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Position / Designation
                  </label>
                  <input
                    type="text"
                    value={position}
                    onChange={e => setPosition(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. Software Engineer"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Department
                  </label>
                  <DropdownSelect
                    value={department}
                    onChange={setDepartment}
                    disabled={submitting}
                    placeholder="Select department"
                    options={optionsWithCurrent(DEPARTMENTS, department)}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Tally Ledger Name
                  </label>
                  <input
                    type="text"
                    value={tallyLedgerName}
                    onChange={e => setTallyLedgerName(e.target.value)}
                    disabled={submitting}
                    placeholder="Exact ledger name from Tally"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div className="sm:col-span-2 pt-2 border-t border-orange-100/60">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Payroll & Statutory Details</p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Employee Number
                  </label>
                  <input
                    type="text"
                    value={employeeNumber}
                    onChange={e => setEmployeeNumber(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. Afac10375"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Tax Regime
                  </label>
                  <input
                    type="text"
                    value={taxRegime}
                    onChange={e => setTaxRegime(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. Regular Tax Regime"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    PAN Number
                  </label>
                  <input
                    type="text"
                    value={panNumber}
                    onChange={e => setPanNumber(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. IRLPK0350R"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    UAN Number
                  </label>
                  <input
                    type="text"
                    value={uanNumber}
                    onChange={e => setUanNumber(e.target.value)}
                    disabled={submitting}
                    placeholder="Universal Account Number"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    PF Account Number
                  </label>
                  <input
                    type="text"
                    value={pfAccountNumber}
                    onChange={e => setPfAccountNumber(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. 1021632"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    ESI Number
                  </label>
                  <input
                    type="text"
                    value={esiNumber}
                    onChange={e => setEsiNumber(e.target.value)}
                    disabled={submitting}
                    placeholder="ESI account number"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    PR Account Number (PRAN)
                  </label>
                  <input
                    type="text"
                    value={pranNumber}
                    onChange={e => setPranNumber(e.target.value)}
                    disabled={submitting}
                    placeholder="Pension Account Number"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. john@example.com"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. +91 99999 88888"
                    className="w-full text-slate-800 text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400 bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Reporting Manager
                  </label>
                  <DropdownSelect
                    value={managerId}
                    onChange={setManagerId}
                    disabled={submitting || loadingManagers}
                    placeholder={loadingManagers ? 'Loading managers...' : 'No manager assigned'}
                    options={availableManagers.map(manager => ({
                      value: String(manager.employeeId),
                      label: manager.name,
                      description: [
                        manager.position,
                        manager.roleHint === 'LEADERSHIP' ? 'Leadership' : null,
                        manager.roleHint === 'MANAGER' ? 'Manager' : null,
                      ].filter(Boolean).join(' • '),
                    }))}
                  />
                </div>
              </div>

              {/* Checkbox: Create login account */}
              <div className="pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={createUser}
                    onChange={e => setCreateUser(e.target.checked)}
                    disabled={submitting}
                    className="w-4 h-4 rounded border-orange-200 text-[#f46617] focus:ring-brand-orange/30 accent-[#f46617] cursor-pointer bg-white"
                  />
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                    Create User Account (System Access)
                  </span>
                </label>
              </div>

              {/* User account details */}
              {createUser && (
                <div className="p-4 rounded-2xl border border-orange-100 bg-orange-50/20 space-y-4 animate-scale-in">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                        Username *
                      </label>
                      <input
                        type="text"
                        required={createUser}
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        disabled={submitting}
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
                        required={createUser}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={submitting}
                        placeholder="Min 6 characters"
                        className="w-full text-slate-800 bg-white text-sm rounded-xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all placeholder-slate-400"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                        Access Role
                      </label>
                      <DropdownSelect
                        value={systemRole}
                        onChange={value => setSystemRole(value as UserRole)}
                        disabled={submitting}
                        placeholder="Select access role"
                        options={[
                          { value: 'EMPLOYEE', label: 'Employee (Standard Access)' },
                          { value: 'MANAGER', label: 'Manager (Team Approval/Performance)' },
                          { value: 'HR', label: 'HR Admin (Full Access)' },
                          { value: 'LEADERSHIP', label: 'Leadership (Company-wide Visibility)' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}
            </form>

            <div className="flex items-center gap-3 p-6 border-t border-orange-100/50 bg-orange-50/10 flex-shrink-0">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2.5 bg-white border border-slate-250 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                onClick={handleCreateEmployee}
                className="flex-1 btn-orange py-2.5 text-sm font-bold rounded-xl"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>{submitting ? 'Creating...' : 'Create Employee'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ─── Announcements Panel ─────────────────────────────────────

const NotificationsPanel: React.FC<{
  notifications: AppNotification[];
  onRefresh: () => void;
  onOpenNotification: (notification: AppNotification) => void;
}> = ({ notifications, onRefresh, onOpenNotification }) => {
  const unreadCount = notifications.filter(notification => !notification.readAt).length;
  const handleOpen = async (notification: AppNotification) => {
    if (!notification.readAt) {
      await notificationApi.markRead(notification.id);
      onRefresh();
    }
    onOpenNotification(notification);
  };
  const markAllRead = async () => {
    await notificationApi.markAllRead();
    onRefresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Notifications</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Attendance updates and system alerts</p>
        </div>
        {unreadCount > 0 && <button type="button" onClick={markAllRead} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-2xl">Mark All Read</button>}
      </div>
      {notifications.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-orange-100/50 shadow-card text-slate-400">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(notification => (
            <button type="button" key={notification.id} onClick={() => handleOpen(notification)} className={`w-full text-left rounded-3xl border p-5 shadow-card transition-all ${notification.readAt ? 'bg-white border-orange-100/50' : 'bg-orange-50/40 border-orange-200'}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 p-2 rounded-xl bg-white border border-orange-100 text-[#f46617]"><Clock className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-slate-800">{notification.title}</h3>
                    {!notification.readAt && <span className="w-2 h-2 rounded-full bg-[#f46617]" />}
                  </div>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">{notification.message}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-3">{new Date(notification.createdAt).toLocaleString('en-IN')}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const PRIORITY_LABELS: Record<Announcement['priority'], string> = {
  LOW: 'Normal',
  MEDIUM: 'Important',
  HIGH: 'High Priority',
  URGENT: 'Urgent',
};

const READ_FILTERS = ['ALL', 'UNREAD', 'READ'] as const;
type ReadFilter = typeof READ_FILTERS[number];

const AnnouncementsPanel: React.FC<{
  announcements: Announcement[];
  role: UserRole;
  departments: string[];
  onRefresh: () => void;
}> = ({ announcements, role, departments, onRefresh }) => {
  const [showComposer, setShowComposer] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | Announcement['priority']>('ALL');
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [filters, setFilters] = useState<PageFilterState>(EMPTY_PAGE_FILTERS);

  const handleDelete = async (id: number) => {
    if (!window.confirm('Remove this announcement?')) return;
    setDeletingId(id);
    try {
      await announcementApi.delete(id);
      onRefresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpen = async (ann: Announcement) => {
    setSelectedAnnouncement(ann);
    if (ann.isRead) return;
    try {
      await announcementApi.markRead(ann.id);
      onRefresh();
    } catch {
      // non-critical
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    try {
      await announcementApi.markAllRead();
      onRefresh();
    } finally {
      setMarkingAllRead(false);
    }
  };

  const filtered = announcements.filter(ann => {
    if (readFilter === 'UNREAD' && ann.isRead) return false;
    if (readFilter === 'READ' && !ann.isRead) return false;
    if (priorityFilter !== 'ALL' && ann.priority !== priorityFilter) return false;
    if (!matchesSearch(filters.search, [
      ann.title,
      ann.content,
      ann.priority,
      PRIORITY_LABELS[ann.priority],
      ann.targetDepartment,
      ann.createdBy?.username,
      ann.media?.map(m => `${m.type} ${m.caption ?? ''} ${m.url}`).join(' '),
    ])) return false;
    if (!matchesDateFilter(filters, [ann.publishedAt, ann.scheduledAt, ann.createdAt, ann.expiresAt])) return false;
    return true;
  });

  const unreadCount = announcements.filter(a => !a.isRead).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
          <span className="sm:hidden">Announcements</span>
          <span className="hidden sm:inline">Company Announcements</span>
        </h2>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAllRead}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 text-xs font-bold rounded-2xl transition-all"
            >
              {markingAllRead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Mark All Read
            </button>
          )}
          {role === 'HR' && (
            <button
              onClick={() => setShowComposer(true)}
              className="btn-orange px-4 py-2.5 text-xs font-bold rounded-2xl"
            >
              <Megaphone className="w-4 h-4" /> New<span className="hidden sm:inline"> Announcement</span>
            </button>
          )}
        </div>
      </div>

      <PageFilterBar
        filters={filters}
        onChange={setFilters}
        searchPlaceholder="Search announcements, content, priority, department, creator..."
      />

      {/* Filters — one swipeable row on phones */}
      <div className="flex flex-nowrap sm:flex-wrap items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        {READ_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setReadFilter(f)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex-shrink-0 ${
              readFilter === f ? 'bg-[#f46617] text-white shadow-sm shadow-orange-500/30' : 'bg-orange-50/60 text-slate-500 hover:bg-orange-50'
            }`}
          >
            {f === 'ALL' ? 'All' : f === 'UNREAD' ? 'Unread' : 'Read'}
          </button>
        ))}
        <span className="w-px h-5 bg-orange-100 mx-1 flex-shrink-0" />
        {(['ALL', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPriorityFilter(p)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex-shrink-0 ${
              priorityFilter === p ? 'bg-slate-700 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
            }`}
          >
            {p === 'ALL' ? 'All Priorities' : PRIORITY_LABELS[p]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No announcements right now. Check back soon.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(ann => (
            <div
              key={ann.id}
              onClick={() => handleOpen(ann)}
              className={`bg-white rounded-3xl p-6 border shadow-card cursor-pointer transition-all ${
                ann.isRead ? 'border-orange-100/50' : 'border-orange-300/60 ring-1 ring-orange-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    {!ann.isRead && (
                      <span className="w-2 h-2 rounded-full bg-[#f46617] flex-shrink-0" title="Unread" />
                    )}
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                      ann.priority === 'URGENT' ? 'bg-red-50 text-red-600 border border-red-100' :
                      ann.priority === 'HIGH' ? 'bg-orange-50 text-[#f46617] border border-orange-100' :
                      ann.priority === 'MEDIUM' ? 'bg-blue-50 text-blue-605 border border-blue-100' : 'bg-slate-50 text-slate-500 border border-slate-100'
                    }`}>
                      {PRIORITY_LABELS[ann.priority]}
                    </span>
                    {ann.isPinned && (
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                        Pinned
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 leading-snug">{ann.title}</h3>
                  {ann.content && <p className="text-sm text-slate-600 mt-2.5 leading-relaxed whitespace-pre-line">{ann.content}</p>}
                </div>
                {role === 'HR' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(ann.id); }}
                    disabled={deletingId === ann.id}
                    className="p-2 rounded-xl hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Remove announcement"
                  >
                    {deletingId === ann.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {ann.media && ann.media.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                  {ann.media.map(m => (
                    <div key={m.id} className="rounded-2xl overflow-hidden bg-slate-50 border border-slate-100 aspect-video">
                      {m.type === 'IMAGE' && <img src={m.url} alt="" className="w-full h-full object-cover" />}
                      {m.type === 'VIDEO_FILE' && <video src={m.url} controls className="w-full h-full object-cover" />}
                      {(m.type === 'VIDEO_EMBED' || m.type === 'SOCIAL_EMBED' || m.type === 'LINK') && (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="w-full h-full flex items-center justify-center bg-slate-800 text-white text-xs font-bold gap-1.5 hover:bg-slate-700 transition-colors"
                        >
                          View Linked Content
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 flex items-center gap-4 text-xs font-bold text-slate-400 uppercase tracking-wider border-t border-orange-100/30 pt-4">
                <span>By {ann.createdBy?.username || 'HR'}</span>
                <span>•</span>
                <span>{new Date(ann.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showComposer && (
        <AnnouncementComposer
          departments={departments}
          onClose={() => setShowComposer(false)}
          onCreated={() => {
            setShowComposer(false);
            onRefresh();
          }}
        />
      )}

      {selectedAnnouncement && (
        <AnnouncementDetailDialog
          announcement={selectedAnnouncement}
          onClose={() => setSelectedAnnouncement(null)}
        />
      )}
    </div>
  );
};

// ─── Leaves Panel ────────────────────────────────────────────

const LeavesPanel: React.FC<{
  leaves: Leave[];
  role: UserRole;
  user: AuthUser | null;
  onRefresh: () => void;
  onOpenApplyLeave: (employeeId: number) => void;
}> = ({ leaves, role, user, onRefresh, onOpenApplyLeave }) => {
  const [activeLeave, setActiveLeave] = useState<Leave | null>(null);
  const [actionType, setActionType] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [category, setCategory] = useState<'TEAM' | 'MY'>('TEAM');
  const [leaveActionNotice, setLeaveActionNotice] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [managerFilter, setManagerFilter] = useState('ALL');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('ALL');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  // Phones show only the search box until "Filters" is tapped.
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = [departmentFilter !== 'ALL', managerFilter !== 'ALL', leaveTypeFilter !== 'ALL', dateFromFilter, dateToFilter]
    .filter(Boolean).length;

  const isManagement = MANAGEMENT_ROLES.includes(role);
  const canApplyLeave = Boolean(user?.employeeId);
  const ownLeaves = user?.employeeId ? leaves.filter(leave => leave.employeeId === user.employeeId) : [];
  const hierarchyLeaves = user?.employeeId ? leaves.filter(leave => leave.employeeId !== user.employeeId) : leaves;
  const teamLabel = ALL_ACCESS_ROLES.includes(role) ? 'All Leaves' : 'Team Leaves';
  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          leaves
            .map(leave => leave.employee?.department)
            .filter((department): department is string => Boolean(department))
        )
      ).sort((a, b) => a.localeCompare(b)),
    [leaves]
  );

  const [managerOptions, setManagerOptions] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadManagers = async () => {
      try {
        const res = await employeeApi.managersList();
        if (!isMounted) return;

        const managersById = new Map<number, string>();
        (res.data?.managers ?? []).forEach(manager => {
          managersById.set(manager.employeeId, manager.name);
        });
        leaves.forEach(leave => {
          const manager = leave.employee?.manager;
          if (manager?.id) {
            managersById.set(manager.id, manager.name);
          }
        });

        setManagerOptions(
          Array.from(managersById.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } catch {
        if (!isMounted) return;

        const managersById = new Map<number, string>();
        leaves.forEach(leave => {
          const manager = leave.employee?.manager;
          if (manager?.id) {
            managersById.set(manager.id, manager.name);
          }
        });

        setManagerOptions(
          Array.from(managersById.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    };

    void loadManagers();

    return () => {
      isMounted = false;
    };
  }, [leaves]);

  const leaveTypeOptions = useMemo(
    () => Array.from(new Set(leaves.map(leave => leave.type))).sort((a, b) => a.localeCompare(b)),
    [leaves]
  );

  const filteredLeaves = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const fromDate = dateFromFilter || null;
    const toDate = dateToFilter || null;

    return leaves.filter(leave => {
      const isMyLeave = leave.employeeId === user?.employeeId;
      const isTeamLeave = user?.employeeId ? leave.employeeId !== user.employeeId : true;

      if (isManagement && user?.employeeId) {
        if (category === 'MY' && !isMyLeave) return false;
        if (category === 'TEAM' && !isTeamLeave) return false;
      }

      if (filter !== 'ALL' && leave.status !== filter) return false;
      if (leaveTypeFilter !== 'ALL' && leave.type !== leaveTypeFilter) return false;
      if (departmentFilter !== 'ALL' && leave.employee?.department !== departmentFilter) return false;

      if (managerFilter !== 'ALL') {
        const managerId = leave.employee?.manager?.id;
        if (String(managerId ?? '') !== managerFilter) return false;
      }

      const leaveStart = leave.startDate.split('T')[0];
      const leaveEnd = leave.endDate.split('T')[0];
      if (fromDate && leaveEnd < fromDate) return false;
      if (toDate && leaveStart > toDate) return false;

      if (!search) return true;

      const searchable = [
        leave.employee?.name,
        leave.employee?.department,
        leave.employee?.manager?.name,
        leave.employee?.manager?.position,
        leave.type,
        leave.status,
        leave.reason,
        leave.comment,
        leave.approvedBy?.username,
        leave.days.toString(),
        formatLeaveDuration(leave),
        new Date(leave.startDate).toLocaleDateString('en-IN'),
        new Date(leave.endDate).toLocaleDateString('en-IN'),
        isMyLeave ? 'my leave' : 'team leave',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(search);
    });
  }, [
    category,
    dateFromFilter,
    dateToFilter,
    departmentFilter,
    filter,
    isManagement,
    leaveTypeFilter,
    leaves,
    managerFilter,
    searchTerm,
    user?.employeeId,
  ]);

  const clearFilters = () => {
    setSearchTerm('');
    setDepartmentFilter('ALL');
    setManagerFilter('ALL');
    setLeaveTypeFilter('ALL');
    setDateFromFilter('');
    setDateToFilter('');
    setFilter('ALL');
    setCategory('TEAM');
  };

  const openReviewModal = (leave: Leave, type: 'APPROVE' | 'REJECT') => {
    setActiveLeave(leave);
    setActionType(type);
    setComment('');
    setError('');
  };

  const handleApplyLeave = () => {
    if (!user) return;

    if (user.employeeId) {
      setLeaveActionNotice('');
      onOpenApplyLeave(user.employeeId);
      return;
    }

    setLeaveActionNotice('This account is not linked to an employee profile yet. Link the HR or leadership user to an employee record to submit leave.');
  };

  const handleConfirmAction = async () => {
    if (!activeLeave || !actionType) return;
    setSubmitting(true);
    setError('');
    try {
      if (actionType === 'APPROVE') {
        await leaveApi.approve(activeLeave.id, comment || undefined);
      } else {
        await leaveApi.reject(activeLeave.id, comment || undefined);
      }
      setActiveLeave(null);
      setActionType(null);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to update leave status');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Leave Management</h2>
          {role === 'EMPLOYEE' && (
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">View your leave history. Use the button to apply.</p>
          )}
          {isManagement && (
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
              {category === 'TEAM'
                ? role === 'HR'
                  ? 'Review and manage all employee leave requests.'
                  : role === 'LEADERSHIP'
                    ? 'Review and manage company-wide leave requests.'
                  : 'Review and manage leave requests across your reporting hierarchy.'
                : 'View your own leave application history and status.'}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 self-stretch sm:self-auto min-w-0">
          <div className="flex flex-col items-start gap-1.5">
            <button
              onClick={handleApplyLeave}
              className="btn-orange px-4 py-2 text-xs font-bold rounded-2xl"
            >
              <Calendar className="w-4 h-4" /> Add Leave
            </button>
            {!canApplyLeave && leaveActionNotice && (
              <p className="max-w-xs text-[10px] text-amber-600 font-semibold leading-normal">
                {leaveActionNotice}
              </p>
            )}
          </div>

          {/* Filters */}
          <div className="flex max-w-full overflow-x-auto no-scrollbar bg-orange-50/60 p-1.5 rounded-2xl border border-orange-100/50">
            {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap flex-shrink-0 ${
                  filter === f
                    ? 'bg-white text-[#f46617] shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-5">
        {/* Search (+ Filters toggle on phones) */}
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search leaves..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-orange-100 rounded-2xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm transition-all"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(open => !open)}
            className={`sm:hidden flex items-center gap-1.5 px-3.5 rounded-2xl border text-xs font-bold transition-colors ${
              showFilters || activeFilterCount ? 'bg-orange-50 border-orange-200 text-[#f46617]' : 'bg-white border-orange-100 text-slate-600'
            }`}
          >
            <Filter className="w-4 h-4" /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
        </div>

        {/* Filters */}
        <div className={`${showFilters ? 'grid' : 'hidden'} sm:grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_minmax(160px,1fr)_minmax(270px,1.2fr)_auto] gap-3 items-center`}>
          <DropdownSelect
            value={departmentFilter}
            onChange={setDepartmentFilter}
            placeholder="All Departments"
            variant="filterCompact"
            leadingIcon={<Filter className="w-4 h-4" />}
            options={[
              { value: 'ALL', label: 'All Departments' },
              ...departmentOptions.map(dept => ({ value: dept, label: dept })),
            ]}
          />

          <DropdownSelect
            value={managerFilter}
            onChange={setManagerFilter}
            placeholder="All Managers"
            variant="filterCompact"
            leadingIcon={<Filter className="w-4 h-4" />}
            options={[
              { value: 'ALL', label: 'All Managers' },
              ...managerOptions.map(manager => ({ value: String(manager.id), label: manager.name })),
            ]}
          />

          <DropdownSelect
            value={leaveTypeFilter}
            onChange={setLeaveTypeFilter}
            placeholder="All Leave Types"
            variant="filterCompact"
            leadingIcon={<Filter className="w-4 h-4" />}
            options={[
              { value: 'ALL', label: 'All Leave Types' },
              ...leaveTypeOptions.map(type => ({ value: type, label: type })),
            ]}
          />

          <div className="flex items-center gap-1.5 sm:col-span-2 xl:col-span-1">
            <input
              type="date"
              value={dateFromFilter}
              onChange={e => setDateFromFilter(e.target.value)}
              className="w-full min-w-0 px-2.5 py-2 bg-white border border-orange-100 rounded-2xl text-slate-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm min-h-[44px]"
              title="From date"
            />
            <span className="text-slate-300 text-xs font-bold flex-shrink-0">-</span>
            <input
              type="date"
              value={dateToFilter}
              onChange={e => setDateToFilter(e.target.value)}
              className="w-full min-w-0 px-2.5 py-2 bg-white border border-orange-100 rounded-2xl text-slate-700 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange shadow-sm min-h-[44px]"
              title="To date"
            />
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold text-xs px-3 py-2 rounded-2xl border border-slate-200 transition-colors min-h-[44px] w-full sm:w-fit xl:w-auto"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Category Tabs for Management */}
      {isManagement && user?.employeeId && (
        <div className="flex border-b border-orange-100/50 mb-6 gap-6">
          <button
            onClick={() => setCategory('TEAM')}
            className={`pb-3 text-sm font-bold relative transition-all ${
              category === 'TEAM'
                ? 'text-[#f46617]'
                : 'text-slate-450 hover:text-slate-600'
            }`}
          >
            {teamLabel}
            <span className="ml-2 text-xs font-medium text-slate-400">({hierarchyLeaves.length})</span>
            {category === 'TEAM' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f46617] rounded-full" />
            )}
          </button>
          <button
            onClick={() => setCategory('MY')}
            className={`pb-3 text-sm font-bold relative transition-all ${
              category === 'MY'
                ? 'text-[#f46617]'
                : 'text-slate-450 hover:text-slate-600'
            }`}
          >
            My Leaves
            <span className="ml-2 text-xs font-medium text-slate-400">({ownLeaves.length})</span>
            {category === 'MY' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#f46617] rounded-full" />
            )}
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <p className="text-xs text-slate-500 font-semibold">
          Showing <span className="font-black text-slate-800">{filteredLeaves.length}</span>{' '}
          {filteredLeaves.length === 1 ? 'leave' : 'leaves'}
        </p>
        <p className="hidden sm:block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
          Search matches names, departments, managers, types, dates, comments and status
        </p>
      </div>

      {filteredLeaves.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-3xl border border-orange-100/50 shadow-card">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50 text-slate-400" />
          <p className="font-semibold">No leave records found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLeaves.map(leave => (
            <div key={leave.id} className="bg-white rounded-3xl p-5 border border-orange-100/50 hover:border-brand-orange/30 shadow-sm hover:shadow-md transition-all duration-300">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    leave.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-500' :
                    leave.status === 'REJECTED' ? 'bg-red-50 text-red-500' :
                    'bg-amber-50 text-amber-500'
                  }`}>
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {leave.employee?.name || 'Employee'} — <span className="text-slate-650 font-semibold">{leave.type}</span>
                    </p>
                    <p className="text-xs text-slate-500 font-semibold mt-1">
                      {new Date(leave.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' → '}
                      {new Date(leave.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}
                      <span className="font-bold text-[#f46617]">{formatLeaveDuration(leave)}</span>
                    </p>
                    {leave.reason && (
                      <p className="text-xs text-slate-600 mt-2.5 bg-orange-50/20 p-3 rounded-2xl border border-orange-100/20 italic">
                        "{leave.reason}"
                      </p>
                    )}
                    {leave.comment && (
                      <div className="flex gap-1.5 items-start text-xs text-slate-500 mt-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <MessageSquare className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                        <p>
                          <span className="font-bold text-slate-700">Review comment:</span> "{leave.comment}"
                          {leave.approvedBy && (
                            <span className="text-slate-400 font-medium block mt-1">by {leave.approvedBy.username}</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-3 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    leave.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                    leave.status === 'REJECTED' ? 'bg-red-50 text-red-600 border-red-100' :
                    'bg-amber-50 text-amber-600 border-amber-100'
                  }`}>
                    {leave.status}
                  </span>
                  
                  {leave.status === 'PENDING' && 
                   MANAGEMENT_ROLES.includes(role) && 
                   leave.employeeId !== user?.employeeId && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => openReviewModal(leave, 'APPROVE')}
                        className="px-3 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all flex items-center gap-1 shadow-sm shadow-emerald-500/10"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => openReviewModal(leave, 'REJECT')}
                        className="px-3 py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-xl transition-all flex items-center gap-1 shadow-sm shadow-red-500/10"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Dialog Modal */}
      {activeLeave && actionType && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => { if (!submitting) { setActiveLeave(null); setActionType(null); } }} />
          
          {/* Dialog Box */}
          <div className="relative bg-white rounded-[32px] border border-orange-100/50 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="flex items-center justify-between p-6 border-b border-orange-100/50">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                {actionType === 'APPROVE' ? (
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
                {actionType === 'APPROVE' ? 'Approve Leave Request' : 'Reject Leave Request'}
              </h3>
              <button
                disabled={submitting}
                onClick={() => { setActiveLeave(null); setActionType(null); }}
                className="p-1.5 rounded-xl hover:bg-orange-50 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Summary */}
              <div className="bg-orange-50/20 p-4 rounded-2xl border border-orange-100/30 text-xs font-semibold space-y-1.5 text-slate-600">
                <p>Employee: <span className="font-bold text-slate-800">{activeLeave.employee?.name}</span></p>
                <p>Leave Type: <span className="font-bold text-slate-800">{activeLeave.type}</span></p>
                <p>Dates: <span className="font-bold text-slate-800">
                  {new Date(activeLeave.startDate).toLocaleDateString('en-IN')} → {new Date(activeLeave.endDate).toLocaleDateString('en-IN')} ({formatLeaveDuration(activeLeave)})
                </span></p>
                {activeLeave.reason && (
                  <p className="mt-2 italic pt-2 border-t border-orange-100/30">
                    Reason: "{activeLeave.reason}"
                  </p>
                )}
              </div>

              {/* Comment Text Area */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Review Comment (Optional)
                </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  disabled={submitting}
                  rows={3}
                  placeholder={`Write comments regarding this ${actionType === 'APPROVE' ? 'approval' : 'rejection'}...`}
                  className="w-full text-slate-800 text-sm rounded-2xl px-3.5 py-2.5 border border-orange-100 focus:outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange resize-none bg-white placeholder-slate-400 transition-all"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 p-6 border-t border-orange-100/50 bg-orange-50/10">
              <button
                disabled={submitting}
                onClick={() => { setActiveLeave(null); setActionType(null); }}
                className="flex-1 px-4 py-2.5 bg-white border border-slate-250 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={submitting}
                onClick={handleConfirmAction}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-white text-sm font-bold rounded-xl shadow-sm transition-all ${
                  actionType === 'APPROVE'
                    ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/10'
                    : 'bg-red-500 hover:bg-red-600 shadow-red-500/10'
                }`}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>{submitting ? 'Submitting...' : actionType === 'APPROVE' ? 'Confirm Approval' : 'Confirm Rejection'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Dashboard;
