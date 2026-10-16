import { Router } from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import { authenticate, authorize, scopeData, getScopedEmployeeIds } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { notify, getEmployeeUserIdMap } from '../utils/notificationService.js';

const router = Router();

router.use(authenticate, scopeData);

// ─── Validation schemas ──────────────────────────────────────

const createSessionSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().optional(),
    courseId: z.coerce.number().int().positive().optional(),
    instructorName: z.string().min(1, 'Instructor name is required').max(100),
    location: z.string().min(1, 'Location is required').max(255),
    startsAt: z.string().min(1, 'Start time is required'),
    endsAt: z.string().min(1, 'End time is required'),
    capacity: z.coerce.number().int().positive(),
    targetDepartment: z.string().max(100).optional(),
}).refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: 'End time must be after start time',
});

const updateSessionSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().nullable().optional(),
    courseId: z.number().int().positive().nullable().optional(),
    instructorName: z.string().min(1).max(100).optional(),
    location: z.string().min(1).max(255).optional(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    capacity: z.number().int().positive().optional(),
    targetDepartment: z.string().max(100).nullable().optional(),
});

// ─── GET /api/ilt/sessions ───────────────────────────────────
// Catalog list — published sessions visible to the viewer's department (or all-department)

router.get(
    '/sessions',
    asyncHandler(async (req, res) => {
        const { role, employeeId } = req.user!;
        const seesAll = role === 'HR' || role === 'LEADERSHIP';

        let viewerDepartment: string | null = null;
        if (!seesAll && employeeId) {
            const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { department: true } });
            viewerDepartment = employee?.department || null;
        }

        const sessions = await prisma.iLTSession.findMany({
            where: {
                ...(seesAll ? {} : {
                    state: 'PUBLISHED',
                    OR: [
                        { targetDepartment: null },
                        ...(viewerDepartment ? [{ targetDepartment: viewerDepartment }] : []),
                    ],
                }),
            },
            include: {
                createdBy: { select: { username: true } },
                course: { select: { id: true, title: true } },
                _count: { select: { registrations: { where: { status: { in: ['REGISTERED', 'ATTENDED'] } } } } },
            },
            orderBy: { startsAt: 'asc' },
        });

        res.json({ success: true, data: { sessions } });
    })
);

// ─── GET /api/ilt/sessions/:id ───────────────────────────────

router.get(
    '/sessions/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid session ID');

        const session = await prisma.iLTSession.findUnique({
            where: { id },
            include: {
                createdBy: { select: { username: true } },
                course: { select: { id: true, title: true } },
                registrations: {
                    include: { employee: { select: { id: true, name: true, department: true, avatar: true, gender: true } } },
                    orderBy: { registeredAt: 'asc' },
                },
            },
        });
        if (!session) throw new NotFoundError('Session not found');

        res.json({ success: true, data: { session } });
    })
);

// ─── POST /api/ilt/sessions ───────────────────────────────────
// Create session (HR only)

router.post(
    '/sessions',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const body = createSessionSchema.parse(req.body);

        if (body.courseId) {
            const course = await prisma.course.findUnique({ where: { id: body.courseId } });
            if (!course) throw new NotFoundError('Linked course not found');
        }

        const session = await prisma.iLTSession.create({
            data: {
                title: body.title,
                description: body.description,
                courseId: body.courseId,
                instructorName: body.instructorName,
                location: body.location,
                startsAt: new Date(body.startsAt),
                endsAt: new Date(body.endsAt),
                capacity: body.capacity,
                targetDepartment: body.targetDepartment,
                createdById: req.user!.userId,
            },
        });

        res.status(201).json({ success: true, data: { session }, message: 'Session created as draft' });
    })
);

// ─── PUT /api/ilt/sessions/:id ────────────────────────────────

