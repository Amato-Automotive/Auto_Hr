import prisma from '../config/db.js';

export type NotificationType =
    | 'ATTENDANCE_CORRECTION'
    | 'ATTENDANCE_CORRECTION_REQUESTED'
    | 'ATTENDANCE_CORRECTION_APPROVED'
    | 'ATTENDANCE_CORRECTION_REJECTED'
    | 'LEAVE_APPLIED'
    | 'LEAVE_APPROVED'
    | 'LEAVE_REJECTED'
    | 'SALARY_SLIP_READY'
    | 'ANNOUNCEMENT_PUBLISHED'
    | 'COURSE_ASSIGNED'
    | 'COURSE_DUE_REMINDER'
    | 'COURSE_OVERDUE'
    | 'COURSE_NUDGE'
    | 'COURSE_CERTIFICATE_EXPIRING'
    | 'PATH_ASSIGNED'
    | 'COURSE_NOMINATED'
    | 'COURSE_APPROVAL_REQUESTED'
    | 'COURSE_APPROVAL_DECIDED'
    | 'ILT_SESSION_CANCELLED'
    | 'ILT_WAITLIST_PROMOTED'
    | 'BADGE_EARNED'
    | 'DOCUMENT_DOWNLOADED'
    | 'COURSE_PUBLISHED'
    | 'COURSE_COMPLETED'
    | 'QUIZ_AUTO_SUBMITTED'
    | 'LIBRARY_DOCUMENT_ADDED'
    | 'CERTIFICATE_ISSUED'
    | 'COURSE_CONTENT_UPDATED'
    | 'PAYROLL_DETAILS_CHANGED';

/** Learning notification types that count toward a learner's once-a-day nudge cap. */
const LEARNING_NUDGE_TYPES: NotificationType[] = ['COURSE_DUE_REMINDER', 'COURSE_OVERDUE', 'COURSE_NUDGE'];

interface NotifyInput {
    recipientIds: Iterable<number>;
    type: NotificationType;
    title: string;
    message: string;
    entityId?: number;
    employeeId?: number;
    excludeUserId?: number;
}

/** Creates one notification row per recipient. Silently no-ops when there are no recipients. */
export async function notify({ recipientIds, type, title, message, entityId, employeeId, excludeUserId }: NotifyInput): Promise<void> {
    const ids = new Set(recipientIds);
    if (excludeUserId) ids.delete(excludeUserId);
    if (ids.size === 0) return;

    await prisma.notification.createMany({
        data: [...ids].map(recipientId => ({
            recipientId,
            type,
            title,
            message,
            entityId: entityId ?? null,
            employeeId: employeeId ?? null,
        })),
    });
}

/** Active HR user ids — HR sees everything regardless of hierarchy. */
export async function getHrUserIds(): Promise<number[]> {
    const hrUsers = await prisma.user.findMany({ where: { role: 'HR', isActive: true }, select: { id: true } });
    return hrUsers.map(u => u.id);
}

/**
 * Resolves the user ids that should hear about something happening to `employeeId`:
 * their direct + secondary managers, plus all HR users. Used for attendance corrections,
 * leave applications, and anything else a manager/HR should be alerted to.
 */
export async function getManagerAndHrUserIds(employeeId: number): Promise<number[]> {
    const [employee, hrUserIds] = await Promise.all([
        prisma.employee.findUnique({
            where: { id: employeeId },
            include: {
                manager: { include: { user: { select: { id: true, isActive: true } } } },
                managers: { include: { manager: { include: { user: { select: { id: true, isActive: true } } } } } },
            },
        }),
        getHrUserIds(),
    ]);

    const ids = new Set<number>(hrUserIds);
    if (employee?.manager?.user?.isActive) ids.add(employee.manager.user.id);
    for (const assignment of employee?.managers ?? []) {
        if (assignment.manager.user?.isActive) ids.add(assignment.manager.user.id);
    }
    return [...ids];
}

/** The user id linked to an employee profile, if any (and active). */
export async function getEmployeeUserId(employeeId: number): Promise<number | null> {
    const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { user: { select: { id: true, isActive: true } } },
    });
    return employee?.user?.isActive ? employee.user.id : null;
}

/** Active user ids for a batch of employee ids, in one query — for bulk notify loops (e.g. payroll import). */
export async function getEmployeeUserIdMap(employeeIds: number[]): Promise<Map<number, number>> {
    if (employeeIds.length === 0) return new Map();
    const users = await prisma.user.findMany({
        where: { employeeId: { in: employeeIds }, isActive: true },
        select: { id: true, employeeId: true },
    });
    const map = new Map<number, number>();
    for (const user of users) {
        if (user.employeeId !== null) map.set(user.employeeId, user.id);
    }
    return map;
}

/** Notifies many employees at once with a per-employee message, e.g. "your slip for X is ready." One createMany call. */
export async function notifyEmployeesBulk(
    employeeIds: number[],
    type: NotificationType,
    buildContent: (employeeId: number) => { title: string; message: string; entityId?: number },
    excludeUserId?: number
): Promise<void> {
    const userIdByEmployeeId = await getEmployeeUserIdMap(employeeIds);
    const rows = employeeIds
        .map(employeeId => {
            const recipientId = userIdByEmployeeId.get(employeeId);
            if (!recipientId || recipientId === excludeUserId) return null;
            const { title, message, entityId } = buildContent(employeeId);
            return { recipientId, type, title, message, entityId: entityId ?? null, employeeId };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) return;
    await prisma.notification.createMany({ data: rows });
}

/**
 * Whether `recipientId` has already received a learning nudge/reminder/overdue notice today
 * (server-local day). Used to cap a learner at one learning-related notification per day,
 * regardless of whether it came from the automated reminder scheduler or a manager's nudge.
 */
export async function hasReceivedLearningNotificationToday(recipientId: number): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existing = await prisma.notification.findFirst({
        where: {
            recipientId,
            type: { in: LEARNING_NUDGE_TYPES },
            createdAt: { gte: startOfDay },
        },
        select: { id: true },
    });
    return existing !== null;
}

/**
 * Active user ids for everyone an announcement targets: HR + LEADERSHIP always see it,
 * everyone else only if their employee department matches (or the target is company-wide).
 */
export async function getAudienceUserIds(targetDepartment: string | null): Promise<number[]> {
    const users = await prisma.user.findMany({
        where: {
            isActive: true,
            OR: [
                { role: { in: ['HR', 'LEADERSHIP'] } },
                targetDepartment
                    ? { employee: { department: targetDepartment } }
                    : { employee: { isNot: null } },
            ],
        },
        select: { id: true },
    });
    return users.map(u => u.id);
}
