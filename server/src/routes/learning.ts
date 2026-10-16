import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import prisma from '../config/db.js';
import { authenticate, authorize, scopeData, getScopedEmployeeIds, assertCanAccessEmployee } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError, BadRequestError, ForbiddenError, TooManyRequestsError } from '../utils/errors.js';
import { classifyLink } from '../utils/linkEmbed.js';
import { putUploadFile, extensionForMimeType } from '../utils/uploadStorage.js';
import { notify, getEmployeeUserIdMap, hasReceivedLearningNotificationToday, getManagerAndHrUserIds, getAudienceUserIds, notifyEmployeesBulk } from '../utils/notificationService.js';
import { sendLearningReminderEmail } from '../utils/mailer.js';
import { resolveGradeLabel, evaluateAttemptBadges, evaluateCourseCompletionBadges, evaluatePathCompletionBadges, evaluateModuleCompletionBadges } from '../utils/badgeService.js';
import { Prisma } from '@prisma/client';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});

router.use(authenticate, scopeData);

// ─── Validation schemas ──────────────────────────────────────

// Course/path create forms are multipart, so booleans arrive as the text "true"/"false".
// z.coerce.boolean() would turn "false" into true (any non-empty string is truthy).
const formBoolean = z.preprocess(
    (value) => (value === 'true' ? true : value === 'false' ? false : value),
    z.boolean()
);

const createCourseSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().optional(),
    category: z.string().max(100).optional(),
    skillTags: z.string().max(500).optional(),
    durationMinutes: z.coerce.number().int().nonnegative().optional(),
    language: z.string().max(50).optional(),
    mandatory: formBoolean.optional(),
    targetDepartment: z.string().max(100).optional(),
    navigationMode: z.enum(['FREE', 'SEQUENTIAL']).optional(),
    autoAssign: formBoolean.optional(),
    autoAssignDueDays: z.coerce.number().int().positive().optional(),
    certificateValidityMonths: z.coerce.number().int().positive().optional(),
    enableRanking: formBoolean.optional(),
    rankingScope: z.enum(['DEPARTMENT', 'ORG_WIDE']).optional(),
    rankingAnonymous: formBoolean.optional(),
    rankingMinCohortSize: z.coerce.number().int().positive().optional(),
    requiresApproval: formBoolean.optional(),
    certificatesPerModule: formBoolean.optional(),
});

const updateCourseSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    skillTags: z.string().max(500).nullable().optional(),
    durationMinutes: z.number().int().nonnegative().nullable().optional(),
    language: z.string().max(50).nullable().optional(),
    mandatory: z.boolean().optional(),
    targetDepartment: z.string().max(100).nullable().optional(),
    navigationMode: z.enum(['FREE', 'SEQUENTIAL']).optional(),
    autoAssign: z.boolean().optional(),
    autoAssignDueDays: z.number().int().positive().nullable().optional(),
    certificateValidityMonths: z.number().int().positive().nullable().optional(),
    enableRanking: z.boolean().optional(),
    rankingScope: z.enum(['DEPARTMENT', 'ORG_WIDE']).optional(),
    rankingAnonymous: z.boolean().optional(),
    rankingMinCohortSize: z.number().int().positive().optional(),
    requiresApproval: z.boolean().optional(),
    certificatesPerModule: z.boolean().optional(),
}).refine(
    (data) => !(data.mandatory === true && data.enableRanking === true),
    { message: 'Ranking cannot be enabled on a mandatory course' }
);

const createModuleSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    contentType: z.enum(['VIDEO_FILE', 'VIDEO_EMBED', 'DOCUMENT', 'QUIZ']),
    videoLink: z.string().optional(),
    durationMinutes: z.coerce.number().int().nonnegative().optional(),
    sortOrder: z.coerce.number().int().nonnegative().optional(),
});

// ─── GET /api/learning/courses ────────────────────────────────
// Catalog list — published courses visible to the viewer's department (or all-department courses)

router.get(
    '/courses',
    asyncHandler(async (req, res) => {
        const { role, employeeId } = req.user!;
        const seesAll = role === 'HR' || role === 'LEADERSHIP';

        let viewerDepartment: string | null = null;
        if (!seesAll && employeeId) {
            const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { department: true } });
            viewerDepartment = employee?.department || null;
        }

        const courses = await prisma.course.findMany({
            where: {
                ...(seesAll ? {} : {
                    state: 'PUBLISHED',
                    OR: [
                        { targetDepartment: null },
                        ...(viewerDepartment ? [{ targetDepartment: viewerDepartment }] : []),
                    ],
                }),
            },
            include: {
                createdBy: { select: { username: true } },
                modules: { select: { id: true }, orderBy: { sortOrder: 'asc' } },
                _count: { select: { enrollments: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ success: true, data: { courses } });
    })
);

/**
 * Loads a course's modules → quiz → questions → options tree with the four levels fetched in
 * parallel and stitched together in memory. Prisma's nested `include` would issue one query per
 * level strictly in sequence (and MariaDB can't use relation joins), so this turns ~5 round trips
 * into 1 for the course player. Output matches
 * `modules: { orderBy: sortOrder, include: { quiz: { include: { questions: { include: { options }, orderBy: sortOrder } } } } }`.
 */
async function loadCourseModuleTree(courseWhere: Prisma.CourseWhereInput) {
    const [modules, quizzes, questions, options] = await Promise.all([
        prisma.courseModule.findMany({ where: { course: courseWhere }, orderBy: { sortOrder: 'asc' } }),
        prisma.quiz.findMany({ where: { module: { course: courseWhere } } }),
        prisma.quizQuestion.findMany({ where: { quiz: { module: { course: courseWhere } } }, orderBy: { sortOrder: 'asc' } }),
        prisma.quizOption.findMany({ where: { question: { quiz: { module: { course: courseWhere } } } }, orderBy: { id: 'asc' } }),
    ]);

    const optionsByQuestion = new Map<number, typeof options>();
    for (const option of options) {
        const list = optionsByQuestion.get(option.questionId) ?? [];
        list.push(option);
        optionsByQuestion.set(option.questionId, list);
    }
    const questionsByQuiz = new Map<number, (typeof questions[number] & { options: typeof options })[]>();
    for (const question of questions) {
        const list = questionsByQuiz.get(question.quizId) ?? [];
        list.push({ ...question, options: optionsByQuestion.get(question.id) ?? [] });
        questionsByQuiz.set(question.quizId, list);
    }
    const quizByModule = new Map(quizzes.map((quiz) => [quiz.moduleId, { ...quiz, questions: questionsByQuiz.get(quiz.id) ?? [] }]));

    return modules.map((module) => ({ ...module, quiz: quizByModule.get(module.id) ?? null }));
}

// ─── GET /api/learning/courses/:id ────────────────────────────

router.get(
    '/courses/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid course ID');

        const [courseRow, modules] = await Promise.all([
            prisma.course.findUnique({
                where: { id },
                include: { createdBy: { select: { username: true } } },
            }),
            loadCourseModuleTree({ id }),
        ]);

        if (!courseRow) throw new NotFoundError('Course not found');
        const course = { ...courseRow, modules };

        // Hide correct-answer flags from non-HR viewers (they're about to take the quiz, not edit it)
        if (req.user!.role !== 'HR') {
            for (const module of course.modules) {
                if (module.quiz) {
                    for (const question of module.quiz.questions) {
                        question.options = question.options.map((o) => ({ ...o, isCorrect: false }));
                    }
                }
            }
        }

        res.json({ success: true, data: { course } });
    })
);

// ─── POST /api/learning/courses ───────────────────────────────
// Create course (HR only)

router.post(
    '/courses',
    authorize('HR'),
    upload.single('thumbnail'),
    asyncHandler(async (req, res) => {
        const body = createCourseSchema.parse(req.body);

        if (body.mandatory && body.enableRanking) {
            throw new BadRequestError('Ranking cannot be enabled on a mandatory course');
        }

        let thumbnailUrl: string | null = null;
        if (req.file) {
            const extension = extensionForMimeType(req.file.mimetype);
            thumbnailUrl = await putUploadFile(`course-thumbnails/${randomUUID()}.${extension}`, req.file.buffer);
        }

        const course = await prisma.course.create({
            data: {
                title: body.title,
                description: body.description,
                category: body.category,
                skillTags: body.skillTags,
                durationMinutes: body.durationMinutes,
                language: body.language,
                mandatory: body.mandatory ?? false,
                targetDepartment: body.targetDepartment,
                navigationMode: body.navigationMode ?? 'FREE',
                autoAssign: body.autoAssign ?? false,
                autoAssignDueDays: body.autoAssignDueDays,
                certificateValidityMonths: body.certificateValidityMonths,
                enableRanking: body.enableRanking ?? false,
                rankingScope: body.rankingScope ?? 'DEPARTMENT',
                rankingAnonymous: body.rankingAnonymous ?? true,
                rankingMinCohortSize: body.rankingMinCohortSize ?? 8,
                requiresApproval: body.requiresApproval ?? false,
                certificatesPerModule: body.certificatesPerModule ?? false,
                thumbnailUrl,
                createdById: req.user!.userId,
            },
        });

        res.status(201).json({ success: true, data: { course }, message: 'Course created as draft' });
    })
);

// ─── PUT /api/learning/courses/:id ─────────────────────────────

router.put(
    '/courses/:id',
    authorize('HR'),
    validate(updateCourseSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid course ID');

        const existing = await prisma.course.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Course not found');

        const body = req.body as z.infer<typeof updateCourseSchema>;
        const willBeMandatory = body.mandatory ?? existing.mandatory;
        const willHaveRanking = body.enableRanking ?? existing.enableRanking;
        if (willBeMandatory && willHaveRanking) {
            throw new BadRequestError('Ranking cannot be enabled on a mandatory course');
        }

        const course = await prisma.course.update({
            where: { id },
            data: body,
        });

        const enrolledEmployees = await prisma.enrollment.findMany({
            where: { courseId: id, status: { notIn: ['REJECTED'] } },
            select: { employeeId: true },
        });
        await notifyEmployeesBulk(
            enrolledEmployees.map((e) => e.employeeId),
            'COURSE_CONTENT_UPDATED',
            () => ({
                title: 'Course updated',
                message: `"${course.title}" was updated by HR — you may want to review what changed.`,
                entityId: course.id,
            }),
            req.user!.userId
        );

        res.json({ success: true, data: { course }, message: 'Course updated' });
    })
);

// ─── POST /api/learning/courses/:id/thumbnail ──────────────────

