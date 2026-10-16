import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import prisma from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { classifyLink } from '../utils/linkEmbed.js';
import { putUploadFile, extensionForMimeType } from '../utils/uploadStorage.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { deliverAnnouncementEmail, notifyAnnouncementPublished } from '../utils/announcementScheduler.js';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});

router.use(authenticate);

// ─── Validation schemas ──────────────────────────────────────

const updateAnnouncementSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    content: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    expiresAt: z.string().nullable().optional(),
    isPinned: z.boolean().optional(),
    isActive: z.boolean().optional(),
    targetDepartment: z.string().nullable().optional(),
    scheduledAt: z.string().nullable().optional(),
    sendEmail: z.boolean().optional(),
});

const FULL_VISIBILITY_ROLES = ['HR', 'LEADERSHIP'];

/** Resolves the department an announcement audience filter should apply for the current viewer. */
async function getViewerDepartment(role: string, employeeId: number | null): Promise<string | null> {
    if (FULL_VISIBILITY_ROLES.includes(role)) return null; // sees everything regardless of department
    if (!employeeId) return null;
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { department: true } });
    return employee?.department || null;
}

// ─── GET /api/announcements ──────────────────────────────────
// All authenticated users can see announcements targeted to them

router.get(
    '/',
    asyncHandler(async (req, res) => {
        const { userId, role, employeeId } = req.user!;
        const seesAll = FULL_VISIBILITY_ROLES.includes(role);
        const viewerDepartment = await getViewerDepartment(role, employeeId);

        const announcements = await prisma.announcement.findMany({
            where: {
                isActive: true,
                AND: [
                    { OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
                    { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
                    ...(seesAll
                        ? []
                        : [{
                            OR: [
                                { targetDepartment: null },
                                ...(viewerDepartment ? [{ targetDepartment: viewerDepartment }] : []),
                            ],
                        }]),
                ],
            },
            include: {
                createdBy: { select: { username: true } },
                media: { orderBy: { sortOrder: 'asc' } },
                reads: { where: { userId }, select: { id: true } },
            },
            orderBy: [
                { isPinned: 'desc' },
                { priority: 'desc' },
                { createdAt: 'desc' },
            ],
        });

        const withReadState = announcements.map(({ reads, ...rest }) => ({
            ...rest,
            isRead: reads.length > 0,
        }));

        const unreadCount = withReadState.filter((a) => !a.isRead).length;

        res.json({ success: true, data: { announcements: withReadState, unreadCount } });
    })
);

// ─── GET /api/announcements/:id ──────────────────────────────

router.get(
    '/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid announcement ID');

        const announcement = await prisma.announcement.findUnique({
            where: { id },
            include: {
                createdBy: { select: { username: true } },
                media: { orderBy: { sortOrder: 'asc' } },
            },
        });

        const isScheduledForFuture = announcement?.scheduledAt && announcement.scheduledAt > new Date();
        const isExpired = announcement?.expiresAt && announcement.expiresAt < new Date();
        const isHR = req.user!.role === 'HR';
        if (!announcement || !announcement.isActive || ((isScheduledForFuture || isExpired) && !isHR)) {
            throw new NotFoundError('Announcement not found');
        }
        // Same audience rule as the list: a department-targeted announcement is only for that department.
        if (announcement.targetDepartment && !FULL_VISIBILITY_ROLES.includes(req.user!.role)) {
            const viewerDepartment = await getViewerDepartment(req.user!.role, req.user!.employeeId);
            if (viewerDepartment !== announcement.targetDepartment) {
                throw new NotFoundError('Announcement not found');
            }
        }

        res.json({ success: true, data: { announcement } });
    })
);

// ─── POST /api/announcements ─────────────────────────────────
// Create announcement (HR only) with text, multiple images/videos,
// and/or pasted links (YouTube, Instagram, etc.) that auto-embed.

