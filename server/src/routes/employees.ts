import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import prisma from '../config/db.js';
import { masterEmployees } from '../data/employeeMaster.js';
import {
    authenticate,
    authorize,
    scopeData,
    assertCanAccessEmployee,
    getDescendantEmployeeIds,
    getScopedEmployeeIds,
    MANAGER_ASSIGNMENT_ROLES,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../utils/errors.js';
import { hashPassword } from '../utils/password.js';
import { storeAvatarFile } from '../utils/avatarStorage.js';
import { removePrivateUploadFile } from '../utils/uploadStorage.js';
import { isAccountsDepartment } from '../utils/payrollAccess.js';
import { notify, getHrUserIds } from '../utils/notificationService.js';

/** Statutory and bank fields — only HR and the employee themselves may see them. */
const PAYROLL_FIELDS = [
    'employeeNumber', 'panNumber', 'uanNumber', 'pfAccountNumber', 'esiNumber',
    'pranNumber', 'taxRegime', 'bankAccountNumber', 'bankIfscCode', 'bankBranch',
] as const;

const PAYROLL_FIELD_LABELS: Record<(typeof PAYROLL_FIELDS)[number], string> = {
    employeeNumber: 'Employee number',
    panNumber: 'PAN',
    uanNumber: 'UAN',
    pfAccountNumber: 'PF account',
    esiNumber: 'ESI number',
    pranNumber: 'PRAN',
    taxRegime: 'Tax regime',
    bankAccountNumber: 'Bank account',
    bankIfscCode: 'IFSC code',
    bankBranch: 'Bank branch',
};

/** "XXXX1234" — enough for HR to recognise the change without spreading the full number. */
const maskValue = (value: string | null | undefined) =>
    !value ? '(blank)' : value.length <= 4 ? value : `${'X'.repeat(Math.min(value.length - 4, 6))}${value.slice(-4)}`;

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 * 1024 * 1024 } });

// All employee routes require authentication + data scoping
router.use(authenticate, scopeData);

// ─── Validation schemas ──────────────────────────────────────

const optionalEmail = z.preprocess(
    (value) => {
        if (typeof value === 'string' && value.trim() === '') {
            return undefined;
        }
        return value;
    },
    z.string().email('Invalid email').max(100).nullable().optional()
);

// Date of birth as YYYY-MM-DD: a real past date, age 14–100.
const dateOfBirthSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
    .refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
        const age = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        return age >= 14 && age <= 100;
    }, 'Enter a valid date of birth');

const toDateOfBirth = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

const createEmployeeSchema = z.object({
    biometricId: z.number().int().positive().optional().nullable(),
    name: z.string().min(1, 'Name is required').max(100),
    position: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    email: optionalEmail,
    phone: z.string().max(20).optional(),
    joinDate: z.string().optional().nullable(), // ISO date string
    dateOfBirth: dateOfBirthSchema.optional().nullable(),
    managerId: z.number().int().positive().optional().nullable(),
    managerIds: z.array(z.number().int().positive()).optional(), // Multiple managers
    avatar: z.string().max(500).optional().nullable(),
    gender: z.enum(['Male', 'Female', 'Other']).optional().nullable(),
    bio: z.string().optional(),
    skills: z.array(z.string()).optional(),
    experience: z.string().optional(),
    education: z.string().max(255).optional(),
    employeeType: z.string().max(50).optional(),
    tallyLedgerName: z.string().max(200).optional().nullable(),
    employeeNumber: z.string().max(50).optional().nullable(),
    panNumber: z.string().max(20).optional().nullable(),
    uanNumber: z.string().max(20).optional().nullable(),
    pfAccountNumber: z.string().max(50).optional().nullable(),
    esiNumber: z.string().max(50).optional().nullable(),
    pranNumber: z.string().max(50).optional().nullable(),
    taxRegime: z.string().max(50).optional().nullable(),
    bankAccountNumber: z.string().max(50).optional().nullable(),
    bankIfscCode: z.string().max(20).optional().nullable(),
    bankBranch: z.string().max(100).optional().nullable(),

    // Optional: create a user account for this employee
    createUser: z.boolean().optional(),
    username: z.string().min(1).max(50).optional(),
    password: z.string().min(6, 'Password must be at least 6 characters').max(128).optional(),
    role: z.enum(['EMPLOYEE', 'MANAGER', 'HR', 'LEADERSHIP']).optional(),
});