router.post(
    '/courses/:id/thumbnail',
    authorize('HR'),
    upload.single('thumbnail'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid course ID');
        if (!req.file) throw new BadRequestError('A thumbnail image is required');

        const extension = extensionForMimeType(req.file.mimetype);
        const thumbnailUrl = await putUploadFile(`course-thumbnails/${randomUUID()}.${extension}`, req.file.buffer);

        const course = await prisma.course.update({ where: { id }, data: { thumbnailUrl } });

        res.json({ success: true, data: { course }, message: 'Thumbnail updated' });
    })
);

// ─── POST /api/learning/courses/:id/publish ────────────────────

router.post(
    '/courses/:id/publish',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid course ID');

        const existing = await prisma.course.findUnique({ where: { id }, include: { modules: true } });
        if (!existing) throw new NotFoundError('Course not found');
        if (existing.modules.length === 0) throw new BadRequestError('Add at least one module before publishing');

        const course = await prisma.course.update({ where: { id }, data: { state: 'PUBLISHED' } });

        const audienceUserIds = await getAudienceUserIds(course.targetDepartment);
        await notify({
            recipientIds: audienceUserIds,
            type: 'COURSE_PUBLISHED',
            title: 'New course available',
            message: `"${course.title}" is now available to enroll in.`,
            entityId: course.id,
            excludeUserId: req.user!.userId,
        });

        res.json({ success: true, data: { course }, message: 'Course published' });
    })
);

// ─── POST /api/learning/courses/:id/unpublish ──────────────────

router.post(
    '/courses/:id/unpublish',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid course ID');

        const course = await prisma.course.update({ where: { id }, data: { state: 'UNPUBLISHED' } });

        res.json({ success: true, data: { course }, message: 'Course unpublished' });
    })
);

// ─── DELETE /api/learning/courses/:id ──────────────────────────
// Archive (soft "delete") — retains historical enrollments/certificates

router.delete(
    '/courses/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid course ID');

        const course = await prisma.course.update({ where: { id }, data: { state: 'ARCHIVED' } });

        res.json({ success: true, data: { course }, message: 'Course archived' });
    })
);

// ─── POST /api/learning/courses/:id/modules ────────────────────
// Add a module: video file upload, video embed link, or document upload

router.post(
    '/courses/:id/modules',
    authorize('HR'),
    upload.single('file'),
    asyncHandler(async (req, res) => {
        const courseId = parseInt(req.params['id'] as string, 10);
        if (isNaN(courseId)) throw new BadRequestError('Invalid course ID');

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundError('Course not found');

        const body = createModuleSchema.parse(req.body);

        let contentUrl: string | null = null;

        if (body.contentType === 'VIDEO_EMBED') {
            if (!body.videoLink) throw new BadRequestError('A video link is required for an embedded video module');
            const kind = classifyLink(body.videoLink);
            if (kind !== 'VIDEO_EMBED') throw new BadRequestError('Video link must be a YouTube or Vimeo URL');
            contentUrl = body.videoLink;
        } else if (body.contentType === 'VIDEO_FILE' || body.contentType === 'DOCUMENT') {
            if (!req.file) throw new BadRequestError(`A file upload is required for a ${body.contentType.toLowerCase().replace('_', ' ')} module`);
            const extension = extensionForMimeType(req.file.mimetype);
            contentUrl = await putUploadFile(`course-modules/${randomUUID()}.${extension}`, req.file.buffer);
        }
        // QUIZ modules have no contentUrl — quiz questions are attached separately

        const sortOrder = body.sortOrder ?? (await prisma.courseModule.count({ where: { courseId } }));

        const module = await prisma.courseModule.create({
            data: {
                courseId,
                title: body.title,
                contentType: body.contentType,
                contentUrl,
                durationMinutes: body.durationMinutes,
                sortOrder,
            },
        });

        res.status(201).json({ success: true, data: { module }, message: 'Module added' });
    })
);

// ─── DELETE /api/learning/modules/:id ──────────────────────────
// Blocks removing a module that learners have already engaged with (any progress recorded,
// or the course has any non-NOT_STARTED enrollment) unless explicitly confirmed — deleting it
// would silently shift their completion % and could un-complete a course they already finished
// (BRD FR-2.4). HR can still force it (e.g. the module was added in error and no one's touched it).

router.delete(
    '/modules/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid module ID');

        const module = await prisma.courseModule.findUnique({
            where: { id },
            include: {
                moduleProgress: { select: { id: true }, take: 1 },
                course: { select: { id: true, title: true } },
            },
        });
        if (!module) throw new NotFoundError('Module not found');

        const force = req.query['force'] === 'true';
        if (module.moduleProgress.length > 0 && !force) {
            const activeLearnerCount = await prisma.enrollment.count({
                where: { courseId: module.course.id, status: { not: 'NOT_STARTED' } },
            });
            throw new BadRequestError(
                `${activeLearnerCount} learner(s) have already started "${module.course.title}" and may have progress on this module. ` +
                `Removing it will shift their completion. Resubmit with ?force=true to proceed anyway.`
            );
        }

        await prisma.courseModule.delete({ where: { id } });

        res.json({ success: true, message: 'Module removed' });
    })
);

// ─── Quiz authoring (HR only) ───────────────────────────────────

const createQuizSchema = z.object({
    passPercentage: z.number().int().min(1).max(100).default(70),
    maxAttempts: z.number().int().min(1).default(3),
    timeLimitMinutes: z.number().int().positive().optional(),
    randomizeOrder: z.boolean().optional(),
    questions: z.array(z.object({
        questionText: z.string().min(1),
        options: z.array(z.object({
            optionText: z.string().min(1),
            isCorrect: z.boolean(),
        })).min(2, 'Each question needs at least 2 options'),
    })).min(1, 'A quiz needs at least 1 question'),
    gradeBands: z.array(z.object({
        label: z.string().min(1).max(50),
        minScore: z.number().int().min(0).max(100),
    })).optional(),
});

// ─── POST /api/learning/modules/:id/quiz ────────────────────────
// Attach (or replace) a quiz on a QUIZ-type module

router.post(
    '/modules/:id/quiz',
    authorize('HR'),
    validate(createQuizSchema),
    asyncHandler(async (req, res) => {
        const moduleId = parseInt(req.params['id'] as string, 10);
        if (isNaN(moduleId)) throw new BadRequestError('Invalid module ID');

        const module = await prisma.courseModule.findUnique({
            where: { id: moduleId },
            include: { quiz: { include: { attempts: { select: { id: true }, take: 1 } } } },
        });
        if (!module) throw new NotFoundError('Module not found');
        if (module.contentType !== 'QUIZ') throw new BadRequestError('This module is not a quiz module');

        const body = req.body as z.infer<typeof createQuizSchema>;
        const everyQuestionHasACorrectOption = body.questions.every((q) => q.options.some((o) => o.isCorrect));
        if (!everyQuestionHasACorrectOption) {
            throw new BadRequestError('Every question needs at least one correct option');
        }

        // Replacing an existing quiz cascades and wipes everyone's attempt history (BRD FR-2.4) —
        // block it unless explicitly forced once anyone has actually attempted it.
        const force = req.query['force'] === 'true';
        if (module.quiz && module.quiz.attempts.length > 0 && !force) {
            throw new BadRequestError(
                'Learners have already attempted this quiz. Replacing it will erase their attempt history. ' +
                'Resubmit with ?force=true to proceed anyway.'
            );
        }

        // Replace existing quiz (cascades to questions/options) if present
        await prisma.quiz.deleteMany({ where: { moduleId } });

        if (body.gradeBands) {
            const sorted = [...body.gradeBands].sort((a, b) => a.minScore - b.minScore);
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i]!.minScore === sorted[i - 1]!.minScore) {
                    throw new BadRequestError('Grade bands must have distinct minimum scores');
                }
            }
        }

        const quiz = await prisma.quiz.create({
            data: {
                moduleId,
                passPercentage: body.passPercentage,
                maxAttempts: body.maxAttempts,
                timeLimitMinutes: body.timeLimitMinutes,
                randomizeOrder: body.randomizeOrder ?? false,
                questions: {
                    create: body.questions.map((q, qi) => ({
                        questionText: q.questionText,
                        sortOrder: qi,
                        options: { create: q.options.map((o) => ({ optionText: o.optionText, isCorrect: o.isCorrect })) },
                    })),
                },
                gradeBands: body.gradeBands ? { create: body.gradeBands.map((g) => ({ label: g.label, minScore: g.minScore })) } : undefined,
            },
            include: { questions: { include: { options: true } }, gradeBands: { orderBy: { minScore: 'desc' } } },
        });

        res.status(201).json({ success: true, data: { quiz }, message: 'Quiz saved' });
    })
);

// ─── POST /api/learning/quizzes/:id/attempt ─────────────────────
// Submit quiz answers — server grades, records the attempt, evaluates course completion

const submitAttemptSchema = z.object({
    answers: z.array(z.object({
        questionId: z.number().int().positive(),
        selectedOptionIds: z.array(z.number().int().positive()),
    })),
    startedAt: z.string(),
    isAutoSubmit: z.boolean().optional(),
});

