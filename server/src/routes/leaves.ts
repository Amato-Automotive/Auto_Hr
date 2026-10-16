import { Router } from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import {
    authenticate,
    authorize,
    scopeData,
    assertCanAccessEmployee,
    canReviewLeaves,
    getScopedEmployeeIds,
    hasFullAccess,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors.js';
import { notify, getManagerAndHrUserIds, getEmployeeUserId } from '../utils/notificationService.js';
import { isShortLeave, SHORT_LEAVE_TYPES, SHORT_LEAVES_PER_MONTH, SHORT_LEAVE_HOURS, SHORT_LEAVE_WINDOWS, datesInRange, isChargeableLeaveDay } from '../utils/leaveRules.js';

const router = Router();

router.use(authenticate, scopeData);

// ─── Validation schemas ──────────────────────────────────────

const applyLeaveSchema = z.object({
    type: z.string().min(1).max(50),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Start date must be YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'End date must be YYYY-MM-DD'),
    // Ignored — the server counts the days itself (see below). Kept so older clients still validate.
    days: z.number().int().min(0).optional(),
    reason: z.string().optional(),
    approverIds: z.string().optional(),
});

const leaveActionSchema = z.object({
    reason: z.string().optional(), // rejection reason
});

/** "Casual Leave leave from 2026-10-01 to 2026-10-02" or "Short Leave (Morning) on 2026-10-01". */
function describeLeave(leave: { type: string; startDate: Date; endDate: Date }): string {
    const start = leave.startDate.toISOString().split('T')[0];
    const end = leave.endDate.toISOString().split('T')[0];
    return isShortLeave(leave.type)
        ? `${leave.type} on ${start} (${SHORT_LEAVE_WINDOWS[leave.type]})`
        : `${leave.type} leave from ${start} to ${end}`;
}

async function canManageLeaveByHierarchy(
    req: import('express').Request,
    leaveEmployeeId: number
): Promise<boolean> {
    const currentUser = req.user;
    if (!currentUser?.employeeId || leaveEmployeeId === currentUser.employeeId) {
        return false;
    }

    const scopedIds = await getScopedEmployeeIds(req);
    if (!scopedIds) {
        return true;
    }

    return scopedIds.includes(leaveEmployeeId);
}

// ─── GET /api/leaves ─────────────────────────────────────────
// List leaves — scoped by role

router.get(
    '/',
    asyncHandler(async (req, res) => {
        const scope = req.dataScope!;
        const status = req.query['status'] as string | undefined;
        const employeeId = req.query['employeeId'] as string | undefined;
        const currentUser = req.user!;
        const targetEmployeeId = employeeId ? parseInt(employeeId, 10) : null;

        if (employeeId && (!targetEmployeeId || Number.isNaN(targetEmployeeId))) {
            throw new BadRequestError('Invalid employee ID');
        }

        // Build scope filter
        let where: any = {};

        if (targetEmployeeId) {
            await assertCanAccessEmployee(req, targetEmployeeId, {
                self: 'You can only view your own leave records',
                team: 'You can only view leave records for your own team members',
            });

            where.employeeId = targetEmployeeId;
        } else if (scope.type === 'self') {
            where.OR = [
                { employeeId: scope.employeeId },
                { approverIds: { contains: `,${currentUser.userId},` } }
            ];
        } else if (scope.type === 'team') {
            // Manager: own leaves + full team hierarchy + leaves where they are listed in approverIds
            const ids = await getScopedEmployeeIds(req);
            where.OR = [
                { employeeId: { in: ids } },
                { approverIds: { contains: `,${currentUser.userId},` } }
            ];
        }
        // HR: no filter (sees all)

        // Optional filters
        if (status) where.status = status;

        const leaves = await prisma.leave.findMany({
            where,
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        department: true,
                        manager: {
                            select: {
                                id: true,
                                name: true,
                                department: true,
                                position: true,
                            },
                        },
                    },
                },
                approvedBy: { select: { id: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ success: true, data: { leaves } });
    })
);

// ─── POST /api/leaves ────────────────────────────────────────
// Apply for leave (any authenticated user)

