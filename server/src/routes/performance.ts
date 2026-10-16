import { Router } from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import {
    authenticate,
    authorize,
    scopeData,
    assertCanAccessEmployee,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';

const router = Router();

router.use(authenticate, scopeData);

// ─── Validation schemas ──────────────────────────────────────

const kraSchema = z.object({
    employeeId: z.number().int().positive(),
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    period: z.string().max(50).default('Ongoing'),
});

const kpiSchema = z.object({
    kraId: z.number().int().positive(),
    metric: z.string().min(1).max(200),
    target: z.number().positive(),
    actual: z.number().min(0).optional().nullable(),
    unit: z.string().max(50).optional().nullable(),
});

const updateKpiSchema = z.object({
    metric: z.string().min(1).max(200).optional(),
    target: z.number().positive().optional(),
    actual: z.number().min(0).optional().nullable(),
    unit: z.string().max(50).optional().nullable(),
});

const updateKraSchema = kraSchema.partial().omit({ employeeId: true });

// ─── Helper: calculate score (0–100) ────────────────────────

function calcScore(actual: number | null | undefined, target: number): number | null {
    if (actual === null || actual === undefined) return null;
    if (target <= 0) return null;
    return Math.min(Math.round((actual / target) * 100 * 100) / 100, 100);
}

// ─── GET /api/performance/:employeeId ───────────────────────
// Returns all KRAs with nested KPIs + overall score summary

router.get(
    '/:employeeId',
    asyncHandler(async (req, res) => {
        const employeeId = parseInt(req.params['employeeId'] as string, 10);
        if (isNaN(employeeId)) throw new BadRequestError('Invalid employee ID');

        await assertCanAccessEmployee(req, employeeId, {
            self: 'You can only view your own performance data',
            team: 'You can only view your team members\' data',
        });

        const kras = await prisma.kra.findMany({
            where: { employeeId },
            include: { kpis: { orderBy: { createdAt: 'asc' } } },
            orderBy: { createdAt: 'asc' },
        });

        // Calculate overall score across all KPIs
        const allKpis = kras.flatMap(k => k.kpis);
        const scoredKpis = allKpis.filter(k => k.score !== null);
        const overallScore = scoredKpis.length > 0
            ? Math.round(scoredKpis.reduce((sum, k) => sum + Number(k.score), 0) / scoredKpis.length * 100) / 100
            : null;

        const summary = {
            totalKras: kras.length,
            totalKpis: allKpis.length,
            scoredKpis: scoredKpis.length,
            overallScore,
        };

        res.json({ success: true, data: { kras, summary } });
    })
);

/**
 * HR edits anyone's KRAs/KPIs; a manager edits those of people in their reporting line,
 * but not their own (their manager or HR sets those).
 */
async function assertCanEditPerformance(req: import('express').Request, employeeId: number): Promise<void> {
    if (req.user!.role === 'HR') return;
    if (req.user!.employeeId === employeeId) {
        throw new ForbiddenError('You cannot edit your own KRAs or KPIs');
    }
    await assertCanAccessEmployee(req, employeeId, {
        team: 'You can only edit KRAs and KPIs for your own team members',
    });
}

// ─── POST /api/performance/kra ───────────────────────────────

router.post(
    '/kra',
    authorize('HR', 'MANAGER'),
    validate(kraSchema),
    asyncHandler(async (req, res) => {
        const data = req.body as z.infer<typeof kraSchema>;
        await assertCanEditPerformance(req, data.employeeId);

        const kra = await prisma.kra.create({ data });

        res.status(201).json({
            success: true,
            data: { kra },
            message: 'KRA created',
        });
    })
);

// ─── PUT /api/performance/kra/:id ───────────────────────────

router.put(
    '/kra/:id',
    authorize('HR', 'MANAGER'),
    validate(updateKraSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid KRA ID');

        const existing = await prisma.kra.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('KRA not found');
        await assertCanEditPerformance(req, existing.employeeId);

        const kra = await prisma.kra.update({
            where: { id },
            data: req.body as z.infer<typeof updateKraSchema>,
        });

        res.json({ success: true, data: { kra }, message: 'KRA updated' });
    })
);

// ─── DELETE /api/performance/kra/:id ────────────────────────

router.delete(
    '/kra/:id',
    authorize('HR', 'MANAGER'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid KRA ID');

        const existing = await prisma.kra.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('KRA not found');
        await assertCanEditPerformance(req, existing.employeeId);

        await prisma.kra.delete({ where: { id } });

        res.json({ success: true, message: 'KRA deleted' });
    })
);

// ─── POST /api/performance/kpi ───────────────────────────────

router.post(
    '/kpi',
    authorize('HR', 'MANAGER'),
    validate(kpiSchema),
    asyncHandler(async (req, res) => {
        const data = req.body as z.infer<typeof kpiSchema>;

        // Verify KRA exists
        const kra = await prisma.kra.findUnique({ where: { id: data.kraId } });
        if (!kra) throw new NotFoundError('KRA not found');
        await assertCanEditPerformance(req, kra.employeeId);

        const score = calcScore(data.actual ?? null, data.target);

        const kpi = await prisma.kpi.create({
            data: {
                kraId: data.kraId,
                metric: data.metric,
                target: data.target,
                actual: data.actual ?? null,
                unit: data.unit ?? null,
                score: score,
            },
        });

        res.status(201).json({ success: true, data: { kpi }, message: 'KPI created' });
    })
);

// ─── PUT /api/performance/kpi/:id ───────────────────────────

router.put(
    '/kpi/:id',
    authorize('HR', 'MANAGER'),
    validate(updateKpiSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid KPI ID');

        const existing = await prisma.kpi.findUnique({ where: { id }, include: { kra: { select: { employeeId: true } } } });
        if (!existing) throw new NotFoundError('KPI not found');
        await assertCanEditPerformance(req, existing.kra.employeeId);

        const data = req.body as z.infer<typeof updateKpiSchema>;

        const newTarget = data.target ?? Number(existing.target);
        const newActual = data.actual !== undefined ? data.actual : (existing.actual !== null ? Number(existing.actual) : null);
        const score = calcScore(newActual, newTarget);

        const kpi = await prisma.kpi.update({
            where: { id },
            data: {
                ...data,
                score,
            },
        });

        res.json({ success: true, data: { kpi }, message: 'KPI updated' });
    })
);

// ─── DELETE /api/performance/kpi/:id ────────────────────────

router.delete(
    '/kpi/:id',
    authorize('HR', 'MANAGER'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid KPI ID');

        const existing = await prisma.kpi.findUnique({ where: { id }, include: { kra: { select: { employeeId: true } } } });
        if (!existing) throw new NotFoundError('KPI not found');
        await assertCanEditPerformance(req, existing.kra.employeeId);

        await prisma.kpi.delete({ where: { id } });

        res.json({ success: true, message: 'KPI deleted' });
    })
);

export default router;