const updateEmployeeSchema = createEmployeeSchema.partial();

const querySchema = z.object({
    search: z.string().optional(),
    department: z.string().optional(),
    managerId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(50),
});

// ─── Helper: build WHERE clause based on data scope ──────────

async function buildWhereClause(req: import('express').Request) {
    const scope = req.dataScope!;

    switch (scope.type) {
        case 'self':
            // Employee can only see themselves
            if (!scope.employeeId) return { id: -1 }; // no results
            return { id: scope.employeeId };

        case 'team':
            // Manager sees self + full reporting hierarchy
            const scopedIds = await getScopedEmployeeIds(req);
            return {
                id: {
                    in: scopedIds ?? [],
                },
            };

        case 'all':
            // HR sees everyone
            return {};

        default:
            return { id: -1 };
    }
}

async function validateManagerAssignment(
    managerId: number | null | undefined,
    employeeId?: number
) {
    if (managerId === undefined || managerId === null) {
        return;
    }

    if (employeeId && managerId === employeeId) {
        throw new BadRequestError('Employee cannot be their own manager');
    }

    // Allow building the reporting hierarchy even before every manager has a
    // login/user role. If a manager has a user, ensure they have a manager-capable role.
    const manager = await prisma.employee.findFirst({
        where: { id: managerId, isActive: true },
        select: { id: true },
    });

    if (!manager) {
        throw new BadRequestError('Selected manager not found or inactive');
    }

    const managerUser = await prisma.user.findFirst({
        where: {
            employeeId: managerId,
            isActive: true,
        },
        select: { role: true },
    });

    if (managerUser && !MANAGER_ASSIGNMENT_ROLES.includes(managerUser.role)) {
        throw new BadRequestError(
            'Selected manager must have a MANAGER or LEADERSHIP user role'
        );
    }
}

// ─── GET /api/employees ──────────────────────────────────────
// List employees (filtered by role scope)

router.get(
    '/',
    validate(querySchema, 'query'),
    asyncHandler(async (req, res) => {
        const { search, department, managerId, page, limit } = req.query as unknown as z.infer<typeof querySchema>;

        const scopeWhere = await buildWhereClause(req);
        const skip = (page - 1) * limit;

        // Build additional filters
        const filters: Record<string, unknown> = {};
        if (search) {
            filters.OR = [
                { name: { contains: search } },
                { email: { contains: search } },
                { position: { contains: search } },
            ];
        }
        if (department) {
            filters.department = department;
        }
        if (managerId) {
            filters.managerId = parseInt(managerId, 10);
        }

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where: {
                    ...scopeWhere,
                    ...filters,
                    isActive: true,
                },
                select: {
                    id: true,
                    biometricId: true,
                    name: true,
                    position: true,
                    department: true,
                    email: true,
                    phone: true,
                    joinDate: true,
                    managerId: true,
                    avatar: true,
                    gender: true,
                    employeeType: true,
                    tallyLedgerName: true,
                    employeeNumber: true,
                    manager: {
                        select: { id: true, name: true },
                    },
                    user: {
                        select: { role: true, isActive: true },
                    },
                },
                orderBy: { name: 'asc' },
                skip,
                take: limit,
            }),
            prisma.employee.count({
                where: {
                    ...scopeWhere,
                    ...filters,
                    isActive: true,
                },
            }),
        ]);

        res.json({
            success: true,
            data: {
                employees,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            },
        });
    })
);

// ─── GET /api/employees/approvers/list ───────────────────────────
// Get list of all potential approvers (Managers and HRs)
// Available to any authenticated user

router.get(
    '/approvers/list',
    asyncHandler(async (_req, res) => {
        const approvers = await prisma.user.findMany({
            where: {
                role: { in: ['MANAGER', 'HR', 'LEADERSHIP'] },
                isActive: true,
                employeeId: { not: null },
            },
            select: {
                id: true, // User ID (stored in approverIds)
                role: true,
                username: true,
                employee: {
                    select: {
                        id: true,
                        name: true,
                        position: true,
                        department: true,
                    },
                },
            },
            orderBy: {
                employee: {
                    name: 'asc',
                },
            },
        });

        // Format nicely for frontend
        const list = approvers.map(a => ({
            userId: a.id,
            employeeId: a.employee!.id,
            name: a.employee!.name,
            role: a.role,
            position: a.employee!.position,
            department: a.employee!.department,
        }));

        res.json({
            success: true,
            data: { approvers: list },
        });
    })
);