router.put(
    '/sessions/:id',
    authorize('HR'),
    validate(updateSessionSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid session ID');

        const existing = await prisma.iLTSession.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Session not found');

        const body = req.body as z.infer<typeof updateSessionSchema>;
        const data: Record<string, unknown> = { ...body };
        if (body.startsAt) data['startsAt'] = new Date(body.startsAt);
        if (body.endsAt) data['endsAt'] = new Date(body.endsAt);

        const session = await prisma.iLTSession.update({ where: { id }, data });
        res.json({ success: true, data: { session }, message: 'Session updated' });
    })
);

// ─── POST /api/ilt/sessions/:id/publish, /cancel ──────────────

router.post(
    '/sessions/:id/publish',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid session ID');

        const session = await prisma.iLTSession.update({ where: { id }, data: { state: 'PUBLISHED' } });
        res.json({ success: true, data: { session }, message: 'Session published' });
    })
);

router.post(
    '/sessions/:id/cancel',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid session ID');

        const session = await prisma.iLTSession.findUnique({
            where: { id },
            include: { registrations: { where: { status: { in: ['REGISTERED', 'WAITLISTED'] } }, include: { employee: { select: { id: true } } } } },
        });
        if (!session) throw new NotFoundError('Session not found');

        await prisma.iLTSession.update({ where: { id }, data: { state: 'CANCELLED' } });

        const employeeIds = session.registrations.map((r) => r.employee.id);
        const userIdMap = await getEmployeeUserIdMap(employeeIds);
        await notify({
            recipientIds: userIdMap.values(),
            type: 'ILT_SESSION_CANCELLED',
            title: 'Training session cancelled',
            message: `"${session.title}" scheduled for ${session.startsAt.toLocaleDateString('en-IN')} has been cancelled.`,
            entityId: id,
        });

        res.json({ success: true, message: 'Session cancelled' });
    })
);

// ─── DELETE /api/ilt/sessions/:id ─────────────────────────────

router.delete(
    '/sessions/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid session ID');

        await prisma.iLTSession.delete({ where: { id } });
        res.json({ success: true, message: 'Session removed' });
    })
);

// ─── POST /api/ilt/sessions/:id/register ──────────────────────
// Self-register. Automatically waitlists if the session is full.

router.post(
    '/sessions/:id/register',
    asyncHandler(async (req, res) => {
        const sessionId = parseInt(req.params['id'] as string, 10);
        if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID');

        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const session = await prisma.iLTSession.findUnique({
            where: { id: sessionId },
            include: { registrations: { where: { status: { in: ['REGISTERED', 'ATTENDED'] } } } },
        });
        if (!session) throw new NotFoundError('Session not found');
        if (session.state !== 'PUBLISHED') throw new BadRequestError('This session is not open for registration');
        if (session.startsAt < new Date()) throw new BadRequestError('This session has already started');

        const existing = await prisma.iLTRegistration.findUnique({
            where: { sessionId_employeeId: { sessionId, employeeId } },
        });
        if (existing && existing.status !== 'CANCELLED') {
            res.json({ success: true, data: { registration: existing }, message: 'Already registered' });
            return;
        }

        const isFull = session.registrations.length >= session.capacity;
        const status = isFull ? 'WAITLISTED' : 'REGISTERED';
        // Someone who cancelled earlier re-uses their row (one per session/employee), joining the
        // back of the waitlist rather than keeping their old place.
        const registration = existing
            ? await prisma.iLTRegistration.update({ where: { id: existing.id }, data: { status, registeredAt: new Date() } })
            : await prisma.iLTRegistration.create({ data: { sessionId, employeeId, status } });

        res.status(201).json({
            success: true,
            data: { registration },
            message: isFull ? 'Session is full — added to waitlist' : 'Registered successfully',
        });
    })
);

// ─── POST /api/ilt/registrations/:id/cancel ───────────────────
// Learner cancels their own registration. Promotes the next waitlisted person, if any.

