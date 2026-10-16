import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';
import { isProd } from '../config/env.js';

/**
 * Expected failures that aren't AppErrors (DB constraints, upload limits, bad input) get a
 * clear message and status instead of a generic 500.
 */
function toClientError(err: Error): { status: number; message: string } | null {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') return { status: 409, message: 'That value is already in use by another record' };
        if (err.code === 'P2025') return { status: 404, message: 'The record was not found — it may have been deleted' };
        if (err.code === 'P2003') return { status: 400, message: 'This refers to a record that does not exist' };
    }
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return { status: 413, message: 'That file is too large to upload' };
        return { status: 400, message: `Upload rejected: ${err.message}` };
    }
    if (err instanceof ZodError) {
        return { status: 400, message: `Validation failed: ${err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}` };
    }
    // body-parser failures (malformed JSON, body over the 10 MB limit)
    const bodyErrorType = (err as { type?: string }).type;
    if (bodyErrorType === 'entity.parse.failed') return { status: 400, message: 'Malformed request body' };
    if (bodyErrorType === 'entity.too.large') return { status: 413, message: 'Request is too large' };
    return null;
}

/**
 * Centralized error handling middleware.
 *
 * - Operational errors (AppError): return clean JSON with appropriate status.
 * - Unknown errors in production: return generic 500 (no stack traces leaked).
 * - Unknown errors in development: return full details for debugging.
 */
export function errorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
): void {
    // Log all errors
    console.error(`[ERROR] ${err.message}`, isProd ? '' : err.stack);

    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            error: err.message,
        });
        return;
    }

    const clientError = toClientError(err);
    if (clientError) {
        res.status(clientError.status).json({ success: false, error: clientError.message });
        return;
    }

    // Unknown/unexpected errors
    const statusCode = 500;
    const message = isProd
        ? 'An unexpected error occurred'
        : err.message || 'Internal server error';

    res.status(statusCode).json({
        success: false,
        error: message,
        // Only include stack trace in development
        ...(isProd ? {} : { stack: err.stack }),
    });
}

/**
 * Async route handler wrapper.
 * Catches async errors and forwards them to the error handler.
 * 
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
