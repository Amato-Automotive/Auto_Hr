import 'dotenv/config';
import app from './app.js';
import { env } from './config/env.js';
import prisma from './config/db.js';
import { startAnnouncementScheduler } from './utils/announcementScheduler.js';
import { startLearningReminderScheduler } from './utils/learningReminderScheduler.js';
import { startLearningAutoAssignScheduler } from './utils/learningAutoAssignScheduler.js';
import { startCertificateExpiryScheduler } from './utils/certificateExpiryScheduler.js';

let announcementScheduler: NodeJS.Timeout | null = null;
let learningReminderScheduler: NodeJS.Timeout | null = null;
let learningAutoAssignScheduler: NodeJS.Timeout | null = null;
let certificateExpiryScheduler: NodeJS.Timeout | null = null;

/**
 * Server entry point.
 * Validates environment, tests DB connection, then starts listening.
 */
async function main() {
    try {
        // Test database connection
        await prisma.$connect();
        console.log('✅ Database connected');

        // Start server
        app.listen(env.PORT, () => {
            console.log(`✅ Autoform Connect API running on port ${env.PORT}`);
            console.log(`   Environment: ${env.NODE_ENV}`);
            console.log(`   Frontend URL: ${env.FRONTEND_URL}`);
            console.log(`   Health check: http://localhost:${env.PORT}/api/health`);
            announcementScheduler = startAnnouncementScheduler();
            learningReminderScheduler = startLearningReminderScheduler();
            learningAutoAssignScheduler = startLearningAutoAssignScheduler();
            certificateExpiryScheduler = startCertificateExpiryScheduler();
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('⏳ Shutting down...');
    if (announcementScheduler) clearInterval(announcementScheduler);
    if (learningReminderScheduler) clearInterval(learningReminderScheduler);
    if (learningAutoAssignScheduler) clearInterval(learningAutoAssignScheduler);
    if (certificateExpiryScheduler) clearInterval(certificateExpiryScheduler);
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('⏳ Shutting down...');
    if (announcementScheduler) clearInterval(announcementScheduler);
    if (learningReminderScheduler) clearInterval(learningReminderScheduler);
    if (learningAutoAssignScheduler) clearInterval(learningAutoAssignScheduler);
    if (certificateExpiryScheduler) clearInterval(certificateExpiryScheduler);
    await prisma.$disconnect();
    process.exit(0);
});

main();
