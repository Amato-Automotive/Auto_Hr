import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import multer from 'multer';
import prisma from '../config/db.js';
import { signToken } from '../utils/jwt.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { UnauthorizedError, BadRequestError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { storeAvatarFile } from '../utils/avatarStorage.js';
import { generateOtp, hashOtp, verifyOtp } from '../utils/otp.js';
import { sendOtpEmail } from '../utils/mailer.js';
import { canUserImportPayroll, hasPayrollImportAccess } from '../utils/payrollAccess.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 * 1024 * 1024 } });

// ─── Stricter rate limit for login (30 attempts per 15 min) ─
// 30 gives reasonable brute-force protection while allowing a
// shared-office / VPN environment where many users log in from
// the same exit IP within a 15-minute window.

// Only failed attempts count, and per username + IP: the whole office shares one exit IP, so a
// morning login rush (all successful) or one person mistyping can't lock everyone else out.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip ?? ''}|${String(req.body?.username ?? '').toLowerCase()}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many login attempts. Please try again after 15 minutes.',
    },
});

// ─── Rate limit for password reset requests (20 per 15 min) ─

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many password reset attempts. Please try again after 15 minutes.',
    },
});

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

// ─── Validation schemas ──────────────────────────────────────

const loginSchema = z.object({
    username: z.string().min(1, 'Username is required').max(50),
    password: z.string().min(1, 'Password is required').max(128),
});

const forgotPasswordSchema = z.object({
    username: z.string().min(1, 'Username is required').max(50),
});

const resetPasswordSchema = z.object({
    username: z.string().min(1, 'Username is required').max(50),
    otp: z.string().length(6, 'Enter the 6-digit code'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').max(128),
});

// ─── POST /api/auth/login ────────────────────────────────────

router.post(
    '/login',
    loginLimiter,
    validate(loginSchema),
    asyncHandler(async (req, res) => {
        const { username, password } = req.body as z.infer<typeof loginSchema>;

        // Find user by username
        const user = await prisma.user.findUnique({
            where: { username },
            include: {
                employee: {
                    select: {
                        id: true,
                        name: true,
                        position: true,
                        department: true,
                        avatar: true,
                        gender: true,
                    },
                },
            },
        });

        if (!user || !user.isActive) {
            // Generic message to prevent user enumeration
            throw new UnauthorizedError('Invalid username or password');
        }

        // Verify password
        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            throw new UnauthorizedError('Invalid username or password');
        }

        // Generate JWT
        const token = signToken({
            userId: user.id,
            role: user.role,
            employeeId: user.employeeId,
        });

        // Set httpOnly cookie (more secure than localStorage)
        res.cookie('token', token, {
            httpOnly: true,      // JavaScript cannot access this cookie
            secure: env.NODE_ENV === 'production',  // HTTPS only in prod
            sameSite: 'lax',     // CSRF protection
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        // Also return token in body (for mobile/SPA use)
        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    employeeId: user.employeeId,
                    employee: user.employee,
                    canImportPayroll: await canUserImportPayroll(user.id, user.role),
                },
            },
        });
    })
);

// ─── POST /api/auth/forgot-password ──────────────────────────
// Sends a 6-digit OTP to the user's registered employee email

router.post(
    '/forgot-password',
    passwordResetLimiter,
    validate(forgotPasswordSchema),
    asyncHandler(async (req, res) => {
        const { username } = req.body as z.infer<typeof forgotPasswordSchema>;

        const user = await prisma.user.findUnique({
            where: { username },
            include: { employee: { select: { email: true } } },
        });

        // Always return a generic success message to prevent username/email enumeration
        const genericResponse = {
            success: true,
            message: 'If that account has a registered email, an OTP has been sent to it.',
        };

        if (!user || !user.isActive || !user.employee?.email) {
            res.json(genericResponse);
            return;
        }

        const otp = generateOtp();
        const otpHash = await hashOtp(otp);

        await prisma.passwordResetOtp.create({
            data: {
                userId: user.id,
                otpHash,
                expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
            },
        });

        await sendOtpEmail(user.employee.email, otp);

        res.json(genericResponse);
    })
);

// ─── POST /api/auth/reset-password ───────────────────────────
// Verifies the OTP and sets a new password