// ─── GET /api/employees/managers/list ────────────────────────────────
// Get employees who can be assigned as reporting managers

router.get(
    '/managers/list',
    asyncHandler(async (_req, res) => {
        const managers = await prisma.user.findMany({
            where: {
                role: { in: MANAGER_ASSIGNMENT_ROLES },
                isActive: true,
                employeeId: { not: null },
                employee: {
                    is: {
                        isActive: true,
                    },
                },
            },
            select: {
                id: true,
                role: true,
                employee: {
                    select: {
                        id: true,
                        name: true,
                        position: true,
                        department: true,
                    },
                },
            },
            orderBy: {
                employee: {
                    name: 'asc',
                },
            },
        });

        res.json({
            success: true,
            data: {
                managers: managers.map((manager) => ({
                    userId: manager.id,
                    employeeId: manager.employee!.id,
                    name: manager.employee!.name,
                    position: manager.employee!.position,
                    department: manager.employee!.department,
                    role: manager.role,
                })),
            },
        });
    })
);

// ─── POST /api/employees/master/sync ────────────────────────────────
// Sync baseline biometric master data into the employee table

router.post(
    '/master/sync',
    authorize('HR'),
    asyncHandler(async (_req, res) => {
        // One read + one bulk insert instead of two queries per master record.
        const existing = await prisma.employee.findMany({
            where: { biometricId: { in: masterEmployees.map((m) => m.biometricId) } },
            select: { biometricId: true },
        });
        const existingIds = new Set(existing.map((e) => e.biometricId));
        const toCreate = masterEmployees.filter((m) => !existingIds.has(m.biometricId));

        const { count: created } = toCreate.length > 0
            ? await prisma.employee.createMany({
                data: toCreate.map((m) => ({
                    biometricId: m.biometricId,
                    name: m.name,
                    department: m.department,
                })),
                skipDuplicates: true,
            })
            : { count: 0 };
        const skipped = masterEmployees.length - created;

        res.json({
            success: true,
            message: 'Master employee data synced successfully',
            data: {
                total: masterEmployees.length,
                created,
                skipped,
            },
        });
    })
);

// ─── GET /api/employees/birthdays/today ──────────────────────
// Everyone (any role) sees who has a birthday today, company-wide, for the celebration
// popup. "Today" is the India (IST) calendar day. Only day/month are exposed — never the
// year — so ages stay private. Feb 29 birthdays are celebrated on Feb 28 in other years.

router.get(
    '/birthdays/today',
    asyncHandler(async (_req, res) => {
        const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
            .format(new Date())
            .split('-')
            .map(Number) as [number, number, number];
        const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

        const employees = await prisma.employee.findMany({
            where: { isActive: true, dateOfBirth: { not: null } },
            select: { id: true, name: true, department: true, position: true, avatar: true, gender: true, dateOfBirth: true },
            orderBy: { name: 'asc' },
        });

        const birthdays = employees
            .filter(({ dateOfBirth }) => {
                const dobMonth = dateOfBirth!.getUTCMonth() + 1;
                const dobDay = dateOfBirth!.getUTCDate();
                if (dobMonth === month && dobDay === day) return true;
                return !isLeapYear && dobMonth === 2 && dobDay === 29 && month === 2 && day === 28;
            })
            .map(({ dateOfBirth: _dateOfBirth, ...employee }) => employee);

        res.json({ success: true, data: { birthdays } });
    })
);

// ─── GET /api/employees/:id ──────────────────────────────────
// Full employee profile (all data)