router.post(
    '/quizzes/:id/attempt',
    validate(submitAttemptSchema),
    asyncHandler(async (req, res) => {
        const quizId = parseInt(req.params['id'] as string, 10);
        if (isNaN(quizId)) throw new BadRequestError('Invalid quiz ID');

        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            include: { questions: { include: { options: true } }, module: true, gradeBands: true },
        });
        if (!quiz) throw new NotFoundError('Quiz not found');

        const ownEnrollment = await prisma.enrollment.findFirst({
            where: { courseId: quiz.module.courseId, employeeId },
            select: { status: true },
        });
        if (ownEnrollment && ['NOMINATED', 'PENDING_APPROVAL', 'REJECTED'].includes(ownEnrollment.status)) {
            throw new BadRequestError('This enrollment is not yet active');
        }

        const priorAttempts = await prisma.quizAttempt.count({ where: { quizId, employeeId } });
        if (priorAttempts >= quiz.maxAttempts) {
            throw new BadRequestError('Maximum attempts reached for this quiz');
        }

        const body = req.body as z.infer<typeof submitAttemptSchema>;
        const answersByQuestion = new Map(body.answers.map((a) => [a.questionId, new Set(a.selectedOptionIds)]));

        let correctCount = 0;
        for (const question of quiz.questions) {
            const correctOptionIds = new Set(question.options.filter((o) => o.isCorrect).map((o) => o.id));
            const selected = answersByQuestion.get(question.id) ?? new Set<number>();
            const isFullyCorrect =
                correctOptionIds.size === selected.size &&
                [...correctOptionIds].every((id) => selected.has(id));
            if (isFullyCorrect) correctCount += 1;
        }

        const score = quiz.questions.length > 0 ? Math.round((correctCount / quiz.questions.length) * 100) : 0;
        const passed = score >= quiz.passPercentage;
        const gradeLabel = resolveGradeLabel(score, quiz.gradeBands);

        const attempt = await prisma.quizAttempt.create({
            data: {
                quizId,
                employeeId,
                attemptNumber: priorAttempts + 1,
                score,
                passed,
                gradeLabel,
                answersJson: JSON.stringify(body.answers),
                startedAt: new Date(body.startedAt),
                completedAt: new Date(),
            },
        });

        await evaluateAttemptBadges(attempt.id);

        if (body.isAutoSubmit) {
            const [employee, course] = await Promise.all([
                prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } }),
                prisma.course.findUnique({ where: { id: quiz.module.courseId }, select: { title: true } }),
            ]);
            const managerAndHrUserIds = await getManagerAndHrUserIds(employeeId);
            await notify({
                recipientIds: managerAndHrUserIds,
                type: 'QUIZ_AUTO_SUBMITTED',
                title: 'Quiz auto-submitted — tab switch detected',
                message: `${employee?.name ?? 'A team member'} switched away from the quiz tab during "${course?.title ?? 'a course'}" and the attempt was auto-submitted (score: ${score}%, ${passed ? 'passed' : 'not passed'}).`,
                entityId: quiz.module.courseId,
                employeeId,
            });
        }

        // Find the enrollment this quiz module belongs to, mark module progress + re-evaluate completion
        const enrollment = await prisma.enrollment.findFirst({
            where: { courseId: quiz.module.courseId, employeeId },
        });
        if (enrollment) {
            const existingProgress = await prisma.moduleProgress.findUnique({
                where: { enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId: quiz.moduleId } },
                select: { status: true },
            });

            await prisma.moduleProgress.upsert({
                where: { enrollmentId_moduleId: { enrollmentId: enrollment.id, moduleId: quiz.moduleId } },
                update: { status: passed ? 'COMPLETED' : 'IN_PROGRESS', completedAt: passed ? new Date() : undefined },
                create: { enrollmentId: enrollment.id, moduleId: quiz.moduleId, status: passed ? 'COMPLETED' : 'IN_PROGRESS', completedAt: passed ? new Date() : null },
            });

            if (passed && existingProgress?.status !== 'COMPLETED') {
                await evaluateModuleCompletionBadges(employeeId);

                const courseSettings = await prisma.course.findUnique({ where: { id: quiz.module.courseId }, select: { certificatesPerModule: true } });
                if (courseSettings?.certificatesPerModule) {
                    const { issueModuleCertificate } = await import('../utils/certificateGenerator.js');
                    await issueModuleCertificate(enrollment.id, quiz.moduleId);
                }
            }

            if (passed) {
                await evaluateCourseCompletion(enrollment.id);
            }
        }

        res.json({
            success: true,
            data: { attempt: { ...attempt, totalQuestions: quiz.questions.length, correctCount } },
            message: passed ? 'Quiz passed' : 'Quiz not passed',
        });
    })
);

// ─── POST /api/learning/courses/:id/enroll ─────────────────────
// Self-enroll into a published, non-restricted course

router.post(
    '/courses/:id/enroll',
    asyncHandler(async (req, res) => {
        const courseId = parseInt(req.params['id'] as string, 10);
        if (isNaN(courseId)) throw new BadRequestError('Invalid course ID');

        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundError('Course not found');
        if (course.state !== 'PUBLISHED') throw new BadRequestError('This course is not currently available for enrollment');

        const existing = await prisma.enrollment.findUnique({
            where: { courseId_employeeId: { courseId, employeeId } },
        });
        if (existing) {
            res.json({ success: true, data: { enrollment: existing }, message: 'Already enrolled' });
            return;
        }

        const enrollment = await prisma.enrollment.create({
            data: { courseId, employeeId, status: course.requiresApproval ? 'PENDING_APPROVAL' : 'NOT_STARTED' },
        });

        if (course.requiresApproval) {
            const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
            const approverUserIds = await getManagerAndHrUserIds(employeeId);
            await notify({
                recipientIds: approverUserIds,
                type: 'COURSE_APPROVAL_REQUESTED',
                title: 'Course enrollment needs approval',
                message: `${employee?.name ?? 'A team member'} requested to enroll in "${course.title}" and needs your approval.`,
                entityId: courseId,
                employeeId,
            });
        }

        res.status(201).json({
            success: true,
            data: { enrollment },
            message: course.requiresApproval ? 'Enrollment request submitted for approval' : 'Enrolled successfully',
        });
    })
);

// ─── POST /api/learning/courses/:id/nominate ─────────────────────
// Manager/HR nominates one employee for a course — distinct from /assign: the employee must
// accept or decline before it becomes an active enrollment.

const nominateSchema = z.object({
    employeeId: z.number().int().positive(),
});

router.post(
    '/courses/:id/nominate',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    validate(nominateSchema),
    asyncHandler(async (req, res) => {
        const courseId = parseInt(req.params['id'] as string, 10);
        if (isNaN(courseId)) throw new BadRequestError('Invalid course ID');

        const { employeeId } = req.body as z.infer<typeof nominateSchema>;

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundError('Course not found');
        if (course.state !== 'PUBLISHED') throw new BadRequestError('Only published courses can be nominated');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(employeeId)) {
            throw new ForbiddenError('You can only nominate employees in your own reporting hierarchy');
        }

        const existing = await prisma.enrollment.findUnique({ where: { courseId_employeeId: { courseId, employeeId } } });
        if (existing) throw new BadRequestError('This employee is already enrolled or nominated for this course');

        const enrollment = await prisma.enrollment.create({
            data: { courseId, employeeId, status: 'NOMINATED', assignedById: req.user!.userId },
        });

        const userIdMap = await getEmployeeUserIdMap([employeeId]);
        const recipientUserId = userIdMap.get(employeeId);
        if (recipientUserId) {
            await notify({
                recipientIds: [recipientUserId],
                excludeUserId: req.user!.userId,
                type: 'COURSE_NOMINATED',
                title: 'You have been nominated for a course',
                message: `You've been nominated for "${course.title}". Accept or decline from My Learning.`,
                entityId: courseId,
                employeeId,
            });
        }

        res.status(201).json({ success: true, data: { enrollment }, message: 'Nomination sent' });
    })
);

// ─── POST /api/learning/enrollments/:id/accept, /decline ────────
// Employee responds to a nomination.

router.post(
    '/enrollments/:id/accept',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        const enrollment = await prisma.enrollment.findUnique({ where: { id } });
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (enrollment.employeeId !== req.user!.employeeId) throw new BadRequestError('You can only respond to your own nomination');
        if (enrollment.status !== 'NOMINATED') throw new BadRequestError('This enrollment is not awaiting a response');

        const updated = await prisma.enrollment.update({ where: { id }, data: { status: 'NOT_STARTED' } });
        res.json({ success: true, data: { enrollment: updated }, message: 'Nomination accepted' });
    })
);

router.post(
    '/enrollments/:id/decline',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        const enrollment = await prisma.enrollment.findUnique({ where: { id } });
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (enrollment.employeeId !== req.user!.employeeId) throw new BadRequestError('You can only respond to your own nomination');
        if (enrollment.status !== 'NOMINATED') throw new BadRequestError('This enrollment is not awaiting a response');

        const updated = await prisma.enrollment.update({ where: { id }, data: { status: 'REJECTED' } });
        res.json({ success: true, data: { enrollment: updated }, message: 'Nomination declined' });
    })
);

// ─── POST /api/learning/enrollments/:id/approve, /reject ────────
// Manager/HR decides on an employee's self-enroll request (course had requiresApproval=true).

router.post(
    '/enrollments/:id/approve',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        const enrollment = await prisma.enrollment.findUnique({ where: { id }, include: { course: { select: { title: true } } } });
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (enrollment.status !== 'PENDING_APPROVAL') throw new BadRequestError('This enrollment is not awaiting approval');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(enrollment.employeeId)) {
            throw new ForbiddenError('You can only approve requests from your own reporting hierarchy');
        }

        const updated = await prisma.enrollment.update({ where: { id }, data: { status: 'NOT_STARTED' } });

        const userIdMap = await getEmployeeUserIdMap([enrollment.employeeId]);
        const recipientUserId = userIdMap.get(enrollment.employeeId);
        if (recipientUserId) {
            await notify({
                recipientIds: [recipientUserId],
                excludeUserId: req.user!.userId,
                type: 'COURSE_APPROVAL_DECIDED',
                title: 'Enrollment approved',
                message: `Your request to enroll in "${enrollment.course.title}" was approved.`,
                entityId: enrollment.courseId,
                employeeId: enrollment.employeeId,
            });
        }

        res.json({ success: true, data: { enrollment: updated }, message: 'Enrollment approved' });
    })
);

router.post(
    '/enrollments/:id/reject',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        const enrollment = await prisma.enrollment.findUnique({ where: { id }, include: { course: { select: { title: true } } } });
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (enrollment.status !== 'PENDING_APPROVAL') throw new BadRequestError('This enrollment is not awaiting approval');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(enrollment.employeeId)) {
            throw new ForbiddenError('You can only decide on requests from your own reporting hierarchy');
        }

        const updated = await prisma.enrollment.update({ where: { id }, data: { status: 'REJECTED' } });

        const userIdMap = await getEmployeeUserIdMap([enrollment.employeeId]);
        const recipientUserId = userIdMap.get(enrollment.employeeId);
        if (recipientUserId) {
            await notify({
                recipientIds: [recipientUserId],
                excludeUserId: req.user!.userId,
                type: 'COURSE_APPROVAL_DECIDED',
                title: 'Enrollment request declined',
                message: `Your request to enroll in "${enrollment.course.title}" was declined.`,
                entityId: enrollment.courseId,
                employeeId: enrollment.employeeId,
            });
        }

        res.json({ success: true, data: { enrollment: updated }, message: 'Enrollment rejected' });
    })
);

// ─── POST /api/learning/courses/:id/assign ──────────────────────
// HR/Manager assigns a course to one or more employees, with an optional due date.
// Managers may only assign within their own scope (self + reporting hierarchy).

const assignCourseSchema = z.object({
    employeeIds: z.array(z.number().int().positive()).min(1, 'Select at least one employee'),
    dueDate: z.string().optional(),
});

