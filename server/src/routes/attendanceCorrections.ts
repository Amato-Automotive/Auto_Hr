import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AttendanceStatus } from '@prisma/client';
import prisma from '../config/db.js';
import { authenticate, scopeData } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { notify, getManagerAndHrUserIds, getEmployeeUserId } from '../utils/notificationService.js';
import { calculateWorkingHours } from '../utils/attendanceTimes.js';
import { datesInRange, isShortLeave } from '../utils/leaveRules.js';

/**
 * Employee attendance corrections — for one day or a date range.
 *
 * An employee submits a request; HR and the employee's managers are notified, and the first of
 * them to approve applies it (one approval is enough). Rejecting or cancelling changes nothing.
 * Approval writes the attendance rows and one AttendanceCorrection audit row per day, which also
 * stops later biometric punches from overwriting the corrected day.
 */
const router = Router();
router.use(authenticate, scopeData);

const MAX_RANGE_DAYS = 31;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Times must be HH:MM');

const createSchema = z.object({
    startDate: ymdSchema,
    endDate: ymdSchema.optional(), // omitted = single day
    status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL']),
    checkIn: timeSchema.optional().nullable(),
    checkOut: timeSchema.optional().nullable(),
    reason: z.string().trim().min(3, 'Reason is required').max(1000),
});

const reviewSchema = z.object({
    comment: z.string().trim().max(1000).optional(),
});

const requestInclude = {
    employee: { select: { id: true, name: true, department: true, position: true } },
    reviewedBy: { select: { username: true, employee: { select: { name: true } } } },
} as const;

const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymdOf = (date: Date) => date.toISOString().slice(0, 10);
const describeRange = (start: Date, end: Date) =>
    ymdOf(start) === ymdOf(end) ? ymdOf(start) : `${ymdOf(start)} to ${ymdOf(end)}`;

function parseId(value: string | undefined): number {
    const id = Number.parseInt(value ?? '', 10);
    if (!Number.isInteger(id)) throw new BadRequestError('Invalid request ID');
    return id;
}

/**
 * The dates in a request that a correction actually touches: company holidays and approved
 * full-day leave are never overwritten, and in a multi-day range Sundays (the weekly off) are
 * skipped. A single-day request may still be a Sunday, e.g. on-duty work.
 */
async function applicableDates(employeeId: number, startYmd: string, endYmd: string): Promise<string[]> {
    const start = dateOnly(startYmd);
    const end = dateOnly(endYmd);
    const [holidays, leaves] = await Promise.all([
        prisma.holiday.findMany({ where: { date: { gte: start, lte: end } }, select: { date: true } }),
        prisma.leave.findMany({
            where: { employeeId, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } },
            select: { type: true, startDate: true, endDate: true },
        }),
    ]);
    const holidayDates = new Set(holidays.map((holiday) => ymdOf(holiday.date)));
    const fullDayLeaves = leaves.filter((leave) => !isShortLeave(leave.type));
    const onLeave = (ymd: string) =>
        fullDayLeaves.some((leave) => ymdOf(leave.startDate) <= ymd && ymd <= ymdOf(leave.endDate));
    const singleDay = startYmd === endYmd;

    return datesInRange(startYmd, endYmd).filter(
        (ymd) => !holidayDates.has(ymd) && !onLeave(ymd) && (singleDay || dateOnly(ymd).getUTCDay() !== 0)
    );
}

/** HR or one of the employee's managers — never the person who asked for the correction. */
async function assertCanReview(req: Request, request: { employeeId: number; requestedById: number }) {
    const userId = req.user!.userId;
    if (userId === request.requestedById || req.user!.employeeId === request.employeeId) {
        throw new ForbiddenError('You cannot review your own attendance correction');
    }
    if (req.user!.role === 'HR') return;
    const reviewers = await getManagerAndHrUserIds(request.employeeId);
    if (!reviewers.includes(userId)) {
        throw new ForbiddenError("Only HR or this employee's manager can review this correction");
    }
}

// ─── POST /api/attendance/corrections ────────────────────────
// Employee asks to correct their own attendance for a day or a range.

