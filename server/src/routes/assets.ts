import { Router } from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import { authenticate, authorize, assertCanAccessEmployee, scopeData } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors.js';
import { getEmployeeUserId, notify } from '../utils/notificationService.js';

/**
 * Company assets issued to employees (laptops, phones, tablets, ...).
 *
 * HR records, edits, marks returned and deletes; anyone who can see the employee (themselves,
 * their managers, HR, leadership) can view the list. Returning an asset keeps the row, so the
 * profile shows what the employee had before. One serial number can only be out with one
 * employee at a time.
 */
const router = Router();
router.use(authenticate, scopeData);

export const ASSET_TYPES = ['LAPTOP', 'DESKTOP', 'PHONE', 'TABLET', 'OTHER'] as const;
const TYPE_LABELS: Record<(typeof ASSET_TYPES)[number], string> = {
    LAPTOP: 'laptop',
    DESKTOP: 'desktop',
    PHONE: 'phone',
    TABLET: 'tablet',
    OTHER: 'asset',
};

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');
const optionalText = (max: number) =>
    z.string().trim().max(max).optional().nullable().transform((value) => value || null);

const assetSchema = z.object({
    type: z.enum(ASSET_TYPES),
    name: z.string().trim().min(1, 'Name / model is required').max(150),
    serialNumber: optionalText(100),
    assignedOn: ymdSchema,
    notes: optionalText(2000),
});

const returnSchema = z.object({
    returnedOn: ymdSchema,
    notes: optionalText(2000),
});

const assetInclude = {
    assignedBy: { select: { username: true, employee: { select: { name: true } } } },
} as const;

const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

function parseId(value: string | string[] | undefined, label: string): number {
    const normalized = Array.isArray(value) ? value[0] : value;
    const id = Number.parseInt(normalized ?? '', 10);
    if (!Number.isInteger(id)) throw new BadRequestError(`Invalid ${label}`);
    return id;
}

/** Refuses a serial number that is still out with someone (case-insensitive; MySQL collation). */
async function assertSerialAvailable(serialNumber: string | null, exceptAssetId?: number) {
    if (!serialNumber) return;
    const clash = await prisma.employeeAsset.findFirst({
        where: {
            serialNumber,
            returnedOn: null,
            ...(exceptAssetId ? { id: { not: exceptAssetId } } : {}),
        },
        include: { employee: { select: { name: true } } },
    });
    if (clash) {
        throw new ConflictError(`Serial number ${serialNumber} is already assigned to ${clash.employee.name}. Mark it returned first.`);
    }
}

async function findAsset(id: number) {
    const asset = await prisma.employeeAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundError('Asset not found');
    return asset;
}

router.get(
    '/employees/:employeeId',
    asyncHandler(async (req, res) => {
        const employeeId = parseId(req.params.employeeId, 'employee ID');
        await assertCanAccessEmployee(req, employeeId, {
            self: 'You can only view your own assets',
            team: 'You can only view assets of your team members',
        });

        const assets = await prisma.employeeAsset.findMany({
            where: { employeeId },
            include: assetInclude,
            // Current assets first, then returned ones, newest first within each.
            orderBy: [{ returnedOn: { sort: 'asc', nulls: 'first' } }, { assignedOn: 'desc' }, { id: 'desc' }],
        });

        res.json({ success: true, data: { assets } });
    })
);

router.post(
    '/employees/:employeeId',
    authorize('HR'),
    validate(assetSchema),
    asyncHandler(async (req, res) => {
        const employeeId = parseId(req.params.employeeId, 'employee ID');
        const body = req.body as z.infer<typeof assetSchema>;

        const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
        if (!employee) throw new NotFoundError('Employee not found');
        await assertSerialAvailable(body.serialNumber);

        const asset = await prisma.employeeAsset.create({
            data: {
                employeeId,
                type: body.type,
                name: body.name,
                serialNumber: body.serialNumber,
                assignedOn: dateOnly(body.assignedOn),
                notes: body.notes,
                assignedById: req.user!.userId,
            },
            include: assetInclude,
        });

        const recipientId = await getEmployeeUserId(employeeId);
        if (recipientId) {
            await notify({
                recipientIds: [recipientId],
                type: 'ASSET_ASSIGNED',
                title: 'Company asset assigned',
                message: `A company ${TYPE_LABELS[body.type]} (${body.name}${body.serialNumber ? `, S/N ${body.serialNumber}` : ''}) has been assigned to you.`,
                entityId: asset.id,
                employeeId,
                excludeUserId: req.user!.userId,
            });
        }

        res.status(201).json({ success: true, data: { asset } });
    })
);

router.put(
    '/:id',
    authorize('HR'),
    validate(assetSchema),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id, 'asset ID');
        const body = req.body as z.infer<typeof assetSchema>;
        const existing = await findAsset(id);
        if (!existing.returnedOn) await assertSerialAvailable(body.serialNumber, id);

        const asset = await prisma.employeeAsset.update({
            where: { id },
            data: {
                type: body.type,
                name: body.name,
                serialNumber: body.serialNumber,
                assignedOn: dateOnly(body.assignedOn),
                notes: body.notes,
            },
            include: assetInclude,
        });

        res.json({ success: true, data: { asset } });
    })
);

router.post(
    '/:id/return',
    authorize('HR'),
    validate(returnSchema),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id, 'asset ID');
        const body = req.body as z.infer<typeof returnSchema>;
        const existing = await findAsset(id);
        if (existing.returnedOn) throw new BadRequestError('This asset is already marked returned');
        if (dateOnly(body.returnedOn) < existing.assignedOn) {
            throw new BadRequestError('Return date cannot be before the assigned date');
        }

        const asset = await prisma.employeeAsset.update({
            where: { id },
            data: {
                returnedOn: dateOnly(body.returnedOn),
                // A return note is added below the existing notes, not over them.
                ...(body.notes
                    ? { notes: existing.notes ? `${existing.notes}\nReturned: ${body.notes}` : `Returned: ${body.notes}` }
                    : {}),
            },
            include: assetInclude,
        });

        res.json({ success: true, data: { asset } });
    })
);

router.delete(
    '/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseId(req.params.id, 'asset ID');
        await findAsset(id);
        await prisma.employeeAsset.delete({ where: { id } });
        res.json({ success: true, message: 'Asset removed' });
    })
);

export default router;