router.get(
    '/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        await assertCanAccessEmployee(req, id, {
            self: 'You can only view your own profile',
            team: 'You can only view your own team members',
        });

        const employee = await prisma.employee.findUnique({
            where: { id },
            include: {
                    manager: {
                        select: { id: true, name: true, position: true },
                    },
                    managers: {
                        include: {
                            manager: {
                            select: { id: true, name: true, position: true, department: true },
                        },
                    },
                },
                directReports: {
                    select: { id: true, name: true, position: true, department: true },
                    where: { isActive: true },
                },
                user: {
                    select: { id: true, username: true, role: true, canImportPayroll: true },
                },
            },
        });

        if (!employee || !employee.isActive) {
            throw new NotFoundError('Employee not found');
        }

        // Managers/leadership viewing a team member don't get PAN, bank and other payroll identifiers.
        if (req.user!.role !== 'HR' && req.user!.employeeId !== id) {
            for (const field of PAYROLL_FIELDS) {
                (employee as Record<string, unknown>)[field] = null;
            }
        }

        res.json({
            success: true,
            data: { employee },
        });
    })
);

// ─── POST /api/employees ─────────────────────────────────────
// Create employee (HR only)

router.post(
    '/',
    authorize('HR'),
    validate(createEmployeeSchema),
    asyncHandler(async (req, res) => {
        const {
            createUser, username, password, role,
            joinDate,
            dateOfBirth,
            managerIds,
            ...employeeData
        } = req.body as z.infer<typeof createEmployeeSchema>;

        // Validate single manager first if provided
        if (employeeData.managerId) {
            await validateManagerAssignment(employeeData.managerId);
        }

        // Validate each manager in managerIds
        if (managerIds && managerIds.length > 0) {
            for (const mId of managerIds) {
                await validateManagerAssignment(mId);
            }
        }

        if (employeeData.email) {
            const emailOwner = await prisma.employee.findFirst({
                where: { email: employeeData.email },
                select: { id: true },
            });

            if (emailOwner) {
                throw new ConflictError('An employee with this email already exists');
            }
        }

        const wantsUser = Boolean(createUser && username && password);
        if (wantsUser && (await prisma.user.findUnique({ where: { username: username! }, select: { id: true } }))) {
            throw new ConflictError('Username is already taken');
        }
        const passwordHash = wantsUser ? await hashPassword(password!) : null;

        // Employee, reporting links and login are created together, so a failure never leaves a
        // half-created employee behind.
        const employee = await prisma.$transaction(async (tx) => {
            const created = await tx.employee.create({
                data: {
                    ...employeeData,
                    skills: employeeData.skills ? JSON.stringify(employeeData.skills) : undefined,
                    joinDate: joinDate ? new Date(joinDate) : undefined,
                    dateOfBirth: dateOfBirth ? toDateOfBirth(dateOfBirth) : undefined,
                },
            });

            if (managerIds && managerIds.length > 0) {
                await tx.employeeManager.createMany({
                    data: managerIds.map(managerId => ({
                        employeeId: created.id,
                        managerId,
                    })),
                });
            }

            if (passwordHash) {
                await tx.user.create({
                    data: {
                        username: username!,
                        passwordHash,
                        role: role || 'EMPLOYEE',
                        employeeId: created.id,
                    },
                });
            }

            return created;
        });

        res.status(201).json({
            success: true,
            data: { employee },
            message: 'Employee created successfully',
        });
    })
);

// ─── PUT /api/employees/:id ──────────────────────────────────
// Update employee (HR only)

