import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import prisma from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { notify, getAudienceUserIds } from '../utils/notificationService.js';
import { putUploadFile, removeUploadFile, extensionForMimeType } from '../utils/uploadStorage.js';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

router.use(authenticate);

const uploadDocumentSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().max(2000).optional(),
});

// ─── GET /api/library/documents ──────────────────────────────
// Every authenticated user can browse the library

router.get(
    '/documents',
    asyncHandler(async (req, res) => {
        const userId = req.user!.userId;

        const documents = await prisma.libraryDocument.findMany({
            include: {
                uploadedBy: { select: { username: true } },
                reads: { where: { userId }, select: { id: true } },
                _count: { select: { reads: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: {
                documents: documents.map((d) => ({
                    id: d.id,
                    title: d.title,
                    description: d.description,
                    fileName: d.fileName,
                    mimeType: d.mimeType,
                    sizeBytes: d.sizeBytes,
                    createdAt: d.createdAt,
                    uploadedBy: d.uploadedBy,
                    uploadedById: d.uploadedById,
                    isRead: d.reads.length > 0,
                    readCount: d._count.reads,
                })),
            },
        });
    })
);

// ─── POST /api/library/documents ─────────────────────────────
// Upload a new document (HR/Manager/Leadership)

router.post(
    '/documents',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    upload.single('document'),
    validate(uploadDocumentSchema),
    asyncHandler(async (req, res) => {
        if (!req.file) throw new BadRequestError('A PDF or Word document is required');
        if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
            throw new BadRequestError('Only PDF and Word documents are allowed');
        }

        const body = req.body as z.infer<typeof uploadDocumentSchema>;
        const extension = extensionForMimeType(req.file.mimetype);
        const contentUrl = await putUploadFile(`library/${randomUUID()}.${extension}`, req.file.buffer);

        const document = await prisma.libraryDocument.create({
            data: {
                title: body.title,
                description: body.description,
                fileName: req.file.originalname,
                mimeType: req.file.mimetype,
                contentUrl,
                sizeBytes: req.file.size,
                uploadedById: req.user!.userId,
            },
        });

        const audienceUserIds = await getAudienceUserIds(null);
        await notify({
            recipientIds: audienceUserIds,
            type: 'LIBRARY_DOCUMENT_ADDED',
            title: 'New document in the E-Library',
            message: `"${document.title}" was added to the E-Library.`,
            entityId: document.id,
            excludeUserId: req.user!.userId,
        });

        res.status(201).json({
            success: true,
            data: {
                document: {
                    id: document.id,
                    title: document.title,
                    description: document.description,
                    fileName: document.fileName,
                    mimeType: document.mimeType,
                    sizeBytes: document.sizeBytes,
                    createdAt: document.createdAt,
                    uploadedById: document.uploadedById,
                    isRead: false,
                    readCount: 0,
                },
            },
            message: 'Document added to the library',
        });
    })
);

// ─── POST /api/library/documents/:id/read ────────────────────
// Mark a document as read by the current user

router.post(
    '/documents/:id/read',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid document ID');

        const document = await prisma.libraryDocument.findUnique({ where: { id } });
        if (!document) throw new NotFoundError('Document not found');

        await prisma.libraryDocumentRead.upsert({
            where: { documentId_userId: { documentId: id, userId: req.user!.userId } },
            create: { documentId: id, userId: req.user!.userId },
            update: {},
        });

        res.json({ success: true, message: 'Marked as read' });
    })
);

// ─── GET /api/library/documents/:id/download ─────────────────

router.get(
    '/documents/:id/download',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid document ID');

        const document = await prisma.libraryDocument.findUnique({ where: { id } });
        if (!document) throw new NotFoundError('Document not found');

        res.json({
            success: true,
            data: {
                fileName: document.fileName,
                mimeType: document.mimeType,
                contentUrl: document.contentUrl,
            },
        });
    })
);

// ─── DELETE /api/library/documents/:id ────────────────────────

router.delete(
    '/documents/:id',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid document ID');

        const document = await prisma.libraryDocument.findUnique({ where: { id } });
        if (!document) throw new NotFoundError('Document not found');
        // HR curates the whole library; managers/leadership can only remove what they uploaded.
        if (req.user!.role !== 'HR' && document.uploadedById !== req.user!.userId) {
            throw new ForbiddenError('You can only remove documents you uploaded');
        }

        await prisma.libraryDocument.delete({ where: { id } });
        if (document.contentUrl) {
            await removeUploadFile(document.contentUrl).catch((error) =>
                console.error(`Library document ${id}: stored file not removed:`, error)
            );
        }

        res.json({ success: true, message: 'Document removed' });
    })
);

export default router;