router.post(
    '/',
    validate(applyLeaveSchema),
    asyncHandler(async (req, res) => {
        const { type, reason, approverIds } = req.body as z.infer<typeof applyLeaveSchema>;
        const startDate = (req.body as z.infer<typeof applyLeaveSchema>).startDate.slice(0, 10);
        const endDate = (req.body as z.infer<typeof applyLeaveSchema>).endDate.slice(0, 10);

        if (!req.user?.employeeId) {
            throw new BadRequestError('No employee profile linked to this account');
        }
        if (endDate < startDate) {
            throw new BadRequestError('End date cannot be before the start date');
        }

        const rangeStart = new Date(`${startDate}T00:00:00.000Z`);
        const rangeEnd = new Date(`${endDate}T00:00:00.000Z`);
        const [holidays, overlapping] = await Promise.all([
            prisma.holiday.findMany({ where: { date: { gte: rangeStart, lte: rangeEnd } }, select: { date: true } }),
            prisma.leave.findFirst({
                where: {
                    employeeId: req.user.employeeId,
                    status: { in: ['PENDING', 'APPROVED'] },
                    startDate: { lte: rangeEnd },
                    endDate: { gte: rangeStart },
                },
                select: { type: true, startDate: true, endDate: true },
            }),
        ]);
        if (overlapping) {
            throw new BadRequestError(`You already have ${describeLeave(overlapping)} that overlaps these dates`);
        }
        const holidayDates = new Set(holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)));
        // Days charged = working days (Mon–Sat, not a company holiday) in the range; the client's count isn't trusted.
        const workingDays = datesInRange(startDate, endDate).filter((ymd) => isChargeableLeaveDay(ymd, holidayDates)).length;
        let days = workingDays;

        const shortLeave = isShortLeave(type);
        if (shortLeave) {
            if (startDate !== endDate) {
                throw new BadRequestError('A short leave is for a single day — pick one date');
            }
            if (workingDays === 0) {
                throw new BadRequestError('A short leave must be on a working day');
            }
            days = 0;

            // One short leave per calendar month (pending or approved); unused ones don't carry forward.
            const monthStart = new Date(`${startDate.slice(0, 7)}-01T00:00:00.000Z`);
            const nextMonth = new Date(monthStart);
            nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
            const usedThisMonth = await prisma.leave.count({
                where: {
                    employeeId: req.user.employeeId,
                    type: { in: [...SHORT_LEAVE_TYPES] },
                    status: { in: ['PENDING', 'APPROVED'] },
                    startDate: { gte: monthStart, lt: nextMonth },
                },
            });
            if (usedThisMonth >= SHORT_LEAVES_PER_MONTH) {
                throw new BadRequestError('You have already used your short leave for this month');
            }
        } else if (days < 1) {
            throw new BadRequestError('These dates are all Sundays or company holidays — no leave is needed');
        }

        // Format approver IDs with commas to allow robust matching: e.g. ",2,5,"
        const formattedApprovers = approverIds
            ? `,${approverIds.split(',').filter(Boolean).join(',')},`
            : null;

        const isSelfApprovingRole = canReviewLeaves(req.user.role);

        const leave = await prisma.leave.create({
            data: {
                employeeId: req.user.employeeId,
                type,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                days,
                reason,
                approverIds: formattedApprovers,
                status: isSelfApprovingRole ? 'APPROVED' : 'PENDING',
                approvedById: isSelfApprovingRole ? req.user.userId : null,
            },
            include: { employee: { select: { name: true } } },
        });

        if (!isSelfApprovingRole) {
            const explicitApprovers = approverIds
                ? approverIds.split(',').filter(Boolean).map(Number).filter(Number.isFinite)
                : [];
            const recipientIds = explicitApprovers.length > 0
                ? explicitApprovers
                : await getManagerAndHrUserIds(req.user.employeeId);

            await notify({
                recipientIds,
                excludeUserId: req.user.userId,
                type: 'LEAVE_APPLIED',
                title: `${leave.employee.name} applied for leave`,
                message: shortLeave
                    ? `${leave.type} on ${startDate.slice(0, 10)}, ${SHORT_LEAVE_WINDOWS[type]} (${SHORT_LEAVE_HOURS} hours)${reason ? `. Reason: ${reason}` : ''}`
                    : `${leave.type} leave from ${startDate} to ${endDate} (${days} day${days > 1 ? 's' : ''})${reason ? `. Reason: ${reason}` : ''}`,
                entityId: leave.id,
                employeeId: req.user.employeeId,
            });
        }

        res.status(201).json({
            success: true,
            data: { leave },
            message: 'Leave application submitted',
        });
    })
);

