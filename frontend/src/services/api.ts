const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

/**
 * Centralized API client for all backend calls.
 * Automatically attaches JWT token from localStorage.
 * Handles errors consistently.
 */

interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

/** Fired when the API rejects the stored token; AuthContext logs the user out. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

function describeHttpFailure(status: number): string {
    if (status === 413) return 'That file is too large to upload.';
    if (status === 502 || status === 503 || status === 504) return 'The server is restarting or unreachable. Please try again in a minute.';
    return `Request failed with status ${status}`;
}

async function request<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    const token = localStorage.getItem('token');

    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> || {}),
    };

    // Don't set Content-Type for FormData (browser sets multipart boundary)
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include',
    });

    // nginx answers some failures with an HTML page (413 file too large, 502 while the API restarts).
    const json = await response.json().catch(() => null) as ApiResponse<T> | null;

    if (!response.ok) {
        // Session expired or account deactivated: let AuthContext send the user back to login.
        if (response.status === 401 && token && !endpoint.startsWith('/auth/login')) {
            localStorage.removeItem('token');
            window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
        throw new Error(json?.error || describeHttpFailure(response.status));
    }
    if (!json) {
        throw new Error('The server sent an unexpected response. Please try again.');
    }

    return json;
}

// ─── Auth ────────────────────────────────────────────────────

export const authApi = {
    login: (username: string, password: string) =>
        request<{ token: string; user: AuthUser }>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        }),

    me: () => request<{ user: AuthUser }>('/auth/me'),

    logout: () => request('/auth/logout', { method: 'POST' }),

    updateCredentials: (data: { username?: string; currentPassword?: string; newPassword?: string }) =>
        request<{ message: string }>('/auth/credentials', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    updateAvatar: (file: File) => {
        console.log('[api/auth.updateAvatar] request:start', {
            endpoint: '/auth/avatar',
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
        });
        const formData = new FormData();
        formData.append('avatar', file);
        return request<{ avatar: string }>('/auth/avatar', {
            method: 'POST',
            body: formData,
        });
    },

    forgotPassword: (username: string) =>
        request<{ message: string }>('/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ username }),
        }),

    resetPassword: (data: { username: string; otp: string; newPassword: string }) =>
        request<{ message: string }>('/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};

// ─── Employees ───────────────────────────────────────────────

export const employeeApi = {
    list: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return request<{ employees: Employee[]; pagination: Pagination }>(`/employees${query}`);
    },

    get: (id: number) => request<{ employee: EmployeeDetail }>(`/employees/${id}`),

    create: (data: EmployeeMutationPayload & { createUser?: boolean; username?: string; password?: string; role?: string }) =>
        request<{ employee: Employee }>('/employees', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    update: (id: number, data: EmployeeMutationPayload & { createUser?: boolean; username?: string; password?: string; role?: string }) =>
        request<{ employee: Employee }>(`/employees/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    updatePayrollDetails: (id: number, data: {
        employeeNumber?: string | null;
        panNumber?: string | null;
        uanNumber?: string | null;
        pfAccountNumber?: string | null;
        esiNumber?: string | null;
        pranNumber?: string | null;
        taxRegime?: string | null;
        bankAccountNumber?: string | null;
        bankIfscCode?: string | null;
        bankBranch?: string | null;
    }) =>
        request<{ employee: Partial<Employee> }>(`/employees/${id}/payroll-details`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    updateProfileDetails: (id: number, data: {
        bio?: string | null;
        skills?: string[];
        education?: string | null;
        experience?: string | null;
        dateOfBirth?: string | null;
    }) => request<{ employee: Partial<EmployeeDetail> }>(`/employees/${id}/profile-details`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),

    updateAvatar: (id: number, file: File) => {
        console.log('[api/employee.updateAvatar] request:start', {
            endpoint: `/employees/${id}/avatar`,
            employeeId: id,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
        });
        const formData = new FormData();
        formData.append('avatar', file);
        return request<{ avatar: string }>(`/employees/${id}/avatar`, {
            method: 'POST',
            body: formData,
        });
    },

    delete: (id: number) =>
        request(`/employees/${id}`, { method: 'DELETE' }),

    birthdaysToday: () =>
        request<{ birthdays: BirthdayPerson[] }>('/employees/birthdays/today'),

    setPayrollAccess: (id: number, enabled: boolean) =>
        request<{ canImportPayroll: boolean }>(`/employees/${id}/payroll-access`, {
            method: 'PUT',
            body: JSON.stringify({ enabled }),
        }),

    deletePermanently: (id: number) =>
        request<{ userAccount: 'none' | 'deleted' | 'deactivated' }>(`/employees/${id}/permanent`, { method: 'DELETE' }),

    team: (id: number) =>
        request<{ team: Employee[]; count: number }>(`/employees/${id}/team`),

    managersList: () =>
        request<{ managers: ManagerOption[] }>('/employees/managers/list'),

    syncMasterData: () =>
        request<{ total: number; created: number; skipped: number }>('/employees/master/sync', {
            method: 'POST',
        }),

    approversList: () =>
        request<{ approvers: { userId: number; employeeId: number; name: string; role: UserRole; position: string | null; department: string | null }[] }>('/employees/approvers/list'),
};

// ─── Leaves ──────────────────────────────────────────────────

export const leaveApi = {
    list: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return request<{ leaves: Leave[] }>(`/leaves${query}`);
    },

    apply: (data: { type: string; startDate: string; endDate: string; days: number; reason?: string; approverIds?: string }) =>
        request<{ leave: Leave }>('/leaves', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    approve: (id: number, reason?: string) =>
        request<{ leave: Leave }>(`/leaves/${id}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ reason }),
        }),

    reject: (id: number, reason?: string) =>
        request<{ leave: Leave }>(`/leaves/${id}/reject`, {
            method: 'PUT',
            body: JSON.stringify({ reason }),
        }),

    cancel: (id: number) =>
        request(`/leaves/${id}`, { method: 'DELETE' }),
};

// ─── Attendance ──────────────────────────────────────────────

export const attendanceApi = {
    get: (employeeId: number, params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return request<{ attendance: Attendance[]; summary: AttendanceSummary }>(
            `/attendance/${employeeId}${query}`
        );
    },

    saveManual: (data: { employeeId: number; date: string; checkIn?: string; checkOut?: string; status?: string }) => {
        return request<{ attendance: Attendance }>('/attendance/manual', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    /** Employee asks to correct their own attendance (one day or a range); applies once HR or a manager approves. */
    requestCorrection: (data: {
        startDate: string;
        endDate?: string;
        status: EmployeeAttendanceStatus;
        checkIn?: string;
        checkOut?: string;
        reason: string;
    }) => request<{ request: AttendanceCorrectionRequest }>('/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify(data),
    }),

    /** `mine`: own requests. `review`: requests this user can approve (pending by default). */
    listCorrections: (scope: 'mine' | 'review', state?: CorrectionRequestState) =>
        request<{ requests: AttendanceCorrectionRequest[] }>(
            `/attendance/corrections?${new URLSearchParams({ scope, ...(state ? { state } : {}) })}`
        ),

    approveCorrection: (id: number, comment?: string) =>
        request<{ request: AttendanceCorrectionRequest; daysUpdated: number }>(`/attendance/corrections/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ comment }),
        }),

    rejectCorrection: (id: number, comment?: string) =>
        request<{ request: AttendanceCorrectionRequest }>(`/attendance/corrections/${id}/reject`, {
            method: 'POST',
            body: JSON.stringify({ comment }),
        }),

    cancelCorrection: (id: number) =>
        request(`/attendance/corrections/${id}/cancel`, { method: 'POST' }),

    uploadBiometric: (file: File, targetMonth?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (targetMonth) {
            formData.append('targetMonth', targetMonth);
        }
        return request<{ totalRecords: number; processedDays: number; inserted: number }>('/attendance/upload/biometric', {
            method: 'POST',
            body: formData,
        });
    },

    uploadExcel: (file: File, targetMonth?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (targetMonth) {
            formData.append('targetMonth', targetMonth);
        }
        return request<{ totalRows: number; inserted: number; skipped: number }>('/attendance/upload/excel', {
            method: 'POST',
            body: formData,
        });
    },

    manualEntry: (data: { employeeId: number; date: string; checkIn?: string; checkOut?: string; status?: string }) =>
        request<{ attendance: Attendance }>('/attendance/manual', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    biometricStatus: () => request<BiometricStatus>('/attendance/biometric/status'),

    reprocessBiometric: () =>
        request<{ linked: number; daysRebuilt: number; stillUnmapped: number }>('/attendance/biometric/reprocess', {
            method: 'POST',
        }),
};

export interface BiometricStatus {
    devices: { id: number; serialNo: string; terminalType: string | null; lastSeenAt: string | null; lastIp: string | null }[];
    punchesLast24h: number;
    totalPunches: number;
    latestPunch: { date: string; time: string } | null;
    unmappedUsers: { biometricUserId: number; punches: number }[];
}

export const notificationApi = {
    list: () => request<{ notifications: AppNotification[]; unreadCount: number }>('/notifications'),
    markRead: (id: number) => request(`/notifications/${id}/read`, { method: 'POST' }),
    markAllRead: () => request('/notifications/read-all', { method: 'POST' }),
};

export const documentApi = {
    listMine: () => request<{ documents: EmployeeDocument[] }>('/documents/mine'),

    listTeam: () => request<{ documents: EmployeeDocumentWithEmployee[] }>('/documents/team'),

    getEmployeeDocuments: (employeeId: number) =>
        request<{
            employee: Pick<Employee, 'id' | 'name' | 'department' | 'position'>;
            documents: EmployeeDocument[];
        }>(`/documents/employees/${employeeId}`),

    upload: (title: string, file: File) => {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('document', file);
        return request<{ document: EmployeeDocument }>('/documents', {
            method: 'POST',
            body: formData,
        });
    },

    update: (id: number, data: { title?: string; file?: File }) => {
        const formData = new FormData();
        if (data.title !== undefined) formData.append('title', data.title);
        if (data.file) formData.append('document', data.file);
        return request<{ document: EmployeeDocument }>(`/documents/${id}`, {
            method: 'PUT',
            body: formData,
        });
    },

    delete: (id: number) => request(`/documents/${id}`, { method: 'DELETE' }),

    download: (id: number) =>
        request<{ document: EmployeeDocumentDownloadPayload }>(`/documents/${id}/download`),

    downloadAll: (employeeId: number) =>
        request<{ documents: EmployeeDocumentDownloadPayload[] }>(`/documents/employees/${employeeId}/download-all`),
};

export const libraryApi = {
    list: () => request<{ documents: LibraryDocument[] }>('/library/documents'),

    upload: (title: string, description: string, file: File) => {
        const formData = new FormData();
        formData.append('title', title);
        if (description) formData.append('description', description);
        formData.append('document', file);
        return request<{ document: LibraryDocument }>('/library/documents', {
            method: 'POST',
            body: formData,
        });
    },

    remove: (id: number) => request(`/library/documents/${id}`, { method: 'DELETE' }),

    markRead: (id: number) => request(`/library/documents/${id}/read`, { method: 'POST' }),

    download: (id: number) =>
        request<{ fileName: string; mimeType: string; contentUrl: string }>(`/library/documents/${id}/download`),
};

// ─── Salary ──────────────────────────────────────────────────

export const salaryApi = {
    // Self-only endpoints (authenticated user's own salary)
    getMyBreakdown: () =>
        request<{ breakdowns: SalaryBreakdown[]; totals: SalaryTotals | null }>('/salary/my/breakdown'),

    getMySlips: () =>
        request<{ slips: SalarySlip[] }>('/salary/my/slips'),

    getMySlip: (month: string) =>
        request<{ slip: SalarySlip }>(`/salary/my/slips/${month}`),

    // Admin/manual endpoints (HR or system)
    getBreakdown: (employeeId: number) =>
        request<{ breakdowns: SalaryBreakdown[]; totals: SalaryTotals | null }>(`/salary/breakdown/${employeeId}`),

    createBreakdown: (data: Partial<SalaryBreakdown> & { employeeId: number; effectiveFrom: string }) =>
        request<{ breakdown: SalaryBreakdown }>('/salary/breakdown', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getSlips: (employeeId: number) =>
        request<{ slips: SalarySlip[] }>(`/salary/slips/${employeeId}`),

    generateSlip: (data: { employeeId: number; month: string; workingDays: number; daysPresent: number }) =>
        request<{ slip: SalarySlip }>('/salary/slips/generate', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Payroll import (HR-only): preview a Tally XLSX/JSON/XML export, then commit it
    previewImport: (file: File, month: string) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('month', month);
        return request<{ rows: PayrollImportRow[]; summary: PayrollImportSummary; detectedMonth: string | null; monthMismatch: boolean }>('/salary/import/preview', {
            method: 'POST',
            body: formData,
        });
    },

    commitImport: (file: File, month: string, overwrite = false, acknowledgeMonthMismatch = false) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('month', month);
        formData.append('overwrite', String(overwrite));
        formData.append('acknowledgeMonthMismatch', String(acknowledgeMonthMismatch));
        return request<{ imported: number; skipped: string[] }>('/salary/import/commit', {
            method: 'POST',
            body: formData,
        });
    },

    getImportHistory: () =>
        request<{ logs: PayrollImportLog[] }>('/salary/import/history'),
};

// ─── Announcements ───────────────────────────────────────────

export const announcementApi = {
    list: () => request<{ announcements: Announcement[]; unreadCount: number }>('/announcements'),

    create: (data: FormData) =>
        request<{ announcement: Announcement }>('/announcements', {
            method: 'POST',
            body: data,
        }),

    update: (id: number, data: Partial<Announcement>) =>
        request<{ announcement: Announcement }>(`/announcements/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    delete: (id: number) =>
        request(`/announcements/${id}`, { method: 'DELETE' }),

    markRead: (id: number) =>
        request(`/announcements/${id}/read`, { method: 'POST' }),

    markAllRead: () =>
        request('/announcements/read-all', { method: 'POST' }),
};