router.put(
    '/:id',
    authorize('HR'),
    validate(updateEmployeeSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        const existing = await prisma.employee.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Employee not found');

        const { createUser, username, password, role, joinDate, dateOfBirth, managerIds, ...updateData } = req.body as z.infer<typeof updateEmployeeSchema>;

        if ('managerId' in req.body) {
            await validateManagerAssignment(req.body.managerId ?? null, id);
        }

        // Validate each manager in managerIds
        if (managerIds && managerIds.length > 0) {
            for (const mId of managerIds) {
                await validateManagerAssignment(mId, id);
            }
        }

        if (updateData.email) {
            const emailOwner = await prisma.employee.findFirst({
                where: {
                    email: updateData.email,
                    NOT: { id },
                },
                select: { id: true },
            });

            if (emailOwner) {
                throw new ConflictError('An employee with this email already exists');
            }
        }

        const employee = await prisma.employee.update({
            where: { id },
            data: {
                ...updateData,
                skills: updateData.skills ? JSON.stringify(updateData.skills) : undefined,
                biometricId: 'biometricId' in req.body ? (req.body.biometricId ?? null) : undefined,
                joinDate: 'joinDate' in req.body ? (joinDate ? new Date(joinDate) : null) : undefined,
                dateOfBirth: 'dateOfBirth' in req.body ? toDateOfBirth(dateOfBirth) : undefined,
                // Explicitly handle null to clear the manager relation
                managerId: 'managerId' in req.body ? (req.body.managerId ?? null) : undefined,
            },
        });

        // Update multiple managers if provided
        if ('managerIds' in req.body && managerIds !== undefined) {
            // Clear existing managers and add new ones
            await prisma.employeeManager.deleteMany({
                where: { employeeId: id },
            });

            if (managerIds.length > 0) {
                await prisma.employeeManager.createMany({
                    data: managerIds.map(managerId => ({
                        employeeId: id,
                        managerId,
                    })),
                });
            }
        }

        // Handle user account creation / updating
        if (createUser && username) {
            const existingEmployeeUser = await prisma.user.findUnique({
                where: { employeeId: id },
            });

            if (existingEmployeeUser) {
                if (existingEmployeeUser.username !== username || password) {
                    throw new ForbiddenError('Only the account owner can change username or password');
                }

                const dataToUpdate = {
                    role: role || undefined,
                    isActive: true,
                };

                await prisma.user.update({
                    where: { id: existingEmployeeUser.id },
                    data: dataToUpdate,
                });
            } else {
                if (!password) {
                    throw new BadRequestError('Password is required to create a new user account');
                }

                const taken = await prisma.user.findUnique({ where: { username } });
                if (taken) throw new ConflictError('Username is already taken');

                const passwordHash = await hashPassword(password);
                await prisma.user.create({
                    data: {
                        username,
                        passwordHash,
                        role: role || 'EMPLOYEE',
                        employeeId: id,
                    },
                });
            }
        } else if (role && !createUser) {
            const existingEmployeeUser = await prisma.user.findUnique({
                where: { employeeId: id },
            });
            if (existingEmployeeUser) {
                await prisma.user.update({
                    where: { id: existingEmployeeUser.id },
                    data: { role },
                });
            }
        }

        res.json({
            success: true,
            data: { employee },
            message: 'Employee updated successfully',
        });
    })
);

// ─── PUT /api/employees/:id/payroll-details ──────────────────
// Self-service statutory/payroll fields — editable by HR OR the employee
// themselves (their own record only). None of these fields are mandatory.

const payrollDetailsSchema = z.object({
    employeeNumber: z.string().max(50).optional().nullable(),
    panNumber: z.string().max(20).optional().nullable(),
    uanNumber: z.string().max(20).optional().nullable(),
    pfAccountNumber: z.string().max(50).optional().nullable(),
    esiNumber: z.string().max(50).optional().nullable(),
    pranNumber: z.string().max(50).optional().nullable(),
    taxRegime: z.string().max(50).optional().nullable(),
    bankAccountNumber: z.string().max(50).optional().nullable(),
    bankIfscCode: z.string().max(20).optional().nullable(),
    bankBranch: z.string().max(100).optional().nullable(),
});

const profileDetailsSchema = z.object({
    bio: z.string().max(5000).nullable(),
    skills: z.array(z.string().trim().min(1).max(100)).max(50),
    education: z.string().max(1000).nullable(),
    experience: z.string().max(5000).nullable(),
    dateOfBirth: dateOfBirthSchema.nullable().optional(),
});

router.put(
    '/:id/profile-details',
    validate(profileDetailsSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        const isSelf = req.user!.employeeId === id;
        const isHR = req.user!.role === 'HR';
        if (!isSelf && !isHR) {
            throw new ForbiddenError('You can only update your own profile details');
        }

        const data = req.body as z.infer<typeof profileDetailsSchema>;
        const employee = await prisma.employee.update({
            where: { id },
            data: {
                bio: data.bio?.trim() || null,
                skills: JSON.stringify(data.skills),
                education: data.education?.trim() || null,
                experience: data.experience?.trim() || null,
                ...('dateOfBirth' in data ? { dateOfBirth: toDateOfBirth(data.dateOfBirth) } : {}),
            },
            select: { id: true, bio: true, skills: true, education: true, experience: true, dateOfBirth: true },
        });

        res.json({ success: true, data: { employee }, message: 'Profile details updated' });
    })
);