router.post(
    '/',
    validate(createSchema),
    asyncHandler(async (req, res) => {
        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const body = req.body as z.infer<typeof createSchema>;
        const startYmd = body.startDate;
        const endYmd = body.endDate ?? body.startDate;
        const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

        if (endYmd < startYmd) throw new BadRequestError('End date cannot be before the start date');
        if (endYmd > todayYmd) throw new BadRequestError('Future attendance cannot be corrected');
        if (datesInRange(startYmd, endYmd).length > MAX_RANGE_DAYS) {
            throw new BadRequestError(`A correction can cover at most ${MAX_RANGE_DAYS} days`);
        }

        const checkIn = body.checkIn?.trim() || null;
        const checkOut = body.checkOut?.trim() || null;
        if (checkIn && checkOut && !calculateWorkingHours(checkIn, checkOut)) {
            throw new BadRequestError('Check-out time must be after check-in time');
        }

        const start = dateOnly(startYmd);
        const end = dateOnly(endYmd);
        const [dates, overlapping, employee] = await Promise.all([
            applicableDates(employeeId, startYmd, endYmd),
            prisma.attendanceCorrectionRequest.findFirst({
                where: { employeeId, state: 'PENDING', startDate: { lte: end }, endDate: { gte: start } },
                select: { startDate: true, endDate: true },
            }),
            prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } }),
        ]);
        if (overlapping) {
            throw new BadRequestError(
                `You already have a pending correction for ${describeRange(overlapping.startDate, overlapping.endDate)}`
            );
        }
        if (dates.length === 0) {
            throw new BadRequestError('Those dates are holidays, approved leave or Sundays — there is nothing to correct');
        }

        const request = await prisma.attendanceCorrectionRequest.create({
            data: {
                employeeId,
                requestedById: req.user!.userId,
                startDate: start,
                endDate: end,
                status: body.status,
                checkIn,
                checkOut,
                reason: body.reason,
            },
            include: requestInclude,
        });

        await notify({
            recipientIds: await getManagerAndHrUserIds(employeeId),
            excludeUserId: req.user!.userId,
            type: 'ATTENDANCE_CORRECTION_REQUESTED',
            title: `${employee?.name ?? 'An employee'} asked to correct attendance`,
            message: `${describeRange(start, end)} (${dates.length} day${dates.length === 1 ? '' : 's'}): ${body.status.replaceAll('_', ' ')}. Reason: ${body.reason}`,
            entityId: request.id,
            employeeId,
        });

        res.status(201).json({
            success: true,
            data: { request },
            message: 'Sent to your manager and HR — your attendance updates once one of them approves',
        });
    })
);

// ─── GET /api/attendance/corrections?scope=mine|review&state= ─
// mine: the caller's own requests. review: requests the caller can approve (default: pending).

router.get(
    '/',
    asyncHandler(async (req, res) => {
        const scope = req.query['scope'] === 'review' ? 'review' : 'mine';
        const stateParam = req.query['state'] as string | undefined;
        const states = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
        const state = states.find((value) => value === stateParam) ?? (scope === 'review' ? 'PENDING' : undefined);
        const myEmployeeId = req.user!.employeeId;

        let employeeFilter: Record<string, unknown>;
        if (scope === 'mine') {
            if (!myEmployeeId) {
                res.json({ success: true, data: { requests: [] } });
                return;
            }
            employeeFilter = { employeeId: myEmployeeId };
        } else if (req.user!.role === 'HR') {
            employeeFilter = myEmployeeId ? { employeeId: { not: myEmployeeId } } : {};
        } else if (myEmployeeId && ['MANAGER', 'LEADERSHIP'].includes(req.user!.role)) {
            // Same reviewers as getManagerAndHrUserIds: the employee's direct or "Reports to" managers.
            employeeFilter = {
                employee: { OR: [{ managerId: myEmployeeId }, { managers: { some: { managerId: myEmployeeId } } }] },
            };
        } else {
            res.json({ success: true, data: { requests: [] } });
            return;
        }

        const requests = await prisma.attendanceCorrectionRequest.findMany({
            where: { ...employeeFilter, ...(state ? { state } : {}) },
            include: requestInclude,
            orderBy: { createdAt: 'desc' },
            take: 100,
        });

        res.json({ success: true, data: { requests } });
    })
);

// ─── POST /api/attendance/corrections/:id/approve ────────────