// ─── PUT /api/leaves/:id/approve ─────────────────────────────

router.put(
    '/:id/approve',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    validate(leaveActionSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid leave ID');

        const { reason } = req.body as z.infer<typeof leaveActionSchema>;

        const leave = await prisma.leave.findUnique({
            where: { id },
            include: { employee: true },
        });
        if (!leave) throw new NotFoundError('Leave not found');

        const isGlobalReviewer = hasFullAccess(req.user!.role);
        const isDesignatedApprover = leave.approverIds
            ? leave.approverIds.split(',').filter(Boolean).includes(String(req.user!.userId))
            : false;
        const isHierarchyManager = await canManageLeaveByHierarchy(req, leave.employeeId);

        // Either a full-access role, hierarchy manager, or a selected designated approver can approve
        if (!isGlobalReviewer && !isDesignatedApprover && !isHierarchyManager) {
            throw new ForbiddenError('You do not have permission to approve this leave');
        }

        if (leave.status !== 'PENDING') {
            throw new BadRequestError(`This leave was already ${leave.status.toLowerCase()}`);
        }

        const updated = await prisma.leave.update({
            where: { id },
            data: {
                status: 'APPROVED',
                approvedById: req.user!.userId,
                comment: reason || null,
            },
        });

        const employeeUserId = await getEmployeeUserId(leave.employeeId);
        if (employeeUserId) {
            await notify({
                recipientIds: [employeeUserId],
                excludeUserId: req.user!.userId,
                type: 'LEAVE_APPROVED',
                title: 'Your leave was approved',
                message: `${describeLeave(leave)} was approved.${reason ? ` Note: ${reason}` : ''}`,
                entityId: leave.id,
                employeeId: leave.employeeId,
            });
        }

        res.json({
            success: true,
            data: { leave: updated },
            message: 'Leave approved',
        });
    })
);

// ─── PUT /api/leaves/:id/reject ──────────────────────────────

router.put(
    '/:id/reject',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    validate(leaveActionSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid leave ID');

        const { reason } = req.body as z.infer<typeof leaveActionSchema>;

        const leave = await prisma.leave.findUnique({
            where: { id },
            include: { employee: true },
        });
        if (!leave) throw new NotFoundError('Leave not found');

        const isGlobalReviewer = hasFullAccess(req.user!.role);
        const isDesignatedApprover = leave.approverIds
            ? leave.approverIds.split(',').filter(Boolean).includes(String(req.user!.userId))
            : false;
        const isHierarchyManager = await canManageLeaveByHierarchy(req, leave.employeeId);

        // Either a full-access role, hierarchy manager, or a selected designated approver can reject
        if (!isGlobalReviewer && !isDesignatedApprover && !isHierarchyManager) {
            throw new ForbiddenError('You do not have permission to reject this leave');
        }

        if (leave.status !== 'PENDING') {
            throw new BadRequestError(`This leave was already ${leave.status.toLowerCase()}`);
        }

        const updated = await prisma.leave.update({
            where: { id },
            data: {
                status: 'REJECTED',
                approvedById: req.user!.userId,
                comment: reason || null,
            },
        });

        const employeeUserId = await getEmployeeUserId(leave.employeeId);
        if (employeeUserId) {
            await notify({
                recipientIds: [employeeUserId],
                excludeUserId: req.user!.userId,
                type: 'LEAVE_REJECTED',
                title: 'Your leave was rejected',
                message: `${describeLeave(leave)} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
                entityId: leave.id,
                employeeId: leave.employeeId,
            });
        }

        res.json({
            success: true,
            data: { leave: updated },
            message: 'Leave rejected',
        });
    })
);

// ─── DELETE /api/leaves/:id ──────────────────────────────────
// Cancel own pending leave

router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid leave ID');

        const leave = await prisma.leave.findUnique({ where: { id } });
        if (!leave) throw new NotFoundError('Leave not found');

        // Only own pending leaves can be cancelled
        if (leave.employeeId !== req.user!.employeeId && !hasFullAccess(req.user!.role)) {
            throw new ForbiddenError('You can only cancel your own leaves');
        }
        if (leave.status !== 'PENDING') {
            throw new BadRequestError('Only pending leaves can be cancelled');
        }

        await prisma.leave.delete({ where: { id } });

        res.json({ success: true, message: 'Leave cancelled' });
    })
);

export default router;