router.post(
    '/reset-password',
    passwordResetLimiter,
    validate(resetPasswordSchema),
    asyncHandler(async (req, res) => {
        const { username, otp, newPassword } = req.body as z.infer<typeof resetPasswordSchema>;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user || !user.isActive) {
            throw new BadRequestError('Invalid or expired code');
        }

        const otpRecord = await prisma.passwordResetOtp.findFirst({
            where: { userId: user.id, usedAt: null, expiresAt: { gte: new Date() } },
            orderBy: { createdAt: 'desc' },
        });

        if (!otpRecord) {
            throw new BadRequestError('Invalid or expired code');
        }

        if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
            throw new BadRequestError('Too many incorrect attempts. Please request a new code.');
        }

        const isValid = await verifyOtp(otp, otpRecord.otpHash);
        if (!isValid) {
            await prisma.passwordResetOtp.update({
                where: { id: otpRecord.id },
                data: { attempts: { increment: 1 } },
            });
            throw new BadRequestError('Invalid or expired code');
        }

        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: await hashPassword(newPassword) },
            }),
            prisma.passwordResetOtp.update({
                where: { id: otpRecord.id },
                data: { usedAt: new Date() },
            }),
        ]);

        res.json({
            success: true,
            message: 'Password reset successfully. You can now log in.',
        });
    })
);

// ─── GET /api/auth/me ────────────────────────────────────────

router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
        const record = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: {
                id: true,
                username: true,
                role: true,
                employeeId: true,
                isActive: true,
                canImportPayroll: true,
                employee: {
                    select: {
                        id: true,
                        name: true,
                        position: true,
                        department: true,
                        email: true,
                        avatar: true,
                        gender: true,
                        isActive: true,
                    },
                },
            },
        });

        if (!record) {
            throw new UnauthorizedError('User not found');
        }

        // Payroll access is derived from the row we already have — no second lookup on every page load.
        const { isActive: _isActive, canImportPayroll: _flag, employee, ...user } = record;
        res.json({
            success: true,
            data: {
                user: {
                    ...user,
                    employee: employee && (({ isActive: _employeeActive, ...rest }) => rest)(employee),
                    canImportPayroll: hasPayrollImportAccess(record),
                },
            },
        });
    })
);

// ─── POST /api/auth/logout ───────────────────────────────────

router.post('/logout', (_req, res) => {
    // Clear the httpOnly cookie
    res.clearCookie('token', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
    });

    res.json({
        success: true,
        message: 'Logged out successfully',
    });
});

const updateCredentialsSchema = z.object({
    username: z.string().min(1, 'Username cannot be empty').max(50).optional(),
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').max(128).optional(),
});

// ─── PUT /api/auth/credentials ────────────────────────────────

router.put(
    '/credentials',
    authenticate,
    validate(updateCredentialsSchema),
    asyncHandler(async (req, res) => {
        const { username, currentPassword, newPassword } = req.body as z.infer<typeof updateCredentialsSchema>;

        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
        });

        if (!user) {
            throw new UnauthorizedError('User not found');
        }

        // Verify current password
        const isValid = await verifyPassword(currentPassword, user.passwordHash);
        if (!isValid) {
            throw new BadRequestError('Incorrect current password');
        }

        const dataToUpdate: any = {};

        if (username && username !== user.username) {
            // Check if username is taken
            const taken = await prisma.user.findUnique({
                where: { username },
            });
            if (taken) {
                throw new BadRequestError('Username is already taken');
            }
            dataToUpdate.username = username;
        }

        if (newPassword) {
            dataToUpdate.passwordHash = await hashPassword(newPassword);
        }

        // If no changes, return early
        if (Object.keys(dataToUpdate).length === 0) {
            res.json({
                success: true,
                message: 'No changes provided',
            });
            return;
        }

        await prisma.user.update({
            where: { id: user.id },
            data: dataToUpdate,
        });

        res.json({
            success: true,
            message: 'Credentials updated successfully',
        });
    })
);

// â”€â”€â”€ POST /api/auth/avatar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post(
    '/avatar',
    authenticate,
    upload.single('avatar'),
    asyncHandler(async (req, res) => {
        if (!req.user?.employeeId) {
            throw new BadRequestError('Your account is not linked to an employee profile');
        }

        if (!req.file) {
            throw new BadRequestError('No avatar image uploaded');
        }

        const avatar = await storeAvatarFile(req.file, `employee-${req.user.employeeId}`);

        const employee = await prisma.employee.update({
            where: { id: req.user.employeeId },
            data: { avatar },
            select: {
                id: true,
                avatar: true,
            },
        });

        res.json({
            success: true,
            data: { avatar: employee.avatar },
            message: 'Profile photo updated successfully',
        });
    })
);

export default router;