router.post(
    '/courses/:id/assign',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    validate(assignCourseSchema),
    asyncHandler(async (req, res) => {
        const courseId = parseInt(req.params['id'] as string, 10);
        if (isNaN(courseId)) throw new BadRequestError('Invalid course ID');

        const { employeeIds, dueDate } = req.body as z.infer<typeof assignCourseSchema>;

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundError('Course not found');
        if (course.state !== 'PUBLISHED') throw new BadRequestError('Only published courses can be assigned');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds) {
            const outOfScope = employeeIds.filter((id) => !scopedIds.includes(id));
            if (outOfScope.length > 0) {
                throw new ForbiddenError('You can only assign this course to your own reporting hierarchy');
            }
        }

        const existing = await prisma.enrollment.findMany({
            where: { courseId, employeeId: { in: employeeIds } },
            select: { employeeId: true },
        });
        const alreadyEnrolled = new Set(existing.map((e) => e.employeeId));
        const toCreate = employeeIds.filter((id) => !alreadyEnrolled.has(id));

        if (toCreate.length > 0) {
            await prisma.enrollment.createMany({
                data: toCreate.map((employeeId) => ({
                    courseId,
                    employeeId,
                    status: 'NOT_STARTED' as const,
                    assignedById: req.user!.userId,
                    dueDate: dueDate ? new Date(dueDate) : null,
                })),
            });

            const userIdMap = await getEmployeeUserIdMap(toCreate);
            await notify({
                recipientIds: userIdMap.values(),
                excludeUserId: req.user!.userId,
                type: 'COURSE_ASSIGNED',
                title: 'New course assigned',
                message: `You've been assigned "${course.title}"${dueDate ? ` — due ${new Date(dueDate).toLocaleDateString('en-IN')}` : ''}.`,
                entityId: courseId,
            });
        }

        res.status(201).json({
            success: true,
            data: { assignedCount: toCreate.length, alreadyEnrolledCount: alreadyEnrolled.size },
            message: toCreate.length > 0 ? `Assigned to ${toCreate.length} employee(s)` : 'All selected employees were already enrolled',
        });
    })
);

// ─── GET /api/learning/my/enrollments ──────────────────────────

