import { z } from 'zod';

/**
 * Environment configuration with validation.
 * Fails fast on startup if required variables are missing.
 */

// z.coerce.boolean() treats any non-empty string (including "false") as true.
// Env vars are always strings, so booleans must be parsed from "true"/"false" text instead.
const booleanString = (defaultValue: boolean) =>
    z
        .enum(['true', 'false'])
        .optional()
        .default(String(defaultValue) as 'true' | 'false')
        .transform((val) => val === 'true');

const envSchema = z.object({
    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // JWT
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('24h'),

    // SMTP (optional — features degrade gracefully)
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().optional().default(587),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    SMTP_FROM: z.string().optional().default(''),

    // Server
    PORT: z.coerce.number().default(3001),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // CORS
    FRONTEND_URL: z.string().default('http://localhost:5173'),

    // Salary / payroll integration
    SALARY_API_KEY: z.string().default(''),

    // Vercel Cron: shared secret Vercel sends as `Authorization: Bearer <CRON_SECRET>`
    CRON_SECRET: z.string().optional().default(''),
    SALARY_ENCRYPTION_KEY: z.string().default(''),

    // Upload storage (avatars, other public assets)
    UPLOAD_STORAGE_DRIVER: z.enum(['local', 'hostinger-ftp']).default('local'),
    UPLOAD_PUBLIC_BASE_URL: z.string().optional().default(''),
    FTP_HOST: z.string().optional().default(''),
    FTP_PORT: z.coerce.number().optional().default(21),
    FTP_USER: z.string().optional().default(''),
    FTP_PASSWORD: z.string().optional().default(''),
    FTP_SECURE: booleanString(false),
    FTP_REMOTE_ROOT: z.string().optional().default('/public_html/uploads'),
    FTP_PRIVATE_REMOTE_ROOT: z.string().optional().default('/private-uploads'),

    // Biometric push receiver (src/biometricServer.ts)
    BIOMETRIC_PORT: z.coerce.number().default(5005),
    /** Comma-separated device serials allowed to push (e.g. "S/N102019100001698"). Empty = any. */
    BIOMETRIC_ALLOWED_SERIALS: z.string().optional().default(''),
});

// Load and validate environment variables
function loadEnv() {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        for (const error of result.error.errors) {
            console.error(`   ${error.path.join('.')}: ${error.message}`);
        }
        process.exit(1);
    }

    return result.data;
}

export const env = loadEnv();

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