router.put(
    '/:id/payroll-details',
    validate(payrollDetailsSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        const isSelf = req.user!.employeeId === id;
        const isHR = req.user!.role === 'HR';
        if (!isSelf && !isHR) {
            throw new ForbiddenError('You can only update your own payroll details');
        }

        const existing = await prisma.employee.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Employee not found');

        const data = req.body as z.infer<typeof payrollDetailsSchema>;
        const changed = PAYROLL_FIELDS.filter(
            (field) => field in data && (data[field] ?? null) !== (existing[field] ?? null)
        );

        const employee = await prisma.employee.update({
            where: { id },
            data,
            select: {
                id: true,
                employeeNumber: true,
                panNumber: true,
                uanNumber: true,
                pfAccountNumber: true,
                esiNumber: true,
                pranNumber: true,
                taxRegime: true,
                bankAccountNumber: true,
                bankIfscCode: true,
                bankBranch: true,
            },
        });

        // An employee changing their own bank/PAN details is a salary-redirection risk, so HR is
        // told exactly what changed (masked old → new) and can verify before the next payroll run.
        if (!isHR && changed.length > 0) {
            await notify({
                recipientIds: await getHrUserIds(),
                excludeUserId: req.user!.userId,
                type: 'PAYROLL_DETAILS_CHANGED',
                title: `${existing.name} changed their payroll details`,
                message: changed
                    .map((field) => `${PAYROLL_FIELD_LABELS[field]}: ${maskValue(existing[field])} → ${maskValue(data[field])}`)
                    .join('; '),
                entityId: id,
                employeeId: id,
            });
        }

        res.json({
            success: true,
            data: { employee },
            message: 'Payroll details updated',
        });
    })
);

// ─── DELETE /api/employees/:id ───────────────────────────────
router.post(
    '/:id/avatar',
    authorize('HR'),
    upload.single('avatar'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        const existing = await prisma.employee.findUnique({
            where: { id },
            select: { id: true, isActive: true },
        });
        if (!existing || !existing.isActive) {
            throw new NotFoundError('Employee not found');
        }

        if (!req.file) {
            throw new BadRequestError('No avatar image uploaded');
        }

        const avatar = await storeAvatarFile(req.file, `employee-${id}`);

        const employee = await prisma.employee.update({
            where: { id },
            data: { avatar },
            select: { id: true, avatar: true },
        });

        res.json({
            success: true,
            data: { avatar: employee.avatar },
            message: 'Employee photo updated successfully',
        });
    })
);

// Soft-delete employee (HR only)

router.delete(
    '/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        const existing = await prisma.employee.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Employee not found');

        // Soft delete — set isActive to false
        await prisma.employee.update({
            where: { id },
            data: { isActive: false },
        });

        // Also deactivate linked user account
        await prisma.user.updateMany({
            where: { employeeId: id },
            data: { isActive: false },
        });

        res.json({
            success: true,
            message: 'Employee deactivated successfully',
        });
    })
);

// ─── PUT /api/employees/:id/payroll-access ───────────────────
// HR grants/revokes payroll-sheet upload access for an Accounts-department employee.

router.put(
    '/:id/payroll-access',
    authorize('HR'),
    validate(z.object({ enabled: z.boolean() })),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');
        const { enabled } = req.body as { enabled: boolean };

        const employee = await prisma.employee.findUnique({
            where: { id },
            select: { name: true, department: true, isActive: true, user: { select: { id: true, role: true } } },
        });
        if (!employee || !employee.isActive) throw new NotFoundError('Employee not found');
        if (!employee.user) {
            throw new BadRequestError(`${employee.name} has no login account — create one first`);
        }
        if (enabled && !isAccountsDepartment(employee.department)) {
            throw new BadRequestError('Payroll upload access can only be given to Accounts department employees');
        }

        await prisma.user.update({
            where: { id: employee.user.id },
            data: { canImportPayroll: enabled },
        });

        res.json({
            success: true,
            message: enabled
                ? `${employee.name} can now upload payroll sheets`
                : `Payroll upload access removed for ${employee.name}`,
            data: { canImportPayroll: enabled },
        });
    })
);