router.get(
    '/my/enrollments',
    asyncHandler(async (req, res) => {
        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const enrollments = await prisma.enrollment.findMany({
            where: { employeeId },
            include: {
                course: { include: { modules: { select: { id: true } } } },
                moduleProgress: true,
                certificates: { where: { moduleId: null }, select: { certificateNumber: true, expiresAt: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Whole-course certificate only, exposed as a singular field for existing frontend consumers.
        const result = enrollments.map((e) => ({ ...e, certificate: e.certificates[0] ?? null, certificates: undefined }));

        res.json({ success: true, data: { enrollments: result } });
    })
);

// ─── GET /api/learning/team/enrollments ─────────────────────────
// Manager's per-report completion status (scoped to self + reporting hierarchy).
// HR/Leadership get the org-wide equivalent (same shape, unscoped).

router.get(
    '/team/enrollments',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const scopedIds = await getScopedEmployeeIds(req);
        const selfId = req.user!.employeeId;

        const employeeFilter = scopedIds
            ? { id: { in: scopedIds.filter((id) => id !== selfId) } }
            : selfId
                ? { id: { not: selfId } }
                : {};

        const enrollments = await prisma.enrollment.findMany({
            where: { employee: employeeFilter },
            include: {
                course: { select: { id: true, title: true, mandatory: true, durationMinutes: true } },
                employee: { select: { id: true, name: true, department: true, position: true, avatar: true, gender: true } },
                moduleProgress: { select: { status: true } },
                certificates: { where: { moduleId: null }, select: { certificateNumber: true, expiresAt: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const result = enrollments.map((e) => ({ ...e, certificate: e.certificates[0] ?? null, certificates: undefined }));

        res.json({ success: true, data: { enrollments: result } });
    })
);

// ─── POST /api/learning/enrollments/:id/nudge ───────────────────
// Manager/HR one-click reminder to a specific learner about a specific (incomplete) enrollment.
// Capped at one learning-related notification per learner per day, shared with the automated
// reminder scheduler, so a nudge never stacks on top of (or gets stacked on by) a scheduled reminder.

router.post(
    '/enrollments/:id/nudge',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        const enrollment = await prisma.enrollment.findUnique({
            where: { id },
            include: {
                course: { select: { id: true, title: true } },
                employee: { select: { id: true, name: true, email: true } },
            },
        });
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (!['NOT_STARTED', 'IN_PROGRESS', 'FAILED'].includes(enrollment.status)) {
            throw new BadRequestError('This enrollment is not in an active learning state');
        }

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(enrollment.employeeId)) {
            throw new ForbiddenError('You can only nudge employees in your own reporting hierarchy');
        }

        const userIdMap = await getEmployeeUserIdMap([enrollment.employee.id]);
        const recipientUserId = userIdMap.get(enrollment.employee.id);
        if (!recipientUserId) throw new BadRequestError('This employee has no active user account to notify');

        if (await hasReceivedLearningNotificationToday(recipientUserId)) {
            throw new TooManyRequestsError('This employee already received a learning reminder today — try again tomorrow');
        }

        await notify({
            recipientIds: [recipientUserId],
            excludeUserId: req.user!.userId,
            type: 'COURSE_NUDGE',
            title: 'Reminder from your manager',
            message: `Don't forget to complete "${enrollment.course.title}".`,
            entityId: enrollment.courseId,
            employeeId: enrollment.employee.id,
        });

        if (enrollment.employee.email && enrollment.dueDate) {
            await sendLearningReminderEmail({
                to: enrollment.employee.email,
                employeeName: enrollment.employee.name,
                courseTitle: enrollment.course.title,
                dueDate: enrollment.dueDate,
                kind: new Date(enrollment.dueDate) < new Date() ? 'OVERDUE' : 'UPCOMING',
            }).catch((error) => console.error(`Nudge email failed for enrollment ${enrollment.id}:`, error));
        }

        res.json({ success: true, message: 'Reminder sent' });
    })
);

// ─── GET /api/learning/admin/department-summary ─────────────────
// Department-level completion rollup for the org-wide admin dashboard. HR/Leadership only.

router.get(
    '/admin/department-summary',
    authorize('HR', 'LEADERSHIP'),
    asyncHandler(async (_req, res) => {
        const enrollments = await prisma.enrollment.findMany({
            select: {
                status: true,
                dueDate: true,
                employee: { select: { department: true } },
            },
        });

        const byDepartment = new Map<string, RollupStats>();
        const now = new Date();

        for (const e of enrollments) {
            const dept = e.employee.department || 'Unassigned';
            const row = byDepartment.get(dept) ?? emptyRollup();
            addToRollup(row, e.status, e.dueDate, now);
            byDepartment.set(dept, row);
        }

        const departments = Array.from(byDepartment.entries())
            .map(([department, stats]) => ({ department, ...withCompletionRate(stats) }))
            .sort((a, b) => b.total - a.total);

        res.json({ success: true, data: { departments } });
    })
);

interface RollupStats {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
}

function emptyRollup(): RollupStats {
    return { total: 0, completed: 0, inProgress: 0, notStarted: 0, overdue: 0 };
}

function addToRollup(row: RollupStats, status: string, dueDate: Date | null, now: Date): void {
    row.total += 1;
    if (status === 'COMPLETED') row.completed += 1;
    else if (status === 'IN_PROGRESS') row.inProgress += 1;
    else row.notStarted += 1;
    if (status !== 'COMPLETED' && dueDate && dueDate < now) row.overdue += 1;
}

function withCompletionRate(stats: RollupStats) {
    return { ...stats, completionRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0 };
}

// ─── GET /api/learning/admin/departments/:department/teams ──────
// Drill-down level 2 (FR-6.9): department's enrollments grouped by each employee's manager.
// "Team" = a manager's direct reports (primary managerId), not the full reporting subtree.

router.get(
    '/admin/departments/:department/teams',
    authorize('HR', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const department = req.params['department'] as string;
        const isUnassigned = department === 'Unassigned';

        const enrollments = await prisma.enrollment.findMany({
            where: { employee: isUnassigned ? { department: null } : { department } },
            select: {
                status: true,
                dueDate: true,
                employee: {
                    select: {
                        manager: { select: { id: true, name: true } },
                        managers: { select: { manager: { select: { id: true, name: true } } }, orderBy: { id: 'asc' }, take: 1 },
                    },
                },
            },
        });

        const byManager = new Map<string, { managerId: number | null; managerName: string; stats: RollupStats }>();
        const now = new Date();

        for (const e of enrollments) {
            // Primary manager: the legacy managerId if set, else the first "Reports to" link.
            const manager = e.employee.manager ?? e.employee.managers[0]?.manager ?? null;
            const managerId = manager?.id ?? null;
            const key = managerId === null ? 'none' : String(managerId);
            const entry = byManager.get(key) ?? {
                managerId,
                managerName: manager?.name ?? 'No manager assigned',
                stats: emptyRollup(),
            };
            addToRollup(entry.stats, e.status, e.dueDate, now);
            byManager.set(key, entry);
        }

        const teams = Array.from(byManager.values())
            .map((entry) => ({ managerId: entry.managerId, managerName: entry.managerName, ...withCompletionRate(entry.stats) }))
            .sort((a, b) => b.total - a.total);

        res.json({ success: true, data: { teams } });
    })
);

// ─── GET /api/learning/admin/teams/:managerId/members ────────────
// Drill-down level 3 (FR-6.9): named individuals reporting to one manager, within one department.
// :managerId may be "none" for the "no manager assigned" bucket from the teams endpoint above.

router.get(
    '/admin/teams/:managerId/members',
    authorize('HR', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const managerIdParam = req.params['managerId'] as string;
        const department = req.query['department'] as string | undefined;
        const isUnassigned = department === 'Unassigned';

        const employeeFilter = {
            ...(department ? { department: isUnassigned ? null : department } : {}),
            // Same primary-manager rule as the teams view: legacy managerId, else a "Reports to" link.
            ...(managerIdParam === 'none'
                ? { managerId: null, managers: { none: {} } }
                : {
                    OR: [
                        { managerId: parseInt(managerIdParam, 10) },
                        { managerId: null, managers: { some: { managerId: parseInt(managerIdParam, 10) } } },
                    ],
                }),
        };

        const enrollments = await prisma.enrollment.findMany({
            where: { employee: employeeFilter },
            select: {
                status: true,
                dueDate: true,
                employee: { select: { id: true, name: true, position: true, avatar: true, gender: true } },
            },
        });

        const byEmployee = new Map<number, { name: string; position: string | null; avatar: string | null; gender: string | null; stats: RollupStats }>();
        const now = new Date();

        for (const e of enrollments) {
            const entry = byEmployee.get(e.employee.id) ?? {
                name: e.employee.name,
                position: e.employee.position,
                avatar: e.employee.avatar,
                gender: e.employee.gender,
                stats: emptyRollup(),
            };
            addToRollup(entry.stats, e.status, e.dueDate, now);
            byEmployee.set(e.employee.id, entry);
        }

        const members = Array.from(byEmployee.entries())
            .map(([employeeId, entry]) => ({
                employeeId,
                name: entry.name,
                position: entry.position,
                avatar: entry.avatar,
                gender: entry.gender,
                ...withCompletionRate(entry.stats),
            }))
            .sort((a, b) => b.total - a.total);

        res.json({ success: true, data: { members } });
    })
);

// ─── GET /api/learning/enrollments/:id ─────────────────────────
// Full course + module + progress detail for the course-player view

router.get(
    '/enrollments/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        // Enrollment, its course and the course's module tree are fetched together (the tree is
        // located through the enrollment id, so nothing waits on the enrollment row first).
        const courseOfEnrollment = { enrollments: { some: { id } } };
        const [enrollmentRow, courseRow, modules] = await Promise.all([
            prisma.enrollment.findUnique({
                where: { id },
                include: {
                    moduleProgress: true,
                    certificates: { select: { certificateNumber: true, expiresAt: true, moduleId: true } },
                },
            }),
            prisma.course.findFirst({ where: courseOfEnrollment }),
            loadCourseModuleTree(courseOfEnrollment),
        ]);

        if (!enrollmentRow || !courseRow) throw new NotFoundError('Enrollment not found');
        const { moduleProgress, certificates, ...enrollmentFields } = enrollmentRow;
        // Same key order as the previous nested include: scalars, course, moduleProgress, certificates.
        const enrollment = { ...enrollmentFields, course: { ...courseRow, modules }, moduleProgress, certificates };
        if (enrollment.employeeId !== req.user!.employeeId) {
            throw new BadRequestError('You can only view your own enrollment');
        }

        // Never reveal correct-answer flags to the learner taking the quiz
        for (const module of enrollment.course.modules) {
            if (module.quiz) {
                for (const question of module.quiz.questions) {
                    question.options = question.options.map((o) => ({ ...o, isCorrect: false }));
                }
            }
        }

        res.json({ success: true, data: { enrollment } });
    })
);

const progressUpdateSchema = z.object({
    moduleId: z.number().int().positive(),
    lastPositionSeconds: z.number().int().nonnegative().optional(),
    lastPageViewed: z.number().int().nonnegative().optional(),
    timeSpentDeltaSeconds: z.number().int().nonnegative().default(0),
    markComplete: z.boolean().optional(),
});

/**
 * Phase 1 completion rule: every non-quiz module has ModuleProgress.status = COMPLETED,
 * and every quiz module has at least one passing QuizAttempt.
 * Marks the enrollment Completed and triggers certificate issuance when met.
 */
async function evaluateCourseCompletion(enrollmentId: number): Promise<void> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            course: { include: { modules: { include: { quiz: true } } } },
            moduleProgress: true,
        },
    });
    if (!enrollment || enrollment.status === 'COMPLETED') return;

    const progressByModule = new Map(enrollment.moduleProgress.map((p) => [p.moduleId, p]));

    // One query for every passed quiz in the course, instead of one per quiz module.
    const quizIds = enrollment.course.modules.flatMap((m) => (m.contentType === 'QUIZ' && m.quiz ? [m.quiz.id] : []));
    const passedQuizIds = new Set(
        quizIds.length
            ? (await prisma.quizAttempt.findMany({
                where: { quizId: { in: quizIds }, employeeId: enrollment.employeeId, passed: true },
                select: { quizId: true },
                distinct: ['quizId'],
            })).map((a) => a.quizId)
            : []
    );

    for (const module of enrollment.course.modules) {
        if (module.contentType === 'QUIZ' && module.quiz) {
            if (!passedQuizIds.has(module.quiz.id)) return; // not yet complete
        } else {
            const progress = progressByModule.get(module.id);
            if (!progress || progress.status !== 'COMPLETED') return; // not yet complete
        }
    }

    await prisma.enrollment.update({
        where: { id: enrollmentId },
        data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const { issueCertificate } = await import('../utils/certificateGenerator.js');
    await issueCertificate(enrollmentId);

    const [employee, managerAndHrUserIds] = await Promise.all([
        prisma.employee.findUnique({ where: { id: enrollment.employeeId }, select: { name: true } }),
        getManagerAndHrUserIds(enrollment.employeeId),
    ]);
    await notify({
        recipientIds: managerAndHrUserIds,
        type: 'COURSE_COMPLETED',
        title: 'Course completed',
        message: `${employee?.name ?? 'A team member'} completed "${enrollment.course.title}".`,
        entityId: enrollment.courseId,
        employeeId: enrollment.employeeId,
    });

    await evaluateCourseCompletionBadges(enrollment.employeeId);
    await evaluatePathProgress(enrollment.employeeId, enrollment.courseId);
}

// ─── GET /api/learning/courses/:id/leaderboard ──────────────────
// Ranking basis: average best-attempt quiz score (desc), total time taken as tie-breaker (asc).
// Addendum FR-4.8–4.11, FR-6.7.

interface LeaderboardEntry {
    employeeId: number;
    name: string;
    avgScore: number;
    totalTimeSeconds: number;
    rank: number;
}

async function computeLeaderboard(courseId: number, scope: 'DEPARTMENT' | 'ORG_WIDE', department: string | null): Promise<LeaderboardEntry[]> {
    const employeeFilter = scope === 'DEPARTMENT' && department ? { department } : {};

    const enrollments = await prisma.enrollment.findMany({
        where: { courseId, employee: employeeFilter },
        select: { employeeId: true, employee: { select: { name: true } } },
    });
    if (enrollments.length === 0) return [];

    const employeeIds = enrollments.map((e) => e.employeeId);
    const quizIds = (
        await prisma.quiz.findMany({ where: { module: { courseId } }, select: { id: true } })
    ).map((q) => q.id);
    if (quizIds.length === 0) return [];

    const attempts = await prisma.quizAttempt.findMany({
        where: { quizId: { in: quizIds }, employeeId: { in: employeeIds }, passed: true },
        select: { employeeId: true, quizId: true, score: true, startedAt: true, completedAt: true },
    });

    // Best (highest-scoring) passed attempt per employee per quiz
    const bestByEmployeeQuiz = new Map<string, { score: number; timeSeconds: number }>();
    for (const attempt of attempts) {
        const key = `${attempt.employeeId}:${attempt.quizId}`;
        const timeSeconds = attempt.completedAt
            ? Math.max(0, Math.round((attempt.completedAt.getTime() - attempt.startedAt.getTime()) / 1000))
            : 0;
        const existing = bestByEmployeeQuiz.get(key);
        if (!existing || attempt.score > existing.score) {
            bestByEmployeeQuiz.set(key, { score: attempt.score, timeSeconds });
        }
    }

    const nameByEmployeeId = new Map(enrollments.map((e) => [e.employeeId, e.employee.name]));
    const perEmployee = new Map<number, { totalScore: number; quizCount: number; totalTimeSeconds: number }>();
    for (const [key, value] of bestByEmployeeQuiz) {
        const employeeId = parseInt(key.split(':')[0] as string, 10);
        const agg = perEmployee.get(employeeId) ?? { totalScore: 0, quizCount: 0, totalTimeSeconds: 0 };
        agg.totalScore += value.score;
        agg.quizCount += 1;
        agg.totalTimeSeconds += value.timeSeconds;
        perEmployee.set(employeeId, agg);
    }

    const entries = Array.from(perEmployee.entries())
        .map(([employeeId, agg]) => ({
            employeeId,
            name: nameByEmployeeId.get(employeeId) ?? 'Unknown',
            avgScore: agg.totalScore / agg.quizCount,
            totalTimeSeconds: agg.totalTimeSeconds,
        }))
        .sort((a, b) => (b.avgScore - a.avgScore) || (a.totalTimeSeconds - b.totalTimeSeconds));

    return entries.map((entry, i) => ({ ...entry, rank: i + 1 }));
}

router.get(
    '/courses/:id/leaderboard',
    asyncHandler(async (req, res) => {
        const courseId = parseInt(req.params['id'] as string, 10);
        if (isNaN(courseId)) throw new BadRequestError('Invalid course ID');

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundError('Course not found');
        if (!course.enableRanking) throw new BadRequestError('Ranking is not enabled for this course');

        const { role, employeeId } = req.user!;
        const isManagement = role === 'HR' || role === 'LEADERSHIP' || role === 'MANAGER';

        let department: string | null = null;
        if (course.rankingScope === 'DEPARTMENT') {
            const viewer = employeeId
                ? await prisma.employee.findUnique({ where: { id: employeeId }, select: { department: true } })
                : null;
            department = viewer?.department ?? null;
        }

        const leaderboard = await computeLeaderboard(courseId, course.rankingScope, department);
        const cohortSize = leaderboard.length;
        const suppressed = cohortSize < course.rankingMinCohortSize;

        const myEntry = employeeId ? leaderboard.find((e) => e.employeeId === employeeId) ?? null : null;

        if (suppressed) {
            res.json({
                success: true,
                data: {
                    suppressed: true,
                    cohortSize,
                    minCohortSize: course.rankingMinCohortSize,
                    myScore: myEntry?.avgScore ?? null,
                },
            });
            return;
        }

        // Managers/HR/Leadership always see the full named list within their scope (FR-6.7),
        // regardless of the course's learner-facing anonymity setting.
        if (isManagement) {
            res.json({ success: true, data: { suppressed: false, anonymous: false, entries: leaderboard, cohortSize } });
            return;
        }

        if (!course.rankingAnonymous) {
            res.json({ success: true, data: { suppressed: false, anonymous: false, entries: leaderboard, cohortSize } });
            return;
        }

        // Anonymous mode: the learner sees only their own rank/percentile, never other names/scores.
        const percentile = myEntry ? Math.round(((cohortSize - myEntry.rank) / (cohortSize - 1 || 1)) * 100) : null;
        res.json({
            success: true,
            data: {
                suppressed: false,
                anonymous: true,
                cohortSize,
                myRank: myEntry?.rank ?? null,
                myScore: myEntry?.avgScore ?? null,
                myPercentile: percentile,
            },
        });
    })
);

// ─── POST /api/learning/enrollments/:id/progress ───────────────
// Heartbeat-style progress update for a video/document module

router.post(
    '/enrollments/:id/progress',
    validate(progressUpdateSchema),
    asyncHandler(async (req, res) => {
        const enrollmentId = parseInt(req.params['id'] as string, 10);
        if (isNaN(enrollmentId)) throw new BadRequestError('Invalid enrollment ID');

        const body = req.body as z.infer<typeof progressUpdateSchema>;

        // Fired every few seconds while a learner watches/reads, so the three lookups run together.
        const [enrollment, module, existing] = await Promise.all([
            prisma.enrollment.findUnique({ where: { id: enrollmentId } }),
            prisma.courseModule.findUnique({ where: { id: body.moduleId } }),
            prisma.moduleProgress.findUnique({
                where: { enrollmentId_moduleId: { enrollmentId, moduleId: body.moduleId } },
            }),
        ]);
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (enrollment.employeeId !== req.user!.employeeId) {
            throw new BadRequestError('You can only update your own progress');
        }
        if (['NOMINATED', 'PENDING_APPROVAL', 'REJECTED'].includes(enrollment.status)) {
            throw new BadRequestError('This enrollment is not yet active');
        }

        if (!module || module.courseId !== enrollment.courseId) {
            throw new BadRequestError('Module does not belong to this course');
        }

        const newStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' = body.markComplete
            ? 'COMPLETED'
            : 'IN_PROGRESS';

        const moduleProgress = await prisma.moduleProgress.upsert({
            where: { enrollmentId_moduleId: { enrollmentId, moduleId: body.moduleId } },
            update: {
                status: newStatus,
                lastPositionSeconds: body.lastPositionSeconds ?? undefined,
                lastPageViewed: body.lastPageViewed ?? undefined,
                timeSpentSeconds: { increment: body.timeSpentDeltaSeconds },
                completedAt: body.markComplete ? new Date() : undefined,
            },
            create: {
                enrollmentId,
                moduleId: body.moduleId,
                status: newStatus,
                lastPositionSeconds: body.lastPositionSeconds,
                lastPageViewed: body.lastPageViewed,
                timeSpentSeconds: body.timeSpentDeltaSeconds,
                completedAt: body.markComplete ? new Date() : null,
            },
        });

        if (!existing && enrollment.status === 'NOT_STARTED') {
            await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'IN_PROGRESS', startedAt: new Date() },
            });
        }

        // Only react to a genuine NOT_STARTED/IN_PROGRESS -> COMPLETED transition, not a
        // re-save of a module that was already complete.
        if (body.markComplete && existing?.status !== 'COMPLETED') {
            await evaluateModuleCompletionBadges(enrollment.employeeId);

            const course = await prisma.course.findUnique({ where: { id: enrollment.courseId }, select: { certificatesPerModule: true } });
            if (course?.certificatesPerModule) {
                const { issueModuleCertificate } = await import('../utils/certificateGenerator.js');
                await issueModuleCertificate(enrollmentId, body.moduleId);
            }
        }

        if (body.markComplete) {
            await evaluateCourseCompletion(enrollmentId);
        }

        res.json({ success: true, data: { moduleProgress } });
    })
);