// ─── Hero Banners ────────────────────────────────────────────

export const heroBannerApi = {
    list: () => request<{ banners: HeroBanner[] }>('/hero-banners'),

    create: (data: FormData) =>
        request<{ banner: HeroBanner }>('/hero-banners', {
            method: 'POST',
            body: data,
        }),

    update: (id: number, data: Partial<HeroBanner>) =>
        request<{ banner: HeroBanner }>(`/hero-banners/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    delete: (id: number) =>
        request(`/hero-banners/${id}`, { method: 'DELETE' }),
};

// ─── Performance (KRA / KPI) ─────────────────────────────────

export const performanceApi = {
    get: (employeeId: number) =>
        request<{ kras: import('../types').Kra[]; summary: import('../types').PerformanceSummary }>(`/performance/${employeeId}`),

    createKra: (data: { employeeId: number; title: string; description?: string; period?: string }) =>
        request<{ kra: import('../types').Kra }>('/performance/kra', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateKra: (id: number, data: { title?: string; description?: string; period?: string }) =>
        request<{ kra: import('../types').Kra }>(`/performance/kra/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    deleteKra: (id: number) =>
        request(`/performance/kra/${id}`, { method: 'DELETE' }),

    createKpi: (data: { kraId: number; metric: string; target: number; actual?: number | null; unit?: string | null }) =>
        request<{ kpi: import('../types').Kpi }>('/performance/kpi', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateKpi: (id: number, data: { metric?: string; target?: number; actual?: number | null; unit?: string | null }) =>
        request<{ kpi: import('../types').Kpi }>(`/performance/kpi/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    deleteKpi: (id: number) =>
        request(`/performance/kpi/${id}`, { method: 'DELETE' }),
};

// ─── Learning & Development ─────────────────────────────────

export const learningApi = {
    listCourses: () => request<{ courses: Course[] }>('/learning/courses'),

    getCourse: (id: number) => request<{ course: CourseDetail }>(`/learning/courses/${id}`),

    createCourse: (data: FormData) =>
        request<{ course: Course }>('/learning/courses', {
            method: 'POST',
            body: data,
        }),

    updateCourse: (id: number, data: Partial<Course>) =>
        request<{ course: Course }>(`/learning/courses/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    updateCourseThumbnail: (id: number, data: FormData) =>
        request<{ course: Course }>(`/learning/courses/${id}/thumbnail`, {
            method: 'POST',
            body: data,
        }),

    publishCourse: (id: number) =>
        request<{ course: Course }>(`/learning/courses/${id}/publish`, { method: 'POST' }),

    unpublishCourse: (id: number) =>
        request<{ course: Course }>(`/learning/courses/${id}/unpublish`, { method: 'POST' }),

    archiveCourse: (id: number) =>
        request(`/learning/courses/${id}`, { method: 'DELETE' }),

    addModule: (courseId: number, data: FormData) =>
        request<{ module: CourseModule }>(`/learning/courses/${courseId}/modules`, {
            method: 'POST',
            body: data,
        }),

    deleteModule: (moduleId: number, force = false) =>
        request(`/learning/modules/${moduleId}${force ? '?force=true' : ''}`, { method: 'DELETE' }),

    enroll: (courseId: number) =>
        request<{ enrollment: Enrollment }>(`/learning/courses/${courseId}/enroll`, { method: 'POST' }),

    assignCourse: (courseId: number, data: { employeeIds: number[]; dueDate?: string }) =>
        request<{ assignedCount: number; alreadyEnrolledCount: number }>(`/learning/courses/${courseId}/assign`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getMyEnrollments: () => request<{ enrollments: Enrollment[] }>('/learning/my/enrollments'),

    getTeamEnrollments: () => request<{ enrollments: TeamEnrollment[] }>('/learning/team/enrollments'),

    getDepartmentSummary: () => request<{ departments: DepartmentLearningSummary[] }>('/learning/admin/department-summary'),

    getDepartmentTeams: (department: string) =>
        request<{ teams: TeamLearningSummary[] }>(`/learning/admin/departments/${encodeURIComponent(department)}/teams`),

    getTeamMembers: (managerId: number | 'none', department: string) =>
        request<{ members: MemberLearningSummary[] }>(`/learning/admin/teams/${managerId}/members?department=${encodeURIComponent(department)}`),

    nudgeEnrollment: (enrollmentId: number) =>
        request<undefined>(`/learning/enrollments/${enrollmentId}/nudge`, { method: 'POST' }),

    renewEnrollment: (enrollmentId: number) =>
        request<undefined>(`/learning/enrollments/${enrollmentId}/renew`, { method: 'POST' }),

    getLeaderboard: (courseId: number) =>
        request<LeaderboardResponse>(`/learning/courses/${courseId}/leaderboard`),

    nominateForCourse: (courseId: number, employeeId: number) =>
        request<{ enrollment: Enrollment }>(`/learning/courses/${courseId}/nominate`, {
            method: 'POST',
            body: JSON.stringify({ employeeId }),
        }),

    acceptCourseNomination: (enrollmentId: number) =>
        request<{ enrollment: Enrollment }>(`/learning/enrollments/${enrollmentId}/accept`, { method: 'POST' }),

    declineCourseNomination: (enrollmentId: number) =>
        request<{ enrollment: Enrollment }>(`/learning/enrollments/${enrollmentId}/decline`, { method: 'POST' }),

    approveCourseEnrollment: (enrollmentId: number) =>
        request<{ enrollment: Enrollment }>(`/learning/enrollments/${enrollmentId}/approve`, { method: 'POST' }),

    rejectCourseEnrollment: (enrollmentId: number) =>
        request<{ enrollment: Enrollment }>(`/learning/enrollments/${enrollmentId}/reject`, { method: 'POST' }),

    nominateForPath: (pathId: number, employeeId: number) =>
        request<{ pathEnrollment: PathEnrollment }>(`/learning/paths/${pathId}/nominate`, {
            method: 'POST',
            body: JSON.stringify({ employeeId }),
        }),

    acceptPathNomination: (pathEnrollmentId: number) =>
        request<{ pathEnrollment: PathEnrollment }>(`/learning/path-enrollments/${pathEnrollmentId}/accept`, { method: 'POST' }),

    declinePathNomination: (pathEnrollmentId: number) =>
        request<{ pathEnrollment: PathEnrollment }>(`/learning/path-enrollments/${pathEnrollmentId}/decline`, { method: 'POST' }),

    approvePathEnrollment: (pathEnrollmentId: number) =>
        request<{ pathEnrollment: PathEnrollment }>(`/learning/path-enrollments/${pathEnrollmentId}/approve`, { method: 'POST' }),

    rejectPathEnrollment: (pathEnrollmentId: number) =>
        request<{ pathEnrollment: PathEnrollment }>(`/learning/path-enrollments/${pathEnrollmentId}/reject`, { method: 'POST' }),

    // ─── Learning Paths ────────────────────────────────────────

    listPaths: () => request<{ paths: LearningPath[] }>('/learning/paths'),

    getPath: (id: number) => request<{ path: LearningPath }>(`/learning/paths/${id}`),

    createPath: (data: FormData) =>
        request<{ path: LearningPath }>('/learning/paths', { method: 'POST', body: data }),

    updatePath: (id: number, data: Partial<LearningPath>) =>
        request<{ path: LearningPath }>(`/learning/paths/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

    deletePath: (id: number) => request(`/learning/paths/${id}`, { method: 'DELETE' }),

    publishPath: (id: number) =>
        request<{ path: LearningPath }>(`/learning/paths/${id}/publish`, { method: 'POST' }),

    unpublishPath: (id: number) =>
        request<{ path: LearningPath }>(`/learning/paths/${id}/unpublish`, { method: 'POST' }),

    addCourseToPath: (pathId: number, courseId: number, sortOrder?: number) =>
        request<{ pathCourse: LearningPathCourse }>(`/learning/paths/${pathId}/courses`, {
            method: 'POST',
            body: JSON.stringify({ courseId, sortOrder }),
        }),

    removeCourseFromPath: (pathId: number, courseId: number) =>
        request(`/learning/paths/${pathId}/courses/${courseId}`, { method: 'DELETE' }),

    enrollPath: (pathId: number) =>
        request<{ pathEnrollment: PathEnrollment }>(`/learning/paths/${pathId}/enroll`, { method: 'POST' }),

    assignPath: (pathId: number, data: { employeeIds: number[]; dueDate?: string }) =>
        request<{ assignedCount: number; alreadyEnrolledCount: number }>(`/learning/paths/${pathId}/assign`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getMyPathEnrollments: () => request<{ pathEnrollments: PathEnrollmentDetail[] }>('/learning/my/path-enrollments'),

    getEmployeeLearningSummary: (employeeId: number) =>
        request<{ summary: EmployeeLearningSummary }>(`/learning/employees/${employeeId}/summary`),

    getEnrollment: (id: number) => request<{ enrollment: EnrollmentDetail }>(`/learning/enrollments/${id}`),

    postProgress: (enrollmentId: number, data: {
        moduleId: number;
        lastPositionSeconds?: number;
        lastPageViewed?: number;
        timeSpentDeltaSeconds?: number;
        markComplete?: boolean;
    }) =>
        request<{ moduleProgress: ModuleProgress }>(`/learning/enrollments/${enrollmentId}/progress`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    saveQuiz: (moduleId: number, data: {
        passPercentage: number;
        maxAttempts: number;
        timeLimitMinutes?: number;
        randomizeOrder?: boolean;
        questions: { questionText: string; options: { optionText: string; isCorrect: boolean }[] }[];
        gradeBands?: { label: string; minScore: number }[];
    }, force = false) =>
        request<{ quiz: CourseQuiz }>(`/learning/modules/${moduleId}/quiz${force ? '?force=true' : ''}`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    submitQuizAttempt: (quizId: number, data: {
        answers: { questionId: number; selectedOptionIds: number[] }[];
        startedAt: string;
        isAutoSubmit?: boolean;
    }) =>
        request<{ attempt: QuizAttemptResult }>(`/learning/quizzes/${quizId}/attempt`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    downloadCertificate: (certificateNumber: string) =>
        request<{ certificateNumber: string; pdfBase64: string }>(`/learning/certificates/${certificateNumber}/download`),
};

// ─── Instructor-Led Training (ILT) ────────────────────────────

export const iltApi = {
    listSessions: () => request<{ sessions: ILTSession[] }>('/ilt/sessions'),

    getSession: (id: number) => request<{ session: ILTSessionDetail }>(`/ilt/sessions/${id}`),

    createSession: (data: {
        title: string;
        description?: string;
        courseId?: number;
        instructorName: string;
        location: string;
        startsAt: string;
        endsAt: string;
        capacity: number;
        targetDepartment?: string;
    }) =>
        request<{ session: ILTSession }>('/ilt/sessions', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateSession: (id: number, data: Partial<ILTSession>) =>
        request<{ session: ILTSession }>(`/ilt/sessions/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    publishSession: (id: number) =>
        request<{ session: ILTSession }>(`/ilt/sessions/${id}/publish`, { method: 'POST' }),

    cancelSession: (id: number) =>
        request<undefined>(`/ilt/sessions/${id}/cancel`, { method: 'POST' }),

    deleteSession: (id: number) => request(`/ilt/sessions/${id}`, { method: 'DELETE' }),

    register: (sessionId: number) =>
        request<{ registration: ILTRegistration }>(`/ilt/sessions/${sessionId}/register`, { method: 'POST' }),

    cancelRegistration: (registrationId: number) =>
        request<undefined>(`/ilt/registrations/${registrationId}/cancel`, { method: 'POST' }),

    markAttendance: (sessionId: number, records: { registrationId: number; attended: boolean }[]) =>
        request<undefined>(`/ilt/sessions/${sessionId}/attendance`, {
            method: 'POST',
            body: JSON.stringify({ records }),
        }),

    getMyRegistrations: () => request<{ registrations: ILTRegistrationDetail[] }>('/ilt/my/registrations'),

    getTeamRegistrations: () => request<{ registrations: ILTTeamRegistration[] }>('/ilt/team/registrations'),
};

// ─── Badges ────────────────────────────────────────────────────

export const badgeApi = {
    listBadges: () => request<{ badges: Badge[] }>('/badges'),

    createBadge: (data: {
        name: string;
        description?: string;
        iconKey?: string;
        criteriaType: BadgeCriteriaType;
        criteriaValue?: number;
        criteriaLabel?: string;
    }) =>
        request<{ badge: Badge }>('/badges', { method: 'POST', body: JSON.stringify(data) }),

    deleteBadge: (id: number) => request(`/badges/${id}`, { method: 'DELETE' }),

    getEmployeeBadges: (employeeId: number) =>
        request<{ earned: EmployeeBadge[] }>(`/badges/employees/${employeeId}`),
};

// ─── Types ───────────────────────────────────────────────────

export type UserRole = 'EMPLOYEE' | 'MANAGER' | 'HR' | 'LEADERSHIP';

export interface AuthUser {
    id: number;
    username: string;
    role: UserRole;
    employeeId: number | null;
    employee: {
        id: number;
        name: string;
        position: string | null;
        department: string | null;
        email: string | null;
        avatar: string | null;
        gender: string | null;
    } | null;
    /** HR, or Accounts staff HR has granted payroll-upload access to. */
    canImportPayroll?: boolean;
}

export interface Employee {
    id: number;
    biometricId: number | null;
    name: string;
    position: string | null;
    department: string | null;
    email: string | null;
    phone: string | null;
    joinDate: string | null;
    dateOfBirth?: string | null;
    managerId: number | null;
    avatar: string | null;
    gender: string | null;
    employeeType: string | null;
    tallyLedgerName: string | null;
    employeeNumber: string | null;
    panNumber: string | null;
    uanNumber: string | null;
    pfAccountNumber: string | null;
    esiNumber: string | null;
    pranNumber: string | null;
    taxRegime: string | null;
    bankAccountNumber: string | null;
    bankIfscCode: string | null;
    bankBranch: string | null;
    manager?: { id: number; name: string } | null;
    /** Login account summary — present in the employee list response. */
    user?: { role: UserRole; isActive?: boolean } | null;
}

export interface EmployeeDetail extends Employee {
    bio: string | null;
    skills: string[] | null;
    experience: string | null;
    education: string | null;
    isActive: boolean;
    directReports: Employee[];
    managers?: Array<{ manager: { id: number; name: string; position: string | null; department: string | null } }>;
    user: { id: number; username: string; role: UserRole; canImportPayroll?: boolean } | null;
    gender: string | null;
    tallyLedgerName: string | null;
}

export interface EmployeeMutationPayload {
    biometricId?: number | null;
    name?: string;
    position?: string | null;
    department?: string | null;
    email?: string | null;
    phone?: string | null;
    joinDate?: string | null;
    dateOfBirth?: string | null;
    managerId?: number | null;
    managerIds?: number[];
    avatar?: string | null;
    gender?: string | null;
    bio?: string | null;
    skills?: string[];
    experience?: string | null;
    education?: string | null;
    employeeType?: string | null;
    tallyLedgerName?: string | null;
    employeeNumber?: string | null;
    panNumber?: string | null;
    uanNumber?: string | null;
    pfAccountNumber?: string | null;
    esiNumber?: string | null;
    pranNumber?: string | null;
    taxRegime?: string | null;
    bankAccountNumber?: string | null;
    bankIfscCode?: string | null;
    bankBranch?: string | null;
}

export interface ManagerOption {
    userId: number;
    employeeId: number;
    name: string;
    position: string | null;
    department: string | null;
    role: Extract<UserRole, 'MANAGER' | 'LEADERSHIP'>;
}

export interface Leave {
    id: number;
    employeeId: number;
    type: string;
    startDate: string;
    endDate: string;
    days: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reason: string | null;
    createdAt: string;
    employee?: {
        id: number;
        name: string;
        department: string | null;
        manager?: { id: number; name: string; department: string | null; position: string | null } | null;
    };
    approvedBy?: { id: number; username: string } | null;
    approverIds?: string | null;
    comment?: string | null;
}

export type CorrectionRequestState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface AttendanceCorrectionRequest {
    id: number;
    employeeId: number;
    startDate: string;
    endDate: string;
    status: EmployeeAttendanceStatus;
    checkIn: string | null;
    checkOut: string | null;
    reason: string;
    state: CorrectionRequestState;
    reviewComment: string | null;
    reviewedAt: string | null;
    createdAt: string;
    employee: { id: number; name: string; department: string | null; position: string | null };
    reviewedBy: { username: string; employee: { name: string } | null } | null;
}

export type EmployeeAttendanceStatus =
    | 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY'
    | 'WFH' | 'ON_DUTY' | 'CLIENT_VISIT' | 'BUSINESS_TRAVEL';

export interface Attendance {
    id: number;
    employeeId: number;
    date: string;
    day: string | null;
    checkIn: string | null;
    checkOut: string | null;
    totalWorkingHours: string | null;
    isLate: boolean;
    lateBy: string | null;
    overtime: boolean;
    otTime: string | null;
    status: EmployeeAttendanceStatus;
    isGraceLate?: boolean;
    isVirtual?: boolean;
    holidayName?: string;
    leaveType?: string;
}

export interface AppNotification {
    id: number;
    type: string;
    title: string;
    message: string;
    entityId: number | null;
    employeeId: number | null;
    readAt: string | null;
    createdAt: string;
}

export interface EmployeeDocument {
    id: number;
    employeeId: number;
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
    _count?: { downloads: number };
}

export interface EmployeeDocumentWithEmployee extends EmployeeDocument {
    employee: Pick<Employee, 'id' | 'name' | 'department' | 'position' | 'avatar' | 'gender'>;
}

export interface LibraryDocument {
    id: number;
    title: string;
    description: string | null;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    uploadedBy?: { username: string };
    uploadedById?: number;
    isRead: boolean;
    readCount: number;
}

export interface EmployeeDocumentDownloadPayload {
    id: number;
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
}

export interface AttendanceSummary {
    total: number;
    present: number;
    absent: number;
    halfDay: number;
    onLeave: number;
    holiday: number;
    lateDays: number;
    overtimeDays: number;
    graceLateDays: number;
    avgLateMinutes: number;
}

export interface SalaryBreakdown {
    id: number;
    employeeId: number;
    basicSalary: number;
    hra: number;
    da: number;
    ta: number;
    medicalAllowance: number;
    specialAllowance: number;
    pf: number;
    esi: number;
    tax: number;
    otherDeductions: number;
    effectiveFrom: string;
}

export interface SalaryTotals {
    grossSalary: number;
    totalDeductions: number;
    netSalary: number;
}

export interface SalaryLineItem {
    label: string;
    amount: number;
}

export interface SalarySlipBreakdown {
    earnings: SalaryLineItem[];
    deductions: SalaryLineItem[];
}

export interface SalarySlip {
    id: number;
    employeeId: number;
    month: string;
    grossSalary: number;
    totalDeductions: number;
    netSalary: number;
    workingDays: number;
    daysPresent: number;
    breakdownJson: SalarySlipBreakdown | Record<string, number> | null;
    generatedAt: string;
}

export interface PayrollImportRow {
    ledgerName: string;
    employeeId: number | null;
    employeeName: string | null;
    matched: boolean;
    grossSalary: number;
    totalDeductions: number;
    netSalary: number;
    unmappedLedgers: string[];
}

export interface PayrollImportSummary {
    total: number;
    matched: number;
    unmatched: number;
    alreadyImported: number;
}

export interface PayrollImportLog {
    id: number;
    month: string;
    fileName: string;
    totalRecords: number;
    importedCount: number;
    skippedLedgers: string | null;
    createdAt: string;
    importedBy?: { username: string };
}

export type AnnouncementMediaType = 'IMAGE' | 'VIDEO_FILE' | 'VIDEO_EMBED' | 'SOCIAL_EMBED' | 'LINK';

export interface AnnouncementMedia {
    id: number;
    type: AnnouncementMediaType;
    url: string;
    caption: string | null;
    isDownloadable: boolean;
    sortOrder: number;
}

export interface Announcement {
    id: number;
    title: string;
    content: string | null;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    attachmentUrl: string | null;
    isPinned: boolean;
    isRead: boolean;
    isActive: boolean;
    targetDepartment: string | null;
    createdAt: string;
    expiresAt: string | null;
    scheduledAt: string | null;
    publishedAt: string | null;
    sendEmail: boolean;
    emailSentAt: string | null;
    emailError: string | null;
    createdBy?: { username: string };
    media: AnnouncementMedia[];
}

export type HeroMediaType = 'IMAGE' | 'GIF' | 'VIDEO_FILE' | 'VIDEO_EMBED';

export interface HeroBanner {
    id: number;
    title: string | null;
    subtitle: string | null;
    mediaType: HeroMediaType;
    mediaUrl: string;
    linkUrl: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    createdBy?: { username: string };
}

export interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ─── Learning & Development ─────────────────────────────────

export type CourseState = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED';
export type CourseNavigationMode = 'FREE' | 'SEQUENTIAL';
export type ModuleContentType = 'VIDEO_FILE' | 'VIDEO_EMBED' | 'DOCUMENT' | 'QUIZ';
export type EnrollmentStatus = 'NOMINATED' | 'PENDING_APPROVAL' | 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'REJECTED';
export type ModuleProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type RankingScope = 'DEPARTMENT' | 'ORG_WIDE';

export interface Course {
    id: number;
    title: string;
    description: string | null;
    category: string | null;
    skillTags: string | null;
    durationMinutes: number | null;
    language: string | null;
    thumbnailUrl: string | null;
    mandatory: boolean;
    targetDepartment: string | null;
    autoAssign: boolean;
    autoAssignDueDays: number | null;
    certificateValidityMonths: number | null;
    enableRanking: boolean;
    rankingScope: RankingScope;
    rankingAnonymous: boolean;
    rankingMinCohortSize: number;
    requiresApproval: boolean;
    certificatesPerModule: boolean;
    navigationMode: CourseNavigationMode;
    state: CourseState;
    createdAt: string;
    updatedAt: string;
    createdBy?: { username: string };
    modules?: { id: number }[];
    _count?: { enrollments: number };
}

export interface QuizOption {
    id: number;
    optionText: string;
    isCorrect?: boolean;
}

export interface QuizQuestion {
    id: number;
    questionText: string;
    sortOrder: number;
    options: QuizOption[];
}

export interface GradeBand {
    id: number;
    quizId: number;
    label: string;
    minScore: number;
}

export interface CourseQuiz {
    id: number;
    moduleId: number;
    passPercentage: number;
    maxAttempts: number;
    timeLimitMinutes: number | null;
    randomizeOrder: boolean;
    questions: QuizQuestion[];
    gradeBands?: GradeBand[];
}

export interface QuizAttemptResult {
    id: number;
    quizId: number;
    employeeId: number;
    attemptNumber: number;
    score: number;
    passed: boolean;
    gradeLabel: string | null;
    totalQuestions: number;
    correctCount: number;
}

export interface CourseModule {
    id: number;
    courseId: number;
    title: string;
    sortOrder: number;
    contentType: ModuleContentType;
    contentUrl: string | null;
    durationMinutes: number | null;
    quiz?: CourseQuiz | null;
}

export interface CourseDetail extends Course {
    modules: CourseModule[];
}

export interface ModuleProgress {
    id: number;
    moduleId: number;
    status: ModuleProgressStatus;
    lastPositionSeconds: number | null;
    lastPageViewed: number | null;
    timeSpentSeconds: number;
    completedAt: string | null;
}

export interface Enrollment {
    id: number;
    courseId: number;
    employeeId: number;
    status: EnrollmentStatus;
    assignedById: number | null;
    dueDate: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    course?: Course & { modules?: { id: number }[] };
    moduleProgress?: ModuleProgress[];
    certificate?: { certificateNumber: string; expiresAt: string | null } | null;
}

export interface EnrollmentCertificate {
    certificateNumber: string;
    expiresAt: string | null;
    moduleId: number | null;
}

export interface EnrollmentDetail extends Omit<Enrollment, 'certificate'> {
    course: CourseDetail;
    moduleProgress: ModuleProgress[];
    /** Both the whole-course certificate (moduleId: null) and any per-module certificates. */
    certificates: EnrollmentCertificate[];
}

export interface LeaderboardEntry {
    employeeId: number;
    name: string;
    avgScore: number;
    totalTimeSeconds: number;
    rank: number;
}

export type LeaderboardResponse =
    | { suppressed: true; cohortSize: number; minCohortSize: number; myScore: number | null }
    | { suppressed: false; anonymous: false; entries: LeaderboardEntry[]; cohortSize: number }
    | { suppressed: false; anonymous: true; cohortSize: number; myRank: number | null; myScore: number | null; myPercentile: number | null };

export interface LearningPathCourse {
    id: number;
    pathId: number;
    courseId: number;
    sortOrder: number;
    course: { id: number; title: string; durationMinutes: number | null; state?: CourseState };
    enrollmentStatus?: EnrollmentStatus;
}

export interface LearningPath {
    id: number;
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    mandatory: boolean;
    targetDepartment: string | null;
    navigationMode: CourseNavigationMode;
    requiresApproval: boolean;
    state: CourseState;
    createdAt: string;
    updatedAt: string;
    createdBy?: { username: string };
    courses: LearningPathCourse[];
}

export interface PathEnrollment {
    id: number;
    pathId: number;
    employeeId: number;
    status: EnrollmentStatus;
    assignedById: number | null;
    dueDate: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
}

export interface PathEnrollmentDetail extends PathEnrollment {
    path: LearningPath;
}

export interface TeamEnrollment {
    id: number;
    status: EnrollmentStatus;
    dueDate: string | null;
    createdAt: string;
    completedAt: string | null;
    course: { id: number; title: string; mandatory: boolean; durationMinutes: number | null };
    employee: { id: number; name: string; department: string | null; position: string | null; avatar: string | null; gender: string | null };
    moduleProgress: { status: string }[];
    certificate: { certificateNumber: string; expiresAt: string | null } | null;
}

export type ILTSessionState = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
export type ILTRegistrationStatus = 'REGISTERED' | 'WAITLISTED' | 'CANCELLED' | 'ATTENDED' | 'NO_SHOW';

export interface ILTSession {
    id: number;
    title: string;
    description: string | null;
    courseId: number | null;
    instructorName: string;
    location: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    targetDepartment: string | null;
    state: ILTSessionState;
    createdAt: string;
    updatedAt: string;
    createdBy?: { username: string };
    course?: { id: number; title: string } | null;
    _count?: { registrations: number };
}

export interface ILTRegistration {
    id: number;
    sessionId: number;
    employeeId: number;
    status: ILTRegistrationStatus;
    registeredAt: string;
}

export interface ILTSessionDetail extends ILTSession {
    registrations: (ILTRegistration & {
        employee: { id: number; name: string; department: string | null; avatar: string | null; gender: string | null };
    })[];
}

export interface ILTRegistrationDetail extends ILTRegistration {
    session: ILTSession & { course: { id: number; title: string } | null };
}

export interface ILTTeamRegistration extends ILTRegistration {
    session: { id: number; title: string; startsAt: string; endsAt: string; location: string };
    employee: { id: number; name: string; department: string | null; avatar: string | null; gender: string | null };
}

export type BadgeCriteriaType = 'QUIZ_GRADE' | 'PERFECT_SCORE' | 'COURSE_COMPLETION_COUNT' | 'PATH_COMPLETION_COUNT' | 'MODULE_COMPLETION_COUNT';

export interface Badge {
    id: number;
    name: string;
    description: string | null;
    iconKey: string;
    criteriaType: BadgeCriteriaType;
    criteriaValue: number | null;
    criteriaLabel: string | null;
    createdAt: string;
    createdBy?: { username: string };
}

export interface EmployeeBadge {
    id: number;
    employeeId: number;
    badgeId: number;
    earnedAt: string;
    sourceQuizAttemptId: number | null;
    badge: Badge;
}

export interface EmployeeLearningSummary {
    courses: { total: number; completed: number; inProgress: number; mandatoryTotal: number; mandatoryCompleted: number };
    paths: { total: number; completed: number; inProgress: number };
    ilt: { attended: number; noShow: number; upcoming: number };
    certificatesEarned: number;
}

export interface DepartmentLearningSummary {
    department: string;
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
    completionRate: number;
}

export interface TeamLearningSummary {
    managerId: number | null;
    managerName: string;
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
    completionRate: number;
}

export interface MemberLearningSummary {
    employeeId: number;
    name: string;
    position: string | null;
    avatar: string | null;
    gender: string | null;
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
    completionRate: number;
}

export interface BirthdayPerson {
    id: number;
    name: string;
    department: string | null;
    position: string | null;
    avatar: string | null;
    gender: string | null;
}

// ─── Home dashboard ──────────────────────────────────────────

export interface DashboardPerson {
    id: number;
    name: string;
    department: string | null;
    avatar: string | null;
    gender: string | null;
}

export interface AttendanceSnapshot {
    /** The day these numbers are for — the latest day with uploaded attendance. */
    date: string;
    isToday: boolean;
    headcount: number;
    present: number;
    late: number;
    onLeave: number;
    notMarked: number;
}

export interface DashboardSummary {
    today: string;
    me: {
        attendanceToday: { status: string; checkIn: string | null; checkOut: string | null; isLate: boolean } | null;
        month: { present: number; late: number; onLeave: number };
        leaves: {
            pending: number;
            takenThisYear: number;
            upcoming: { type: string; startDate: string; endDate: string; days: number } | null;
        };
        learning: {
            active: number;
            overdue: number;
            completed: number;
            nextDue: { courseId: number; title: string; dueDate: string } | null;
        };
        latestSlipMonth: string | null;
    } | null;
    holidays: { id: number; name: string; date: string }[];
    approvals: {
        count: number;
        items: { id: number; type: string; startDate: string; endDate: string; days: number; employee: DashboardPerson }[];
    };
    onLeaveToday: { id: number; type: string; endDate: string; employee: DashboardPerson }[];
    team: { size: number; attendance: AttendanceSnapshot | null; learningOverdue: number } | null;
    org: {
        headcount: number;
        newJoinersThisMonth: number;
        departments: { name: string; count: number }[];
        attendance: AttendanceSnapshot | null;
        learning: { active: number; overdue: number; completionRate: number | null };
        payroll: { month: string; importedCount: number; createdAt: string } | null;
        incompleteProfiles: number;
    } | null;
}

export const dashboardApi = {
    summary: () => request<DashboardSummary>('/dashboard/summary'),
};

// ─── Holidays ────────────────────────────────────────────────

export interface Holiday {
    id: number;
    name: string;
    /** ISO date (midnight UTC) */
    date: string;
}

export const holidayApi = {
    list: (year?: number) => request<Holiday[]>(`/holidays${year ? `?year=${year}` : ''}`),
    create: (data: { name: string; date: string }) =>
        request<Holiday>('/holidays', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name: string; date: string }) =>
        request<Holiday>(`/holidays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request(`/holidays/${id}`, { method: 'DELETE' }),
    bulkCreate: (holidays: { name: string; date: string }[]) =>
        request<{ created: number; skipped: number }>('/holidays/bulk', { method: 'POST', body: JSON.stringify({ holidays }) }),
};