// ─── DELETE /api/employees/:id/permanent ─────────────────────
// Permanently remove an employee (HR only). Irreversible: the employee's attendance,
// leaves, salary slips, documents, KRAs, learning records and badges are deleted with
// them (DB-level cascades); direct reports keep working with no manager set.
// The linked login is deleted too — unless that user authored shared records
// (announcements, courses, payroll imports, ...) the DB won't let go of, in which case
// it is kept deactivated and unlinked so that history stays intact.

router.delete(
    '/:id/permanent',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        if (req.user!.employeeId === id) {
            throw new ForbiddenError('You cannot delete your own employee record');
        }

        const existing = await prisma.employee.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                user: { select: { id: true, role: true, isActive: true } },
                documents: { select: { storageKey: true } },
            },
        });
        if (!existing) throw new NotFoundError('Employee not found');

        const linkedUser = existing.user;

        if (linkedUser?.role === 'HR' && linkedUser.isActive) {
            const otherActiveHr = await prisma.user.count({
                where: { role: 'HR', isActive: true, id: { not: linkedUser.id } },
            });
            if (otherActiveHr === 0) {
                throw new BadRequestError('Cannot delete the last active HR account');
            }
        }

        // Records that reference the user with ON DELETE RESTRICT — if any exist the
        // login can't be removed without destroying shared history.
        let userHasAuthoredRecords = false;
        if (linkedUser) {
            const userId = linkedUser.id;
            const counts = await Promise.all([
                prisma.announcement.count({ where: { createdById: userId } }),
                prisma.attendanceCorrection.count({ where: { editedById: userId } }),
                prisma.badge.count({ where: { createdById: userId } }),
                prisma.course.count({ where: { createdById: userId } }),
                prisma.employeeDocument.count({ where: { uploadedById: userId } }),
                prisma.employeeDocumentDownload.count({ where: { downloadedById: userId } }),
                prisma.heroBanner.count({ where: { createdById: userId } }),
                prisma.iLTSession.count({ where: { createdById: userId } }),
                prisma.learningPath.count({ where: { createdById: userId } }),
                prisma.libraryDocument.count({ where: { uploadedById: userId } }),
                prisma.payrollImportLog.count({ where: { importedById: userId } }),
            ]);
            userHasAuthoredRecords = counts.some((count) => count > 0);
        }

        await prisma.$transaction(async (tx) => {
            if (linkedUser) {
                if (userHasAuthoredRecords) {
                    await tx.user.update({
                        where: { id: linkedUser.id },
                        data: { isActive: false, employeeId: null },
                    });
                } else {
                    await tx.user.delete({ where: { id: linkedUser.id } });
                }
            }
            await tx.employee.delete({ where: { id } });
        });

        // Stored document files aren't covered by the DB cascade — clean them up best-effort.
        await Promise.all(
            existing.documents
                .filter((document) => document.storageKey)
                .map((document) => removePrivateUploadFile(document.storageKey!).catch(() => {}))
        );

        const loginNote = !linkedUser
            ? ''
            : userHasAuthoredRecords
                ? ' Their login was deactivated (kept because they authored shared records).'
                : ' Their login account was removed.';

        res.json({
            success: true,
            message: `${existing.name} was permanently deleted.${loginNote}`,
            data: {
                userAccount: !linkedUser ? 'none' : userHasAuthoredRecords ? 'deactivated' : 'deleted',
            },
        });
    })
);

// ─── GET /api/employees/:id/team ─────────────────────────────
// Get direct reports (for managers)

router.get(
    '/:id/team',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid employee ID');

        const scope = req.dataScope!;
        if (scope.type === 'self') {
            throw new ForbiddenError('Employees cannot view team data');
        }

        if (scope.type === 'team') {
            await assertCanAccessEmployee(req, id, {
                self: 'Employees cannot view team data',
                team: 'You can only view teams within your reporting hierarchy',
            });
        }

        const descendantIds = await getDescendantEmployeeIds(id);
        const team = await prisma.employee.findMany({
            where: {
                id: { in: descendantIds },
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                position: true,
                department: true,
                email: true,
                phone: true,
                avatar: true,
                joinDate: true,
                managerId: true,
            },
            orderBy: { name: 'asc' },
        });

        res.json({
            success: true,
            data: { team, count: team.length },
        });
    })
);

export default router;