// ─── GET /api/learning/certificates/:certificateNumber/download ───
// Returns the certificate PDF (base64 data URL) for the owning learner

router.get(
    '/certificates/:certificateNumber/download',
    asyncHandler(async (req, res) => {
        const certificateNumber = req.params['certificateNumber'] as string;

        const certificate = await prisma.certificate.findUnique({
            where: { certificateNumber },
            include: { enrollment: { select: { employeeId: true } } },
        });
        if (!certificate) throw new NotFoundError('Certificate not found');
        if (certificate.enrollment.employeeId !== req.user!.employeeId && req.user!.role !== 'HR') {
            throw new BadRequestError('You can only download your own certificate');
        }

        res.json({ success: true, data: { certificateNumber: certificate.certificateNumber, pdfBase64: certificate.pdfBase64 } });
    })
);

// ─── GET /api/learning/certificates/:certificateNumber/verify ──────
// Public-ish verification — no auth-bypassing PII, just validity confirmation

router.get(
    '/certificates/:certificateNumber/verify',
    asyncHandler(async (req, res) => {
        const certificateNumber = req.params['certificateNumber'] as string;

        // Metadata only — never pull the stored PDF just to verify a certificate number.
        const certificate = await prisma.certificate.findUnique({
            where: { certificateNumber },
            select: {
                issuedAt: true,
                expiresAt: true,
                enrollment: { select: { course: { select: { title: true } }, employee: { select: { name: true } } } },
            },
        });

        if (!certificate) {
            res.json({ success: true, data: { valid: false } });
            return;
        }

        const expired = Boolean(certificate.expiresAt && certificate.expiresAt < new Date());

        res.json({
            success: true,
            data: {
                valid: !expired,
                expired,
                courseTitle: certificate.enrollment.course.title,
                learnerName: certificate.enrollment.employee.name,
                issuedAt: certificate.issuedAt,
                expiresAt: certificate.expiresAt,
            },
        });
    })
);

// ─── POST /api/learning/enrollments/:id/renew ───────────────────
// Learner retakes a course whose certificate has expired (or is expiring): resets their own
// completed enrollment back to NOT_STARTED, wiping module progress, quiz attempts and the old certificate, so
// the unique (courseId, employeeId) constraint can issue a fresh certificate on re-completion.

router.post(
    '/enrollments/:id/renew',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid enrollment ID');

        const enrollment = await prisma.enrollment.findUnique({
            where: { id },
            include: { certificates: { select: { id: true } } },
        });
        if (!enrollment) throw new NotFoundError('Enrollment not found');
        if (enrollment.employeeId !== req.user!.employeeId) {
            throw new BadRequestError('You can only renew your own enrollment');
        }
        if (enrollment.status !== 'COMPLETED') {
            throw new BadRequestError('Only a completed course can be renewed');
        }

        await prisma.$transaction([
            prisma.moduleProgress.deleteMany({ where: { enrollmentId: id } }),
            // Old attempts would still count against maxAttempts and could block passing the retake.
            prisma.quizAttempt.deleteMany({
                where: { employeeId: enrollment.employeeId, quiz: { module: { courseId: enrollment.courseId } } },
            }),
            ...(enrollment.certificates.length > 0 ? [prisma.certificate.deleteMany({ where: { enrollmentId: id } })] : []),
            prisma.enrollment.update({
                where: { id },
                data: {
                    status: 'NOT_STARTED',
                    startedAt: null,
                    completedAt: null,
                    lastReminderDay: null,
                    dueDate: null,
                },
            }),
        ]);

        res.json({ success: true, message: 'Course reset — you can retake it now' });
    })
);

// ─── Learning Paths (bundles of Courses) ────────────────────────

const createPathSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().optional(),
    mandatory: formBoolean.optional(),
    targetDepartment: z.string().max(100).optional(),
    navigationMode: z.enum(['FREE', 'SEQUENTIAL']).optional(),
    requiresApproval: formBoolean.optional(),
});

const updatePathSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().nullable().optional(),
    mandatory: z.boolean().optional(),
    targetDepartment: z.string().max(100).nullable().optional(),
    navigationMode: z.enum(['FREE', 'SEQUENTIAL']).optional(),
    requiresApproval: z.boolean().optional(),
});

// ─── GET /api/learning/paths ─────────────────────────────────────
// Catalog list — published paths visible to the viewer's department (or all-department paths)

router.get(
    '/paths',
    asyncHandler(async (req, res) => {
        const { role, employeeId } = req.user!;
        const seesAll = role === 'HR' || role === 'LEADERSHIP';

        let viewerDepartment: string | null = null;
        if (!seesAll && employeeId) {
            const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { department: true } });
            viewerDepartment = employee?.department || null;
        }

        const paths = await prisma.learningPath.findMany({
            where: {
                ...(seesAll ? {} : {
                    state: 'PUBLISHED',
                    OR: [
                        { targetDepartment: null },
                        ...(viewerDepartment ? [{ targetDepartment: viewerDepartment }] : []),
                    ],
                }),
            },
            include: {
                createdBy: { select: { username: true } },
                courses: { orderBy: { sortOrder: 'asc' }, include: { course: { select: { id: true, title: true, durationMinutes: true } } } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ success: true, data: { paths } });
    })
);

// ─── GET /api/learning/paths/:id ─────────────────────────────────

router.get(
    '/paths/:id',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path ID');

        const path = await prisma.learningPath.findUnique({
            where: { id },
            include: {
                createdBy: { select: { username: true } },
                courses: { orderBy: { sortOrder: 'asc' }, include: { course: { select: { id: true, title: true, durationMinutes: true, state: true } } } },
            },
        });
        if (!path) throw new NotFoundError('Learning path not found');

        res.json({ success: true, data: { path } });
    })
);

// ─── POST /api/learning/paths ────────────────────────────────────

router.post(
    '/paths',
    authorize('HR'),
    upload.single('thumbnail'),
    asyncHandler(async (req, res) => {
        const body = createPathSchema.parse(req.body);

        let thumbnailUrl: string | null = null;
        if (req.file) {
            const extension = extensionForMimeType(req.file.mimetype);
            thumbnailUrl = await putUploadFile(`learning-path-thumbnails/${randomUUID()}.${extension}`, req.file.buffer);
        }

        const path = await prisma.learningPath.create({
            data: {
                title: body.title,
                description: body.description,
                mandatory: body.mandatory ?? false,
                targetDepartment: body.targetDepartment,
                navigationMode: body.navigationMode ?? 'FREE',
                requiresApproval: body.requiresApproval ?? false,
                thumbnailUrl,
                createdById: req.user!.userId,
            },
        });

        res.status(201).json({ success: true, data: { path }, message: 'Learning path created as draft' });
    })
);

// ─── PUT /api/learning/paths/:id ─────────────────────────────────

router.put(
    '/paths/:id',
    authorize('HR'),
    validate(updatePathSchema),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path ID');

        const existing = await prisma.learningPath.findUnique({ where: { id } });
        if (!existing) throw new NotFoundError('Learning path not found');

        const path = await prisma.learningPath.update({
            where: { id },
            data: req.body as z.infer<typeof updatePathSchema>,
        });

        res.json({ success: true, data: { path }, message: 'Learning path updated' });
    })
);

// ─── DELETE /api/learning/paths/:id ───────────────────────────────

router.delete(
    '/paths/:id',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path ID');

        await prisma.learningPath.delete({ where: { id } });

        res.json({ success: true, message: 'Learning path removed' });
    })
);

// ─── POST /api/learning/paths/:id/publish, /unpublish ────────────

