import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import employeeRouter from './routes/employees.js';
import leaveRouter from './routes/leaves.js';
import attendanceRouter from './routes/attendance.js';
import attendanceCorrectionRouter from './routes/attendanceCorrections.js';
import salaryRouter from './routes/salary.js';
import announcementRouter from './routes/announcements.js';
import heroBannerRouter from './routes/heroBanners.js';
import performanceRouter from './routes/performance.js';
import holidayRouter from './routes/holidays.js';
import learningRouter from './routes/learning.js';
import iltRouter from './routes/ilt.js';
import badgeRouter from './routes/badges.js';
import documentRouter from './routes/documents.js';
import notificationRouter from './routes/notifications.js';
import libraryRouter from './routes/library.js';
import dashboardRouter from './routes/dashboard.js';
import cronRouter from './routes/cron.js';

const app = express();

// ─── SECURITY MIDDLEWARE ─────────────────────────────────────

// Helmet: sets various HTTP security headers
// - X-Content-Type-Options: nosniff
// - X-Frame-Options: DENY
// - X-XSS-Protection
// - Strict-Transport-Security
// - And more...
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
);

// CORS: only allow requests from our frontend
app.use(
    cors({
        origin: env.FRONTEND_URL,
        credentials: true, // allow httpOnly cookies
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// Trust the first hop from the reverse proxy so rate-limiting uses the real
// client IP from X-Forwarded-For rather than the proxy's IP (which would pool
// all users together on shared hosting / office networks).
app.set('trust proxy', 1);

// Global rate limiter: 500 requests per 15 minutes per IP
app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 500,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Too many requests, please try again later' },
    })
);

// ─── BODY PARSING ────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// ─── HEALTH CHECK ────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        message: 'Autoform Connect API is running',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
    });
});

// ─── ROUTES ──────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/employees', employeeRouter);
app.use('/api/leaves', leaveRouter);
// Before attendanceRouter, whose GET /:employeeId would otherwise swallow /corrections.
app.use('/api/attendance/corrections', attendanceCorrectionRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/salary', salaryRouter);
app.use('/api/announcements', announcementRouter);
app.use('/api/hero-banners', heroBannerRouter);
app.use('/api/performance', performanceRouter);
app.use('/api/holidays', holidayRouter);
app.use('/api/learning', learningRouter);
app.use('/api/ilt', iltRouter);
app.use('/api/badges', badgeRouter);
app.use('/api/documents', documentRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/library', libraryRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/cron', cronRouter);

// ─── ERROR HANDLING ──────────────────────────────────────────

// 404 handler for unknown routes
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
    });
});

// Centralized error handler (must be last)
app.use(errorHandler);

export default app;