router.post(
    '/registrations/:id/cancel',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid registration ID');

        const registration = await prisma.iLTRegistration.findUnique({ where: { id } });
        if (!registration) throw new NotFoundError('Registration not found');
        if (registration.employeeId !== req.user!.employeeId) {
            throw new BadRequestError('You can only cancel your own registration');
        }
        if (!['REGISTERED', 'WAITLISTED'].includes(registration.status)) {
            throw new BadRequestError('This registration cannot be cancelled');
        }

        const wasRegistered = registration.status === 'REGISTERED';
        await prisma.iLTRegistration.update({ where: { id }, data: { status: 'CANCELLED' } });

        if (wasRegistered) {
            const nextWaitlisted = await prisma.iLTRegistration.findFirst({
                where: { sessionId: registration.sessionId, status: 'WAITLISTED' },
                orderBy: { registeredAt: 'asc' },
            });
            if (nextWaitlisted) {
                await prisma.iLTRegistration.update({ where: { id: nextWaitlisted.id }, data: { status: 'REGISTERED' } });

                const session = await prisma.iLTSession.findUnique({ where: { id: registration.sessionId } });
                const userIdMap = await getEmployeeUserIdMap([nextWaitlisted.employeeId]);
                const recipientUserId = userIdMap.get(nextWaitlisted.employeeId);
                if (recipientUserId && session) {
                    await notify({
                        recipientIds: [recipientUserId],
                        type: 'ILT_WAITLIST_PROMOTED',
                        title: 'You\'re in! Spot opened up',
                        message: `A spot opened up in "${session.title}" — you're now registered.`,
                        entityId: session.id,
                    });
                }
            }
        }

        res.json({ success: true, message: 'Registration cancelled' });
    })
);

// ─── POST /api/ilt/sessions/:id/attendance ────────────────────
// Mark attendance for one or more registrations (HR only). Body: { records: [{ registrationId, attended }] }

const markAttendanceSchema = z.object({
    records: z.array(z.object({
        registrationId: z.number().int().positive(),
        attended: z.boolean(),
    })).min(1),
});

router.post(
    '/sessions/:id/attendance',
    authorize('HR'),
    validate(markAttendanceSchema),
    asyncHandler(async (req, res) => {
        const sessionId = parseInt(req.params['id'] as string, 10);
        if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID');

        const { records } = req.body as z.infer<typeof markAttendanceSchema>;

        const registrations = await prisma.iLTRegistration.findMany({
            where: { id: { in: records.map((r) => r.registrationId) }, sessionId },
        });
        if (registrations.length !== records.length) {
            throw new BadRequestError('One or more registrations do not belong to this session');
        }

        await Promise.all(records.map((r) =>
            prisma.iLTRegistration.update({
                where: { id: r.registrationId },
                data: { status: r.attended ? 'ATTENDED' : 'NO_SHOW' },
            })
        ));

        await prisma.iLTSession.update({ where: { id: sessionId }, data: { state: 'COMPLETED' } });

        res.json({ success: true, message: 'Attendance recorded' });
    })
);

// ─── GET /api/ilt/my/registrations ────────────────────────────

router.get(
    '/my/registrations',
    asyncHandler(async (req, res) => {
        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const registrations = await prisma.iLTRegistration.findMany({
            where: { employeeId },
            include: { session: { include: { course: { select: { id: true, title: true } } } } },
            orderBy: { session: { startsAt: 'asc' } },
        });

        res.json({ success: true, data: { registrations } });
    })
);

// ─── GET /api/ilt/team/registrations ──────────────────────────
// Manager's team / org-wide registrations (mirrors learning.ts's team-enrollments pattern)

router.get(
    '/team/registrations',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const scopedIds = await getScopedEmployeeIds(req);
        const selfId = req.user!.employeeId;

        const employeeFilter = scopedIds
            ? { id: { in: scopedIds.filter((id) => id !== selfId) } }
            : selfId
                ? { id: { not: selfId } }
                : {};

        const registrations = await prisma.iLTRegistration.findMany({
            where: { employee: employeeFilter },
            include: {
                session: { select: { id: true, title: true, startsAt: true, endsAt: true, location: true } },
                employee: { select: { id: true, name: true, department: true, avatar: true, gender: true } },
            },
            orderBy: { registeredAt: 'desc' },
        });

        res.json({ success: true, data: { registrations } });
    })
);

export default router;