router.post(
    '/paths/:id/publish',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path ID');

        const courseCount = await prisma.learningPathCourse.count({ where: { pathId: id } });
        if (courseCount === 0) throw new BadRequestError('Add at least one course before publishing');

        const path = await prisma.learningPath.update({ where: { id }, data: { state: 'PUBLISHED' } });
        res.json({ success: true, data: { path }, message: 'Learning path published' });
    })
);

router.post(
    '/paths/:id/unpublish',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path ID');

        const path = await prisma.learningPath.update({ where: { id }, data: { state: 'UNPUBLISHED' } });
        res.json({ success: true, data: { path }, message: 'Learning path unpublished' });
    })
);

// ─── POST /api/learning/paths/:id/courses ────────────────────────
// Add a course to a path (HR only)

const addPathCourseSchema = z.object({
    courseId: z.number().int().positive(),
    sortOrder: z.coerce.number().int().nonnegative().optional(),
});

router.post(
    '/paths/:id/courses',
    authorize('HR'),
    validate(addPathCourseSchema),
    asyncHandler(async (req, res) => {
        const pathId = parseInt(req.params['id'] as string, 10);
        if (isNaN(pathId)) throw new BadRequestError('Invalid path ID');

        const path = await prisma.learningPath.findUnique({ where: { id: pathId } });
        if (!path) throw new NotFoundError('Learning path not found');

        const { courseId, sortOrder } = req.body as z.infer<typeof addPathCourseSchema>;

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) throw new NotFoundError('Course not found');

        const existing = await prisma.learningPathCourse.findUnique({ where: { pathId_courseId: { pathId, courseId } } });
        if (existing) throw new BadRequestError('This course is already in the path');

        const resolvedSortOrder = sortOrder ?? (await prisma.learningPathCourse.count({ where: { pathId } }));

        const pathCourse = await prisma.learningPathCourse.create({
            data: { pathId, courseId, sortOrder: resolvedSortOrder },
            include: { course: { select: { id: true, title: true, durationMinutes: true } } },
        });

        res.status(201).json({ success: true, data: { pathCourse }, message: 'Course added to path' });
    })
);

// ─── DELETE /api/learning/paths/:id/courses/:courseId ────────────

router.delete(
    '/paths/:id/courses/:courseId',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        const pathId = parseInt(req.params['id'] as string, 10);
        const courseId = parseInt(req.params['courseId'] as string, 10);
        if (isNaN(pathId) || isNaN(courseId)) throw new BadRequestError('Invalid path or course ID');

        await prisma.learningPathCourse.delete({ where: { pathId_courseId: { pathId, courseId } } });

        res.json({ success: true, message: 'Course removed from path' });
    })
);

// ─── POST /api/learning/paths/:id/enroll ─────────────────────────
// Self-enroll into a published path. Auto-enrolls the learner in the path's first course too,
// so they have something to start immediately rather than landing on an empty path.

router.post(
    '/paths/:id/enroll',
    asyncHandler(async (req, res) => {
        const pathId = parseInt(req.params['id'] as string, 10);
        if (isNaN(pathId)) throw new BadRequestError('Invalid path ID');

        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const path = await prisma.learningPath.findUnique({
            where: { id: pathId },
            include: { courses: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        });
        if (!path) throw new NotFoundError('Learning path not found');
        if (path.state !== 'PUBLISHED') throw new BadRequestError('This learning path is not currently available for enrollment');

        const existing = await prisma.pathEnrollment.findUnique({
            where: { pathId_employeeId: { pathId, employeeId } },
        });
        if (existing) {
            res.json({ success: true, data: { pathEnrollment: existing }, message: 'Already enrolled' });
            return;
        }

        const pathEnrollment = await prisma.pathEnrollment.create({
            data: { pathId, employeeId, status: path.requiresApproval ? 'PENDING_APPROVAL' : 'NOT_STARTED' },
        });

        // Defer the first-course auto-enroll until the path itself is approved — otherwise the
        // learner could start working before their request has even been decided on.
        if (!path.requiresApproval) {
            const firstCourseId = path.courses[0]?.courseId;
            if (firstCourseId) {
                await prisma.enrollment.upsert({
                    where: { courseId_employeeId: { courseId: firstCourseId, employeeId } },
                    update: {},
                    create: { courseId: firstCourseId, employeeId, status: 'NOT_STARTED' },
                });
            }
        } else {
            const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
            const approverUserIds = await getManagerAndHrUserIds(employeeId);
            await notify({
                recipientIds: approverUserIds,
                type: 'COURSE_APPROVAL_REQUESTED',
                title: 'Learning path enrollment needs approval',
                message: `${employee?.name ?? 'A team member'} requested to enroll in "${path.title}" and needs your approval.`,
                entityId: pathId,
                employeeId,
            });
        }

        res.status(201).json({
            success: true,
            data: { pathEnrollment },
            message: path.requiresApproval ? 'Enrollment request submitted for approval' : 'Enrolled successfully',
        });
    })
);

// ─── POST /api/learning/paths/:id/nominate ───────────────────────

const nominatePathSchema = z.object({
    employeeId: z.number().int().positive(),
});

router.post(
    '/paths/:id/nominate',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    validate(nominatePathSchema),
    asyncHandler(async (req, res) => {
        const pathId = parseInt(req.params['id'] as string, 10);
        if (isNaN(pathId)) throw new BadRequestError('Invalid path ID');

        const { employeeId } = req.body as z.infer<typeof nominatePathSchema>;

        const path = await prisma.learningPath.findUnique({ where: { id: pathId } });
        if (!path) throw new NotFoundError('Learning path not found');
        if (path.state !== 'PUBLISHED') throw new BadRequestError('Only published paths can be nominated');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(employeeId)) {
            throw new ForbiddenError('You can only nominate employees in your own reporting hierarchy');
        }

        const existing = await prisma.pathEnrollment.findUnique({ where: { pathId_employeeId: { pathId, employeeId } } });
        if (existing) throw new BadRequestError('This employee is already enrolled or nominated for this path');

        const pathEnrollment = await prisma.pathEnrollment.create({
            data: { pathId, employeeId, status: 'NOMINATED', assignedById: req.user!.userId },
        });

        const userIdMap = await getEmployeeUserIdMap([employeeId]);
        const recipientUserId = userIdMap.get(employeeId);
        if (recipientUserId) {
            await notify({
                recipientIds: [recipientUserId],
                excludeUserId: req.user!.userId,
                type: 'COURSE_NOMINATED',
                title: 'You have been nominated for a learning path',
                message: `You've been nominated for "${path.title}". Accept or decline from My Learning.`,
                entityId: pathId,
                employeeId,
            });
        }

        res.status(201).json({ success: true, data: { pathEnrollment }, message: 'Nomination sent' });
    })
);

// ─── POST /api/learning/path-enrollments/:id/accept, /decline ───

router.post(
    '/path-enrollments/:id/accept',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path enrollment ID');

        const pathEnrollment = await prisma.pathEnrollment.findUnique({ where: { id } });
        if (!pathEnrollment) throw new NotFoundError('Path enrollment not found');
        if (pathEnrollment.employeeId !== req.user!.employeeId) throw new BadRequestError('You can only respond to your own nomination');
        if (pathEnrollment.status !== 'NOMINATED') throw new BadRequestError('This enrollment is not awaiting a response');

        const updated = await prisma.pathEnrollment.update({ where: { id }, data: { status: 'NOT_STARTED' } });

        const path = await prisma.learningPath.findUnique({
            where: { id: pathEnrollment.pathId },
            include: { courses: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        });
        const firstCourseId = path?.courses[0]?.courseId;
        if (firstCourseId) {
            await prisma.enrollment.upsert({
                where: { courseId_employeeId: { courseId: firstCourseId, employeeId: pathEnrollment.employeeId } },
                update: {},
                create: { courseId: firstCourseId, employeeId: pathEnrollment.employeeId, status: 'NOT_STARTED' },
            });
        }

        res.json({ success: true, data: { pathEnrollment: updated }, message: 'Nomination accepted' });
    })
);

router.post(
    '/path-enrollments/:id/decline',
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path enrollment ID');

        const pathEnrollment = await prisma.pathEnrollment.findUnique({ where: { id } });
        if (!pathEnrollment) throw new NotFoundError('Path enrollment not found');
        if (pathEnrollment.employeeId !== req.user!.employeeId) throw new BadRequestError('You can only respond to your own nomination');
        if (pathEnrollment.status !== 'NOMINATED') throw new BadRequestError('This enrollment is not awaiting a response');

        const updated = await prisma.pathEnrollment.update({ where: { id }, data: { status: 'REJECTED' } });
        res.json({ success: true, data: { pathEnrollment: updated }, message: 'Nomination declined' });
    })
);

// ─── POST /api/learning/path-enrollments/:id/approve, /reject ───

router.post(
    '/path-enrollments/:id/approve',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path enrollment ID');

        const pathEnrollment = await prisma.pathEnrollment.findUnique({ where: { id }, include: { path: { select: { title: true, courses: { orderBy: { sortOrder: 'asc' }, take: 1 } } } } });
        if (!pathEnrollment) throw new NotFoundError('Path enrollment not found');
        if (pathEnrollment.status !== 'PENDING_APPROVAL') throw new BadRequestError('This enrollment is not awaiting approval');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(pathEnrollment.employeeId)) {
            throw new ForbiddenError('You can only approve requests from your own reporting hierarchy');
        }

        const updated = await prisma.pathEnrollment.update({ where: { id }, data: { status: 'NOT_STARTED' } });

        const firstCourseId = pathEnrollment.path.courses[0]?.courseId;
        if (firstCourseId) {
            await prisma.enrollment.upsert({
                where: { courseId_employeeId: { courseId: firstCourseId, employeeId: pathEnrollment.employeeId } },
                update: {},
                create: { courseId: firstCourseId, employeeId: pathEnrollment.employeeId, status: 'NOT_STARTED' },
            });
        }

        const userIdMap = await getEmployeeUserIdMap([pathEnrollment.employeeId]);
        const recipientUserId = userIdMap.get(pathEnrollment.employeeId);
        if (recipientUserId) {
            await notify({
                recipientIds: [recipientUserId],
                excludeUserId: req.user!.userId,
                type: 'COURSE_APPROVAL_DECIDED',
                title: 'Enrollment approved',
                message: `Your request to enroll in "${pathEnrollment.path.title}" was approved.`,
                entityId: pathEnrollment.pathId,
                employeeId: pathEnrollment.employeeId,
            });
        }

        res.json({ success: true, data: { pathEnrollment: updated }, message: 'Enrollment approved' });
    })
);

