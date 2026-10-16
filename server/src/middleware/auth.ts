import { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../utils/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import prisma from '../config/db.js';
import type { Role } from '@prisma/client';

/**
 * Extend Express Request to include authenticated user info.
 */
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

/**
 * Authentication middleware.
 * Validates JWT from Authorization header or httpOnly cookie, then re-reads the account so a
 * deactivated user is locked out immediately and a role change applies without re-login.
 * Attaches the current user to req.user.
 */
export function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction
): void {
    // Try Authorization header first, then cookie
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (req.cookies?.token) {
        token = req.cookies.token as string;
    }

    if (!token) {
        throw new UnauthorizedError('Authentication required');
    }

    const payload = verifyToken(token);
    if (!payload) {
        throw new UnauthorizedError('Invalid or expired token');
    }

    prisma.user
        .findUnique({
            where: { id: payload.userId },
            select: { role: true, isActive: true, employeeId: true, employee: { select: { isActive: true } } },
        })
        .then((account) => {
            if (!account || !account.isActive || (account.employee && !account.employee.isActive)) {
                throw new UnauthorizedError('Your account is no longer active');
            }
            req.user = { userId: payload.userId, role: account.role, employeeId: account.employeeId };
            next();
        })
        .catch(next);
}

/**
 * Role-based authorization middleware.
 * Must be used AFTER authenticate middleware.
 * Accepts one or more allowed roles.
 *
 * Usage: authorize('HR') or authorize('HR', 'MANAGER')
 */
export function authorize(...allowedRoles: Role[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            throw new UnauthorizedError('Authentication required');
        }

        if (!allowedRoles.includes(req.user.role)) {
            throw new ForbiddenError(
                'You do not have permission to perform this action'
            );
        }

        next();
    };
}

export const FULL_ACCESS_ROLES: Role[] = ['HR', 'LEADERSHIP'];
export const LEAVE_REVIEWER_ROLES: Role[] = ['HR', 'MANAGER', 'LEADERSHIP'];
export const MANAGER_ASSIGNMENT_ROLES: Role[] = ['MANAGER', 'LEADERSHIP'];

export function hasFullAccess(role: Role): boolean {
    return FULL_ACCESS_ROLES.includes(role);
}

export function canReviewLeaves(role: Role): boolean {
    return LEAVE_REVIEWER_ROLES.includes(role);
}

export async function getDescendantEmployeeIds(
    managerEmployeeId: number
): Promise<number[]> {
    // Reporting lines come from two places: the legacy single `managerId` column and the
    // "Reports to" links in employee_managers (what the profile form writes today). Both are
    // loaded in one round trip and walked in memory, instead of one query per hierarchy level.
    const [primaryLinks, extraLinks] = await Promise.all([
        prisma.employee.findMany({
            where: { isActive: true, managerId: { not: null } },
            select: { id: true, managerId: true },
        }),
        prisma.employeeManager.findMany({
            where: { employee: { isActive: true } },
            select: { employeeId: true, managerId: true },
        }),
    ]);

    const reportsByManager = new Map<number, Set<number>>();
    const link = (managerId: number, employeeId: number) => {
        const set = reportsByManager.get(managerId) ?? new Set<number>();
        set.add(employeeId);
        reportsByManager.set(managerId, set);
    };
    for (const employee of primaryLinks) link(employee.managerId!, employee.id);
    for (const row of extraLinks) link(row.managerId, row.employeeId);

    const visited = new Set<number>();
    const descendants: number[] = [];
    let frontier = [managerEmployeeId];

    while (frontier.length > 0) {
        const nextFrontier: number[] = [];

        for (const managerId of frontier) {
            for (const reportId of reportsByManager.get(managerId) ?? []) {
                if (visited.has(reportId)) {
                    continue;
                }

                visited.add(reportId);
                descendants.push(reportId);
                nextFrontier.push(reportId);
            }
        }

        frontier = nextFrontier;
    }

    return descendants;
}

export async function getScopedEmployeeIds(
    req: Request
): Promise<number[] | null> {
    if (!req.dataScope) {
        throw new UnauthorizedError('Authentication required');
    }

    const scope = req.dataScope;

    switch (scope.type) {
        case 'all':
            return null;
        case 'self':
            return scope.employeeId ? [scope.employeeId] : [];
        case 'team':
            if (!scope.employeeId) {
                return [];
            }

            // Memoized per request — several handlers ask for the scope more than once.
            req.scopedEmployeeIds ??= getDescendantEmployeeIds(scope.employeeId).then(
                (descendants) => [scope.employeeId!, ...descendants]
            );
            return req.scopedEmployeeIds;
        default:
            return [];
    }
}

/**
 * Data isolation middleware.
 * Ensures employees can only access their own data.
 * Managers can access their own + direct reports.
 * HR and leadership can access everything.
 *
 * Attaches `dataScope` to req for use in route handlers.
 */
export interface DataScope {
    /** The employee IDs this user is allowed to view */
    type: 'self' | 'team' | 'all';
    employeeId: number | null;
}

declare global {
    namespace Express {
        interface Request {
            dataScope?: DataScope;
            scopedEmployeeIds?: Promise<number[]>;
        }
    }
}

export function scopeData(
    req: Request,
    _res: Response,
    next: NextFunction
): void {
    if (!req.user) {
        throw new UnauthorizedError('Authentication required');
    }

    switch (req.user.role) {
        case 'LEADERSHIP':
        case 'HR':
            req.dataScope = { type: 'all', employeeId: req.user.employeeId };
            break;
        case 'MANAGER':
            req.dataScope = { type: 'team', employeeId: req.user.employeeId };
            break;
        case 'EMPLOYEE':
        default:
            req.dataScope = { type: 'self', employeeId: req.user.employeeId };
            break;
    }

    next();
}

export async function canAccessEmployee(
    req: Request,
    targetEmployeeId: number
): Promise<boolean> {
    if (!req.dataScope) {
        throw new UnauthorizedError('Authentication required');
    }

    const scope = req.dataScope;

    switch (scope.type) {
        case 'all':
            return true;
        case 'self':
            return scope.employeeId === targetEmployeeId;
        case 'team':
            return Boolean(
                (await getScopedEmployeeIds(req))?.includes(targetEmployeeId)
            );
        default:
            return false;
    }
}

export async function assertCanAccessEmployee(
    req: Request,
    targetEmployeeId: number,
    messages?: {
        self?: string;
        team?: string;
        default?: string;
    }
): Promise<void> {
    const allowed = await canAccessEmployee(req, targetEmployeeId);
    if (allowed) {
        return;
    }

    const scope = req.dataScope;
    if (!scope) {
        throw new UnauthorizedError('Authentication required');
    }

    if (scope.type === 'self') {
        throw new ForbiddenError(
            messages?.self ?? 'You can only view your own data'
        );
    }

    if (scope.type === 'team') {
        throw new ForbiddenError(
            messages?.team ?? 'You can only view your own team members'
        );
    }

    throw new ForbiddenError(
        messages?.default ?? 'You do not have permission to access this data'
    );
}