router.post(
    '/:id/approve',
    validate(reviewSchema),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params['id'] as string);
        const { comment } = req.body as z.infer<typeof reviewSchema>;

        const request = await prisma.attendanceCorrectionRequest.findUnique({ where: { id } });
        if (!request) throw new NotFoundError('Correction request not found');
        await assertCanReview(req, request);
        if (request.state !== 'PENDING') {
            throw new BadRequestError(`This correction was already ${request.state.toLowerCase()}`);
        }

        // Re-checked now: a holiday or leave may have been added since the request was made.
        const dates = await applicableDates(request.employeeId, ymdOf(request.startDate), ymdOf(request.endDate));
        if (dates.length === 0) {
            throw new BadRequestError('Every date in this request is now a holiday or approved leave — reject it instead');
        }

        const totalWorkingHours = calculateWorkingHours(request.checkIn, request.checkOut);
        await prisma.$transaction(async (tx) => {
            // Only one reviewer wins: if someone else decided in the meantime, nothing is applied.
            const { count } = await tx.attendanceCorrectionRequest.updateMany({
                where: { id, state: 'PENDING' },
                data: { state: 'APPROVED', reviewedById: req.user!.userId, reviewedAt: new Date(), reviewComment: comment || null },
            });
            if (count === 0) throw new BadRequestError('This correction was already reviewed by someone else');

            const existingRows = await tx.attendance.findMany({
                where: { employeeId: request.employeeId, date: { in: dates.map(dateOnly) } },
            });
            const existingByDate = new Map(existingRows.map((row) => [ymdOf(row.date), row]));

            for (const ymd of dates) {
                const date = dateOnly(ymd);
                const existing = existingByDate.get(ymd);
                const fields = {
                    status: request.status as AttendanceStatus,
                    checkIn: request.checkIn,
                    checkOut: request.checkOut,
                    totalWorkingHours,
                    isLate: false,
                    lateBy: null,
                    overtime: false,
                    otTime: null,
                };
                const saved = await tx.attendance.upsert({
                    where: { employeeId_date: { employeeId: request.employeeId, date } },
                    update: fields,
                    create: { employeeId: request.employeeId, date, day: DAY_NAMES[date.getUTCDay()] ?? '', ...fields },
                });
                await tx.attendanceCorrection.create({
                    data: {
                        attendanceId: saved.id,
                        employeeId: request.employeeId,
                        editedById: req.user!.userId,
                        date,
                        previousStatus: existing?.status ?? 'ABSENT',
                        newStatus: request.status,
                        previousCheckIn: existing?.checkIn,
                        newCheckIn: request.checkIn,
                        previousCheckOut: existing?.checkOut,
                        newCheckOut: request.checkOut,
                        reason: request.reason,
                    },
                });
            }
        });

        const employeeUserId = await getEmployeeUserId(request.employeeId);
        if (employeeUserId) {
            await notify({
                recipientIds: [employeeUserId],
                excludeUserId: req.user!.userId,
                type: 'ATTENDANCE_CORRECTION_APPROVED',
                title: 'Attendance correction approved',
                message: `${describeRange(request.startDate, request.endDate)} is now ${request.status.replaceAll('_', ' ')}.${comment ? ` Note: ${comment}` : ''}`,
                entityId: id,
                employeeId: request.employeeId,
            });
        }

        const updated = await prisma.attendanceCorrectionRequest.findUnique({ where: { id }, include: requestInclude });
        res.json({
            success: true,
            data: { request: updated, daysUpdated: dates.length },
            message: `Approved — ${dates.length} day${dates.length === 1 ? '' : 's'} updated`,
        });
    })
);

// ─── POST /api/attendance/corrections/:id/reject ─────────────

router.post(
    '/:id/reject',
    validate(reviewSchema),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params['id'] as string);
        const { comment } = req.body as z.infer<typeof reviewSchema>;

        const request = await prisma.attendanceCorrectionRequest.findUnique({ where: { id } });
        if (!request) throw new NotFoundError('Correction request not found');
        await assertCanReview(req, request);

        const { count } = await prisma.attendanceCorrectionRequest.updateMany({
            where: { id, state: 'PENDING' },
            data: { state: 'REJECTED', reviewedById: req.user!.userId, reviewedAt: new Date(), reviewComment: comment || null },
        });
        if (count === 0) throw new BadRequestError('This correction was already reviewed');

        const employeeUserId = await getEmployeeUserId(request.employeeId);
        if (employeeUserId) {
            await notify({
                recipientIds: [employeeUserId],
                excludeUserId: req.user!.userId,
                type: 'ATTENDANCE_CORRECTION_REJECTED',
                title: 'Attendance correction rejected',
                message: `Your correction for ${describeRange(request.startDate, request.endDate)} was rejected.${comment ? ` Reason: ${comment}` : ''}`,
                entityId: id,
                employeeId: request.employeeId,
            });
        }

        const updated = await prisma.attendanceCorrectionRequest.findUnique({ where: { id }, include: requestInclude });
        res.json({ success: true, data: { request: updated }, message: 'Correction rejected' });
    })
);

// ─── POST /api/attendance/corrections/:id/cancel ─────────────
// The employee withdraws their own pending request.

router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
        const id = parseId(req.params['id'] as string);
        const request = await prisma.attendanceCorrectionRequest.findUnique({ where: { id } });
        if (!request) throw new NotFoundError('Correction request not found');
        if (request.employeeId !== req.user!.employeeId) {
            throw new ForbiddenError('You can only cancel your own correction requests');
        }

        const { count } = await prisma.attendanceCorrectionRequest.updateMany({
            where: { id, state: 'PENDING' },
            data: { state: 'CANCELLED' },
        });
        if (count === 0) throw new BadRequestError('Only a pending correction can be cancelled');

        res.json({ success: true, message: 'Correction request cancelled' });
    })
);

export default router;