router.post(
    '/',
    authorize('HR'),
    upload.array('media', 10),
    asyncHandler(async (req, res) => {
        const title = req.body.title as string;
        const content = req.body.content as string | undefined;
        const priority = req.body.priority as string | undefined;
        const expiresAt = req.body.expiresAt as string | undefined;
        const isPinned = req.body.isPinned === 'true' || req.body.isPinned === true;
        const targetDepartmentRaw = req.body.targetDepartment as string | undefined;
        const targetDepartment = targetDepartmentRaw && targetDepartmentRaw !== 'ALL' ? targetDepartmentRaw : null;
        const scheduledAtRaw = req.body.scheduledAt as string | undefined;
        const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
        const sendEmail = req.body.sendEmail === 'true' || req.body.sendEmail === true;

        if (!title) throw new BadRequestError('Title is required');
        if (scheduledAt && (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())) {
            throw new BadRequestError('Scheduled time must be in the future');
        }

        let links: string[] = [];
        if (req.body.links) {
            try {
                const parsed = JSON.parse(req.body.links as string);
                if (Array.isArray(parsed)) links = parsed.filter((l) => typeof l === 'string' && l.trim());
            } catch {
                throw new BadRequestError('Invalid links payload');
            }
        }

        // Per-file downloadable flags, aligned by index with the uploaded `media` files
        let downloadableFlags: boolean[] = [];
        if (req.body.downloadableFlags) {
            try {
                const parsed = JSON.parse(req.body.downloadableFlags as string);
                if (Array.isArray(parsed)) downloadableFlags = parsed.map((v) => v === true);
            } catch {
                throw new BadRequestError('Invalid downloadableFlags payload');
            }
        }

        const files = (req.files as Express.Multer.File[] | undefined) || [];

        // Two at a time: each upload opens its own FTP connection, and Hostinger refuses too many at once.
        const uploadedMedia = await mapWithConcurrency(
            files, 2, async (file, index) => {
                const extension = extensionForMimeType(file.mimetype);
                const url = await putUploadFile(`announcements/${randomUUID()}.${extension}`, file.buffer);
                return {
                    type: file.mimetype.startsWith('video/') ? 'VIDEO_FILE' as const : 'IMAGE' as const,
                    url,
                    isDownloadable: downloadableFlags[index] === true,
                    sortOrder: index,
                };
            }
        );

        const announcement = await prisma.announcement.create({
            data: {
                title,
                content,
                priority: (priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') || 'LOW',
                isPinned,
                targetDepartment,
                scheduledAt,
                publishedAt: scheduledAt ? null : new Date(),
                sendEmail,
                createdById: req.user!.userId,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                media: {
                    create: [
                        ...uploadedMedia,
                        ...links.map((link, index) => ({
                            type: classifyLink(link),
                            url: link,
                            sortOrder: files.length + index,
                        })),
                    ],
                },
            },
            include: { media: { orderBy: { sortOrder: 'asc' } } },
        });

        if (!scheduledAt) {
            if (sendEmail) {
                void deliverAnnouncementEmail(announcement.id).catch(error => {
                    console.error(`Announcement ${announcement.id} email delivery failed:`, error);
                });
            }
            void notifyAnnouncementPublished(announcement.id).catch(error => {
                console.error(`Announcement ${announcement.id} notification failed:`, error);
            });
        }

        res.status(201).json({
            success: true,
            data: { announcement },
            message: scheduledAt ? 'Announcement scheduled' : 'Announcement published',
        });
    })
);

// ─── PUT /api/announcements/:id ──────────────────────────────

router.put(
    '/:id',
    authorize('HR'),
    validate(updateAnnouncementSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid announcement ID');

        const existing = await prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Announcement not found');

        const data = req.body as z.infer<typeof updateAnnouncementSchema>;

        const announcement = await prisma.announcement.update({
            where: { id },
            data: {
                ...data,
                expiresAt: data.expiresAt ? new Date(data.expiresAt) : data.expiresAt === null ? null : undefined,
                scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : data.scheduledAt === null ? null : undefined,
            },
            include: { media: { orderBy: { sortOrder: 'asc' } } },
        });

        res.json({
            success: true,
            data: { announcement },
            message: 'Announcement updated',
        });
    })
);

// ─── POST /api/announcements/:id/read ────────────────────────
// Mark a single announcement as read by the current user

router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid announcement ID');

        await prisma.announcementRead.upsert({
            where: { announcementId_userId: { announcementId: id, userId: req.user!.userId } },
            create: { announcementId: id, userId: req.user!.userId },
            update: {},
        });

        res.json({ success: true, message: 'Marked as read' });
    })
);

// ─── POST /api/announcements/read-all ────────────────────────
// Mark every visible announcement as read by the current user

router.post(
    '/read-all',
    asyncHandler(async (req, res) => {
        const { userId, role, employeeId } = req.user!;
        const seesAll = FULL_VISIBILITY_ROLES.includes(role);
        const viewerDepartment = await getViewerDepartment(role, employeeId);

        const announcements = await prisma.announcement.findMany({
            where: {
                isActive: true,
                AND: [{ OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] }],
                ...(seesAll
                    ? {}
                    : {
                        OR: [
                            { targetDepartment: null },
                            ...(viewerDepartment ? [{ targetDepartment: viewerDepartment }] : []),
                        ],
                    }),
            },
            select: { id: true },
        });

        await prisma.announcementRead.createMany({
            data: announcements.map((a) => ({ announcementId: a.id, userId })),
            skipDuplicates: true,
        });

        res.json({ success: true, message: 'All announcements marked as read' });
    })
);

// ─── DELETE /api/announcements/:id ───────────────────────────
// Soft delete

router.delete(
    '/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid announcement ID');

        await prisma.announcement.update({
            where: { id },
            data: { isActive: false },
        });

        res.json({ success: true, message: 'Announcement deleted' });
    })
);

export default router;