router.post(
    '/path-enrollments/:id/reject',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    asyncHandler(async (req, res) => {
        const id = parseInt(req.params['id'] as string, 10);
        if (isNaN(id)) throw new BadRequestError('Invalid path enrollment ID');

        const pathEnrollment = await prisma.pathEnrollment.findUnique({ where: { id }, include: { path: { select: { title: true } } } });
        if (!pathEnrollment) throw new NotFoundError('Path enrollment not found');
        if (pathEnrollment.status !== 'PENDING_APPROVAL') throw new BadRequestError('This enrollment is not awaiting approval');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds && !scopedIds.includes(pathEnrollment.employeeId)) {
            throw new ForbiddenError('You can only decide on requests from your own reporting hierarchy');
        }

        const updated = await prisma.pathEnrollment.update({ where: { id }, data: { status: 'REJECTED' } });

        const userIdMap = await getEmployeeUserIdMap([pathEnrollment.employeeId]);
        const recipientUserId = userIdMap.get(pathEnrollment.employeeId);
        if (recipientUserId) {
            await notify({
                recipientIds: [recipientUserId],
                excludeUserId: req.user!.userId,
                type: 'COURSE_APPROVAL_DECIDED',
                title: 'Enrollment request declined',
                message: `Your request to enroll in "${pathEnrollment.path.title}" was declined.`,
                entityId: pathEnrollment.pathId,
                employeeId: pathEnrollment.employeeId,
            });
        }

        res.json({ success: true, data: { pathEnrollment: updated }, message: 'Enrollment rejected' });
    })
);

// ─── POST /api/learning/paths/:id/assign ─────────────────────────
// HR/Manager assigns a path to one or more employees, with an optional due date.

const assignPathSchema = z.object({
    employeeIds: z.array(z.number().int().positive()).min(1, 'Select at least one employee'),
    dueDate: z.string().optional(),
});

router.post(
    '/paths/:id/assign',
    authorize('HR', 'MANAGER', 'LEADERSHIP'),
    validate(assignPathSchema),
    asyncHandler(async (req, res) => {
        const pathId = parseInt(req.params['id'] as string, 10);
        if (isNaN(pathId)) throw new BadRequestError('Invalid path ID');

        const { employeeIds, dueDate } = req.body as z.infer<typeof assignPathSchema>;

        const path = await prisma.learningPath.findUnique({
            where: { id: pathId },
            include: { courses: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        });
        if (!path) throw new NotFoundError('Learning path not found');
        if (path.state !== 'PUBLISHED') throw new BadRequestError('Only published paths can be assigned');

        const scopedIds = await getScopedEmployeeIds(req);
        if (scopedIds) {
            const outOfScope = employeeIds.filter((id) => !scopedIds.includes(id));
            if (outOfScope.length > 0) {
                throw new ForbiddenError('You can only assign this path to your own reporting hierarchy');
            }
        }

        const existing = await prisma.pathEnrollment.findMany({
            where: { pathId, employeeId: { in: employeeIds } },
            select: { employeeId: true },
        });
        const alreadyEnrolled = new Set(existing.map((e) => e.employeeId));
        const toCreate = employeeIds.filter((id) => !alreadyEnrolled.has(id));

        if (toCreate.length > 0) {
            await prisma.pathEnrollment.createMany({
                data: toCreate.map((employeeId) => ({
                    pathId,
                    employeeId,
                    status: 'NOT_STARTED' as const,
                    assignedById: req.user!.userId,
                    dueDate: dueDate ? new Date(dueDate) : null,
                })),
            });

            const firstCourseId = path.courses[0]?.courseId;
            if (firstCourseId) {
                for (const employeeId of toCreate) {
                    await prisma.enrollment.upsert({
                        where: { courseId_employeeId: { courseId: firstCourseId, employeeId } },
                        update: {},
                        create: { courseId: firstCourseId, employeeId, status: 'NOT_STARTED', assignedById: req.user!.userId },
                    });
                }
            }

            const userIdMap = await getEmployeeUserIdMap(toCreate);
            await notify({
                recipientIds: userIdMap.values(),
                excludeUserId: req.user!.userId,
                type: 'PATH_ASSIGNED',
                title: 'New learning path assigned',
                message: `You've been assigned "${path.title}"${dueDate ? ` — due ${new Date(dueDate).toLocaleDateString('en-IN')}` : ''}.`,
                entityId: pathId,
            });
        }

        res.status(201).json({
            success: true,
            data: { assignedCount: toCreate.length, alreadyEnrolledCount: alreadyEnrolled.size },
            message: toCreate.length > 0 ? `Assigned to ${toCreate.length} employee(s)` : 'All selected employees were already enrolled',
        });
    })
);

// ─── GET /api/learning/my/path-enrollments ───────────────────────

router.get(
    '/my/path-enrollments',
    asyncHandler(async (req, res) => {
        const employeeId = req.user!.employeeId;
        if (!employeeId) throw new BadRequestError('Your account is not linked to an employee profile');

        const pathEnrollments = await prisma.pathEnrollment.findMany({
            where: { employeeId },
            include: {
                path: { include: { courses: { orderBy: { sortOrder: 'asc' }, include: { course: { select: { id: true, title: true } } } } } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Annotate each path's courses with this learner's completion status for them
        const courseIds = pathEnrollments.flatMap((pe) => pe.path.courses.map((pc) => pc.courseId));
        const courseEnrollments = courseIds.length > 0
            ? await prisma.enrollment.findMany({
                where: { employeeId, courseId: { in: courseIds } },
                select: { courseId: true, status: true },
            })
            : [];
        const statusByCourseId = new Map(courseEnrollments.map((e) => [e.courseId, e.status]));

        const result = pathEnrollments.map((pe) => ({
            ...pe,
            path: {
                ...pe.path,
                courses: pe.path.courses.map((pc) => ({
                    ...pc,
                    enrollmentStatus: statusByCourseId.get(pc.courseId) ?? 'NOT_STARTED',
                })),
            },
        }));

        res.json({ success: true, data: { pathEnrollments: result } });
    })
);

// ─── Path completion evaluation ──────────────────────────────────
// Called whenever a course completes — checks whether that completion finishes any learning
// path the employee is enrolled in, and if SEQUENTIAL, auto-enrolls them in the next course.

async function evaluatePathProgress(employeeId: number, completedCourseId: number): Promise<void> {
    const pathCourseLinks = await prisma.learningPathCourse.findMany({
        where: { courseId: completedCourseId },
        select: { pathId: true },
    });
    if (pathCourseLinks.length === 0) return;

    for (const { pathId } of pathCourseLinks) {
        const pathEnrollment = await prisma.pathEnrollment.findUnique({ where: { pathId_employeeId: { pathId, employeeId } } });
        if (!pathEnrollment || pathEnrollment.status === 'COMPLETED') continue;

        if (pathEnrollment.status === 'NOT_STARTED') {
            await prisma.pathEnrollment.update({ where: { id: pathEnrollment.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
        }

        const path = await prisma.learningPath.findUnique({
            where: { id: pathId },
            include: { courses: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!path) continue;

        const courseIds = path.courses.map((c) => c.courseId);
        const completedEnrollments = await prisma.enrollment.findMany({
            where: { employeeId, courseId: { in: courseIds }, status: 'COMPLETED' },
            select: { courseId: true },
        });
        const completedSet = new Set(completedEnrollments.map((e) => e.courseId));

        if (courseIds.every((id) => completedSet.has(id))) {
            await prisma.pathEnrollment.update({
                where: { id: pathEnrollment.id },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });
            await evaluatePathCompletionBadges(employeeId);
            continue;
        }

        if (path.navigationMode === 'SEQUENTIAL') {
            const completedIdx = path.courses.findIndex((c) => c.courseId === completedCourseId);
            const next = path.courses[completedIdx + 1];
            if (next) {
                await prisma.enrollment.upsert({
                    where: { courseId_employeeId: { courseId: next.courseId, employeeId } },
                    update: {},
                    create: { courseId: next.courseId, employeeId, status: 'NOT_STARTED' },
                });
            }
        }
    }
}

// ─── GET /api/learning/employees/:employeeId/summary ────────────
// Read-only L&D summary for one employee — surfaced on the Performance tab (BRD FR-7.3).
// Self, or anyone with access to that employee's data (manager/HR/leadership) per the same
// permission rules as the rest of the employee-scoped views (attendance, leaves, etc.).

router.get(
    '/employees/:employeeId/summary',
    asyncHandler(async (req, res) => {
        const employeeId = parseInt(req.params['employeeId'] as string, 10);
        if (isNaN(employeeId)) throw new BadRequestError('Invalid employee ID');

        await assertCanAccessEmployee(req, employeeId, {
            self: 'You can only view your own learning summary',
            team: 'You can only view your team\'s learning summary',
        });

        const [courseEnrollments, pathEnrollments, iltRegistrations, certificates] = await Promise.all([
            prisma.enrollment.findMany({
                where: { employeeId },
                select: { status: true, course: { select: { mandatory: true } } },
            }),
            prisma.pathEnrollment.findMany({
                where: { employeeId },
                select: { status: true },
            }),
            prisma.iLTRegistration.findMany({
                where: { employeeId },
                select: { status: true },
            }),
            prisma.certificate.count({
                where: { enrollment: { employeeId } },
            }),
        ]);

        const mandatoryCourses = courseEnrollments.filter((e) => e.course.mandatory);
        const summary = {
            courses: {
                total: courseEnrollments.length,
                completed: courseEnrollments.filter((e) => e.status === 'COMPLETED').length,
                inProgress: courseEnrollments.filter((e) => e.status === 'IN_PROGRESS').length,
                mandatoryTotal: mandatoryCourses.length,
                mandatoryCompleted: mandatoryCourses.filter((e) => e.status === 'COMPLETED').length,
            },
            paths: {
                total: pathEnrollments.length,
                completed: pathEnrollments.filter((e) => e.status === 'COMPLETED').length,
                inProgress: pathEnrollments.filter((e) => e.status === 'IN_PROGRESS').length,
            },
            ilt: {
                attended: iltRegistrations.filter((r) => r.status === 'ATTENDED').length,
                noShow: iltRegistrations.filter((r) => r.status === 'NO_SHOW').length,
                upcoming: iltRegistrations.filter((r) => r.status === 'REGISTERED' || r.status === 'WAITLISTED').length,
            },
            certificatesEarned: certificates,
        };

        res.json({ success: true, data: { summary } });
    })
);

export { evaluateCourseCompletion, evaluatePathProgress };
export default router;
