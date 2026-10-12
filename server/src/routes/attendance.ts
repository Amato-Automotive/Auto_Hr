import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import { isIPv4 } from 'node:net';
import prisma from '../config/db.js';
import { env } from '../config/env.js';
import {
    authenticate,
    authorize,
    scopeData,
    assertCanAccessEmployee,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BadRequestError } from '../utils/errors.js';
import { notify, getManagerAndHrUserIds } from '../utils/notificationService.js';
import { reprocessUnmappedPunches } from '../biometric/attendance.js';
import { isShortLeave, SHORT_LEAVE_MORNING } from '../utils/leaveRules.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate, scopeData);

// ─── Validation schemas ──────────────────────────────────────

const manualEntrySchema = z.object({
    employeeId: z.number().int().positive(),
    date: z.string().min(1),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL']).optional(),
});

const selfCorrectionSchema = z.object({
    employeeId: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL']),
    checkIn: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
    checkOut: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
    reason: z.string().trim().min(3, 'Reason is required').max(1000),
});

function calculateWorkingHours(checkIn?: string | null, checkOut?: string | null): string | null {
    if (!checkIn || !checkOut) return null;
    const toSeconds = (value: string) => {
        const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    };
    const difference = toSeconds(checkOut) - toSeconds(checkIn);
    if (!Number.isFinite(difference) || difference < 0) return null;
    const hours = Math.floor(difference / 3600);
    const minutes = Math.floor((difference % 3600) / 60);
    const seconds = difference % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}


// ─── Biometric file parsing (ported from Python) ─────────────

interface BiometricRecord {
    enNo: number;
    dateTime: Date;
    date: string;
    time: string;
}

function parseBiometricFile(buffer: Buffer): BiometricRecord[] {
    const records: BiometricRecord[] = [];

    // Detect BOM or check for null bytes to identify UTF-16LE encoding
    let encoding: BufferEncoding = 'utf-8';
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        encoding = 'utf16le';
    } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        encoding = 'utf16le';
    } else {
        // Fallback: if it contains a high density of null bytes, it's UTF-16LE
        let nullCount = 0;
        const testLen = Math.min(buffer.length, 1000);
        for (let i = 0; i < testLen; i++) {
            if (buffer[i] === 0) nullCount++;
        }
        if (nullCount > testLen / 4) {
            encoding = 'utf16le';
        }
    }

    const content = buffer.toString(encoding).trim();
    // Remove any trailing or remaining null bytes
    const cleanedContent = content.replace(/\0/g, '');

    const lines = cleanedContent.split(/\r?\n/);
    const dataLines = lines.slice(1);

    for (const line of dataLines) {
        if (!line.trim()) continue;

        const enNoMatch = line.match(/\b(0+\d+)\b/);
        const dtMatch = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);

        if (enNoMatch && dtMatch) {
            const enNo = parseInt(enNoMatch[1]!, 10);
            const dt = new Date(dtMatch[1]!);

            if (!isNaN(dt.getTime())) {
                records.push({
                    enNo,
                    dateTime: dt,
                    date: dtMatch[1]!.split(' ')[0]!,
                    time: dtMatch[1]!.split(' ')[1]!,
                });
            }
        }
    }

    return records;
}

function processAttendanceRecords(records: BiometricRecord[]) {
    // Group by employee + date
    const grouped = new Map<string, BiometricRecord[]>();

    for (const record of records) {
        const key = `${record.enNo}-${record.date}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(record);
    }

    const LATE_THRESHOLD = '09:30:00';
    const results: Array<{
        biometricId: number;
        date: string;
        day: string;
        checkIn: string;
        checkOut: string;
        totalWorkingHours: string;
        isLate: boolean;
        lateBy: string;
        overtime: boolean;
        otTime: string;
    }> = [];

    for (const [, dayRecords] of grouped) {
        const first = dayRecords[0]!;
        const times = dayRecords.map(r => r.dateTime);
        const minTime = new Date(Math.min(...times.map(t => t.getTime())));
        const maxTime = new Date(Math.max(...times.map(t => t.getTime())));

        const inTime = minTime.toTimeString().slice(0, 8);
        const outTime = maxTime.toTimeString().slice(0, 8);

        // Check late
        const isLate = inTime > LATE_THRESHOLD;
        let lateBy = '';
        if (isLate) {
            const lateSecs = (minTime.getHours() * 3600 + minTime.getMinutes() * 60 + minTime.getSeconds()) -
                (9 * 3600 + 30 * 60);
            const hrs = Math.floor(lateSecs / 3600);
            const mins = Math.floor((lateSecs % 3600) / 60);
            const parts = [];
            if (hrs > 0) parts.push(`${hrs} hr`);
            if (mins > 0) parts.push(`${mins} mins`);
            lateBy = parts.join(' ') || '0 mins';
        }

        // Working hours
        const workSecs = Math.floor((maxTime.getTime() - minTime.getTime()) / 1000);
        const wh = Math.floor(workSecs / 3600);
        const wm = Math.floor((workSecs % 3600) / 60);
        const ws = workSecs % 60;
        const totalWorkingHours = `${String(wh).padStart(2, '0')}:${String(wm).padStart(2, '0')}:${String(ws).padStart(2, '0')}`;

        // Overtime (after 18:00)
        const overtime = outTime > '18:00:00';
        let otTime = '';
        if (overtime) {
            const otSecs = (maxTime.getHours() * 3600 + maxTime.getMinutes() * 60 + maxTime.getSeconds()) - (18 * 3600);
            if (otSecs > 0) {
                const oh = Math.floor(otSecs / 3600);
                const om = Math.floor((otSecs % 3600) / 60);
                const os = otSecs % 60;
                otTime = `${String(oh).padStart(2, '0')}:${String(om).padStart(2, '0')}:${String(os).padStart(2, '0')}`;
            }
        }

        const dateObj = new Date(first.date);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        results.push({
            biometricId: first.enNo,
            date: first.date,
            day: days[dateObj.getDay()] || '',
            checkIn: inTime,
            checkOut: outTime,
            totalWorkingHours,
            isLate,
            lateBy,
            overtime,
            otTime,
        });
    }

    return results;
}

// ─── GET /api/attendance/:employeeId ─────────────────────────

router.get(
    '/:employeeId',
    asyncHandler(async (req, res) => {
        const employeeId = parseInt(req.params['employeeId'] as string, 10);
        if (isNaN(employeeId)) throw new BadRequestError('Invalid employee ID');

        await assertCanAccessEmployee(req, employeeId, {
            self: 'You can only view your own attendance',
            team: 'You can only view your team\'s attendance',
        });

        const month = req.query['month'] as string | undefined;
        const startDate = req.query['startDate'] as string | undefined;
        const endDate = req.query['endDate'] as string | undefined;

        let start: Date;
        let end: Date;

        if (month) {
            const [year, mon] = month.split('-').map(Number);
            const lastDay = new Date(year!, mon!, 0).getDate();
            const startStr = `${year}-${String(mon).padStart(2, '0')}-01T00:00:00.000Z`;
            const endStr = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;
            start = new Date(startStr);
            end = new Date(endStr);
        } else if (startDate && endDate) {
            start = new Date(`${startDate}T00:00:00.000Z`);
            end = new Date(`${endDate}T23:59:59.999Z`);
        } else {
            const d = new Date();
            const year = d.getFullYear();
            const mon = d.getMonth() + 1;
            const lastDay = new Date(year, mon, 0).getDate();
            start = new Date(`${year}-${String(mon).padStart(2, '0')}-01T00:00:00.000Z`);
            end = new Date(`${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`);
        }

        const [attendance, holidays, leaves] = await Promise.all([
            prisma.attendance.findMany({
                where: {
                    employeeId,
                    date: { gte: start, lte: end },
                },
                orderBy: { date: 'asc' },
            }),
            prisma.holiday.findMany({
                where: {
                    date: { gte: start, lte: end },
                },
            }),
            prisma.leave.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
            }),
        ]);

        const dbAttendanceMap = new Map(
            attendance.map((a) => [a.date.toISOString().split('T')[0]!, a])
        );

        const holidayMap = new Map(
            holidays.map((h) => [h.date.toISOString().split('T')[0]!, h.name])
        );

        // Short leaves (2 hours) never turn a day into "On leave"; they're tracked per date instead.
        const shortLeaveByDate = new Map(
            leaves
                .filter((leave) => isShortLeave(leave.type))
                .map((leave) => [leave.startDate.toISOString().slice(0, 10), leave.type === SHORT_LEAVE_MORNING ? 'Morning' : 'Evening'])
        );

        const getApprovedLeaveType = (dateStr: string): string | null => {
            const d = new Date(`${dateStr}T00:00:00.000Z`);
            for (const leave of leaves) {
                if (isShortLeave(leave.type)) continue;
                const s = new Date(leave.startDate);
                s.setUTCHours(0, 0, 0, 0);
                const e = new Date(leave.endDate);
                e.setUTCHours(0, 0, 0, 0);
                if (d >= s && d <= e) {
                    return leave.type || 'Leave';
                }
            }
            return null;
        };

        const getDaysInRange = (startDate: Date, endDate: Date): Date[] => {
            const daysList: Date[] = [];
            const current = new Date(startDate);
            current.setUTCHours(0, 0, 0, 0);
            const stop = new Date(endDate);
            stop.setUTCHours(0, 0, 0, 0);

            while (current <= stop) {
                daysList.push(new Date(current));
                current.setUTCDate(current.getUTCDate() + 1);
            }
            return daysList;
        };

        const getDayName = (date: Date): string => {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return days[date.getUTCDay()] || '';
        };

        const mergedRecords: any[] = [];
        const days = getDaysInRange(start, end);
        const todayStr = new Date().toISOString().split('T')[0]!;

        for (const day of days) {
            const dateStr = day.toISOString().split('T')[0]!;
            const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
            const dbRecord = dbAttendanceMap.get(dateStr);

            if (dbRecord) {
                mergedRecords.push({
                    id: dbRecord.id,
                    employeeId: dbRecord.employeeId,
                    date: dateStr,
                    day: dbRecord.day || getDayName(day),
                    checkIn: dbRecord.checkIn,
                    checkOut: dbRecord.checkOut,
                    totalWorkingHours: dbRecord.totalWorkingHours,
                    isLate: dbRecord.isLate,
                    lateBy: dbRecord.lateBy,
                    overtime: dbRecord.overtime,
                    otTime: dbRecord.otTime,
                    status: dbRecord.status,
                    isVirtual: false,
                    isGraceLate: false,
                });
            } else {
                if (isWeekend) continue;

                const holidayName = holidayMap.get(dateStr);
                const leaveType = getApprovedLeaveType(dateStr);
                const isPastOrToday = dateStr <= todayStr;

                if (holidayName) {
                    mergedRecords.push({
                        id: 0,
                        employeeId,
                        date: dateStr,
                        day: getDayName(day),
                        checkIn: null,
                        checkOut: null,
                        totalWorkingHours: null,
                        isLate: false,
                        lateBy: null,
                        overtime: false,
                        otTime: null,
                        status: 'HOLIDAY',
                        holidayName,
                        isVirtual: true,
                        isGraceLate: false,
                    });
                } else if (leaveType) {
                    mergedRecords.push({
                        id: 0,
                        employeeId,
                        date: dateStr,
                        day: getDayName(day),
                        checkIn: null,
                        checkOut: null,
                        totalWorkingHours: null,
                        isLate: false,
                        lateBy: null,
                        overtime: false,
                        otTime: null,
                        status: 'ON_LEAVE',
                        leaveType,
                        isVirtual: true,
                        isGraceLate: false,
                    });
                } else if (isPastOrToday) {
                    mergedRecords.push({
                        id: 0,
                        employeeId,
                        date: dateStr,
                        day: getDayName(day),
                        checkIn: null,
                        checkOut: null,
                        totalWorkingHours: null,
                        isLate: false,
                        lateBy: null,
                        overtime: false,
                        otTime: null,
                        status: 'ABSENT',
                        isVirtual: true,
                        isGraceLate: false,
                    });
                }
            }
        }

        // Sort ascending to calculate running grace late counter chronologically
        mergedRecords.sort((a, b) => a.date.localeCompare(b.date));

        let graceLateCount = 0;
        let totalLateMinutes = 0;
        let lateCheckInCount = 0;

        for (const record of mergedRecords) {
            const shortLeave = shortLeaveByDate.get(record.date);
            if (shortLeave) record.shortLeave = shortLeave;
            // A morning short leave covers the first two hours, so arriving later isn't "late".
            if (shortLeave === 'Morning') {
                record.isLate = false;
                record.lateBy = null;
                continue;
            }
            if (record.checkIn && record.status === 'PRESENT') {
                const checkInTime = record.checkIn;

                if (checkInTime > '09:30:00') {
                    const [hrs, mins, secs] = checkInTime.split(':').map(Number);
                    const checkInInSecs = (hrs || 0) * 3600 + (mins || 0) * 60 + (secs || 0);
                    const baseInSecs = 9 * 3600 + 30 * 60; // 09:30:00
                    const diffSecs = checkInInSecs - baseInSecs;

                    if (diffSecs > 0) {
                        const diffMins = Math.floor(diffSecs / 60);
                        record.lateBy = `${diffMins} mins`;

                        // If <= 5 min buffer, considered On Time
                        if (checkInTime <= '09:35:00') {
                            record.isLate = false;
                            record.lateBy = null;
                        } else {
                            // Contribute to average late minutes (excludes on-time buffer)
                            totalLateMinutes += diffMins;
                            lateCheckInCount++;

                            if (checkInTime <= '09:45:00') {
                                graceLateCount++;
                                if (graceLateCount <= 3) {
                                    record.isLate = false;
                                    record.isGraceLate = true;
                                } else {
                                    record.isLate = true;
                                }
                            } else {
                                record.isLate = true;
                            }
                        }
                    }
                } else {
                    record.isLate = false;
                    record.lateBy = null;
                }
            }
        }

        // Sort back to descending order (newest first) for UI display
        mergedRecords.sort((a, b) => b.date.localeCompare(a.date));

        const summary = {
            total: mergedRecords.length,
            present: mergedRecords.filter((r) => ['PRESENT', 'WFH', 'ON_DUTY', 'CLIENT_VISIT', 'BUSINESS_TRAVEL'].includes(r.status)).length,
            absent: mergedRecords.filter((r) => r.status === 'ABSENT').length,
            halfDay: mergedRecords.filter((r) => r.status === 'HALF_DAY').length,
            onLeave: mergedRecords.filter((r) => r.status === 'ON_LEAVE').length,
            holiday: mergedRecords.filter((r) => r.status === 'HOLIDAY').length,
            lateDays: mergedRecords.filter((r) => r.isLate).length,
            graceLateDays: mergedRecords.filter((r) => r.isGraceLate).length,
            overtimeDays: mergedRecords.filter((r) => r.overtime).length,
            avgLateMinutes: lateCheckInCount > 0 ? Math.round(totalLateMinutes / lateCheckInCount) : 0,
        };

        res.json({
            success: true,
            data: { attendance: mergedRecords, summary },
        });
    })
);

// ─── POST /api/attendance/upload/biometric ───────────────────
// Upload raw biometric .txt file (HR only)

router.post(
    '/upload/biometric',
    authorize('HR'),
    upload.single('file'),
    asyncHandler(async (req, res) => {
        if (!req.file) throw new BadRequestError('No file uploaded');

        const { targetMonth } = req.body;

        let records = parseBiometricFile(req.file.buffer);
        if (records.length === 0) throw new BadRequestError('No valid records found in file');

        if (targetMonth) {
            records = records.filter(r => r.date.startsWith(targetMonth));
            if (records.length === 0) {
                throw new BadRequestError(`No records found in file matching target month: ${targetMonth}`);
            }
        }

        const processed = processAttendanceRecords(records);

        // Map biometric IDs to employee IDs
        const biometricIds = [...new Set(processed.map(r => r.biometricId))];
        const employees = await prisma.employee.findMany({
            where: { biometricId: { in: biometricIds } },
            select: { id: true, biometricId: true },
        });
        const bioToEmpId = new Map(employees.map(e => [e.biometricId, e.id]));

        const validProcessed = processed.filter(r => bioToEmpId.has(r.biometricId));
        const unmapped = processed.length - validProcessed.length;

        let inserted = 0;
        let skipped = 0;

        if (validProcessed.length > 0) {
            try {
                await prisma.$transaction(async (tx) => {
                    const deleteConditions = validProcessed.map(r => ({
                        employeeId: bioToEmpId.get(r.biometricId)!,
                        date: new Date(r.date),
                    }));

                    await tx.attendance.deleteMany({
                        where: {
                            OR: deleteConditions,
                        },
                    });

                    await tx.attendance.createMany({
                        data: validProcessed.map(r => ({
                            employeeId: bioToEmpId.get(r.biometricId)!,
                            date: new Date(r.date),
                            day: r.day,
                            checkIn: r.checkIn,
                            checkOut: r.checkOut,
                            totalWorkingHours: r.totalWorkingHours,
                            isLate: r.isLate,
                            lateBy: r.lateBy,
                            overtime: r.overtime,
                            otTime: r.otTime,
                            status: 'PRESENT',
                        })),
                    });
                });
                inserted = validProcessed.length;
            } catch (err) {
                skipped = validProcessed.length;
            }
        }

        res.json({
            success: true,
            message: `Biometric data processed`,
            data: {
                totalRecords: records.length,
                processedDays: processed.length,
                inserted,
                skipped,
                unmappedEmployees: unmapped,
            },
        });
    })
);

// ─── POST /api/attendance/upload/excel ───────────────────────
// Upload processed Excel from attendance portal (HR only)

router.post(
    '/upload/excel',
    authorize('HR'),
    upload.single('file'),
    asyncHandler(async (req, res) => {
        if (!req.file) throw new BadRequestError('No file uploaded');

        const { targetMonth } = req.body;

        // Loaded on demand — keeps the parser out of every cold start.
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]!];
        if (!sheet) throw new BadRequestError('Empty spreadsheet');

        let rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

        if (targetMonth) {
            const [year, month] = targetMonth.split('-').map(Number);
            rows = rows.filter(row => {
                const dateStr = String(row['Date'] || '');
                if (!dateStr) return false;
                const d = new Date(dateStr);
                return d.getFullYear() === year && (d.getMonth() + 1) === month;
            });
            if (rows.length === 0) {
                throw new BadRequestError(`No records found in Excel matching target month: ${targetMonth}`);
            }
        }

        // Map biometric IDs to employee IDs
        const employees = await prisma.employee.findMany({
            select: { id: true, biometricId: true },
        });
        const bioToEmpId = new Map(employees.map(e => [e.biometricId, e.id]));

        const validRows: Array<{ empId: number; date: Date; row: Record<string, any> }> = [];
        let skipped = 0;

        for (const row of rows) {
            const bioId = Number(row['ID']);
            const empId = bioToEmpId.get(bioId);
            const dateStr = String(row['Date'] || '');

            if (!empId || !dateStr) {
                skipped++;
                continue;
            }

            validRows.push({
                empId,
                date: new Date(dateStr),
                row,
            });
        }

        let inserted = 0;

        if (validRows.length > 0) {
            try {
                await prisma.$transaction(async (tx) => {
                    const deleteConditions = validRows.map(vr => ({
                        employeeId: vr.empId,
                        date: vr.date,
                    }));

                    await tx.attendance.deleteMany({
                        where: {
                            OR: deleteConditions,
                        },
                    });

                    await tx.attendance.createMany({
                        data: validRows.map(vr => {
                            const row = vr.row;
                            const inTime = String(row['IN'] || '');
                            const remark = String(row['Remark'] || '');
                            const ot = String(row['Overtime'] || '');
                            return {
                                employeeId: vr.empId,
                                date: vr.date,
                                day: String(row['Day'] || ''),
                                checkIn: inTime || null,
                                checkOut: String(row['OUT'] || '') || null,
                                totalWorkingHours: String(row['Total working Hours'] || '') || null,
                                isLate: remark.toLowerCase().includes('late'),
                                lateBy: String(row['Late By'] || '') || null,
                                overtime: ot.toLowerCase() === 'yes',
                                otTime: String(row['OT time'] || '') || null,
                                status: inTime ? 'PRESENT' : 'ABSENT',
                            };
                        }),
                    });
                });
                inserted = validRows.length;
            } catch (err) {
                skipped += validRows.length;
            }
        }

        res.json({
            success: true,
            message: 'Excel attendance data imported',
            data: { totalRows: rows.length, inserted, skipped },
        });
    })
);

// ─── POST /api/attendance/manual ─────────────────────────────
// Manual attendance entry (HR only)

router.post(
    '/self-correction',
    validate(selfCorrectionSchema),
    asyncHandler(async (req, res) => {
        const data = req.body as z.infer<typeof selfCorrectionSchema>;
        if (req.user!.employeeId !== data.employeeId) {
            throw new BadRequestError('You can only correct your own attendance');
        }

        const date = new Date(`${data.date}T00:00:00.000Z`);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (date > today) throw new BadRequestError('Future attendance cannot be edited');

        const [holiday, approvedLeave, employee, recipientIds, existing] = await Promise.all([
            prisma.holiday.findUnique({ where: { date } }),
            prisma.leave.findFirst({
                where: { employeeId: data.employeeId, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } },
            }),
            prisma.employee.findUnique({ where: { id: data.employeeId } }),
            getManagerAndHrUserIds(data.employeeId),
            prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: data.employeeId, date } } }),
        ]);

        if (!employee) throw new BadRequestError('Employee profile not found');
        if (holiday) throw new BadRequestError('Holiday attendance cannot be corrected');
        if (approvedLeave) throw new BadRequestError('Approved leave attendance cannot be overwritten');

        const checkIn = data.checkIn?.trim() || null;
        const checkOut = data.checkOut?.trim() || null;
        const workingHours = calculateWorkingHours(checkIn, checkOut);
        if (checkIn && checkOut && !workingHours) {
            throw new BadRequestError('Check-out time must be after check-in time');
        }
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        const attendance = await prisma.$transaction(async tx => {
            const saved = await tx.attendance.upsert({
                where: { employeeId_date: { employeeId: data.employeeId, date } },
                update: {
                    status: data.status,
                    checkIn,
                    checkOut,
                    totalWorkingHours: workingHours,
                    isLate: false,
                    lateBy: null,
                    overtime: false,
                    otTime: null,
                },
                create: {
                    employeeId: data.employeeId,
                    date,
                    day: days[date.getUTCDay()] || '',
                    status: data.status,
                    checkIn,
                    checkOut,
                    totalWorkingHours: workingHours,
                },
            });

            await tx.attendanceCorrection.create({
                data: {
                    attendanceId: saved.id,
                    employeeId: data.employeeId,
                    editedById: req.user!.userId,
                    date,
                    previousStatus: existing?.status || 'ABSENT',
                    newStatus: data.status,
                    previousCheckIn: existing?.checkIn,
                    newCheckIn: checkIn,
                    previousCheckOut: existing?.checkOut,
                    newCheckOut: checkOut,
                    reason: data.reason,
                },
            });

            return saved;
        });

        await notify({
            recipientIds,
            excludeUserId: req.user!.userId,
            type: 'ATTENDANCE_CORRECTION',
            title: `${employee.name} updated attendance`,
            message: `${data.date}: ${data.status.replaceAll('_', ' ')}. Reason: ${data.reason}`,
            entityId: attendance.id,
            employeeId: data.employeeId,
        });

        res.json({ success: true, data: { attendance }, message: 'Attendance updated and managers/HR notified' });
    })
);

router.post(
    '/manual',
    authorize('HR'),
    validate(manualEntrySchema),
    asyncHandler(async (req, res) => {
        const { employeeId, date, checkIn, checkOut, status } = req.body as z.infer<typeof manualEntrySchema>;

        const dateObj = new Date(date);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        const attendance = await prisma.attendance.upsert({
            where: {
                employeeId_date: {
                    employeeId,
                    date: dateObj,
                },
            },
            update: {
                checkIn: checkIn || null,
                checkOut: checkOut || null,
                status: status || 'PRESENT',
            },
            create: {
                employeeId,
                date: dateObj,
                day: days[dateObj.getDay()] || '',
                checkIn: checkIn || null,
                checkOut: checkOut || null,
                status: status || 'PRESENT',
            },
        });

        res.json({
            success: true,
            data: { attendance },
            message: 'Attendance record saved',
        });
    })
);

// ─── Biometric push receiver (status + reprocess) ────────────
// Punches arrive via the separate receiver process (src/biometricServer.ts); these routes let HR
// see whether the device is talking to us and link punches from not-yet-mapped biometric IDs.

router.get(
    '/biometric/status',
    authorize('HR'),
    asyncHandler(async (_req, res) => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [devices, punchesLast24h, totalPunches, latestPunch, unmapped, officeIp] = await Promise.all([
            prisma.biometricDevice.findMany({
                select: { id: true, serialNo: true, terminalType: true, lastSeenAt: true, lastIp: true },
                orderBy: { lastSeenAt: 'desc' },
            }),
            prisma.biometricPunch.count({ where: { receivedAt: { gte: since } } }),
            prisma.biometricPunch.count(),
            prisma.biometricPunch.findFirst({ orderBy: { punchedAt: 'desc' }, select: { punchDate: true, punchTime: true } }),
            prisma.biometricPunch.groupBy({
                by: ['biometricUserId'],
                where: { employeeId: null },
                _count: { _all: true },
                orderBy: { biometricUserId: 'asc' },
            }),
            readOfficeIp(),
        ]);

        res.json({
            success: true,
            data: {
                devices,
                punchesLast24h,
                totalPunches,
                latestPunch: latestPunch
                    ? { date: latestPunch.punchDate.toISOString().slice(0, 10), time: latestPunch.punchTime }
                    : null,
                unmappedUsers: unmapped.map((u) => ({ biometricUserId: u.biometricUserId, punches: u._count._all })),
                officeIp,
                officeIpConfigurable: Boolean(env.BIOMETRIC_OFFICE_IP_FILE),
            },
        });
    })
);

router.post(
    '/biometric/reprocess',
    authorize('HR'),
    asyncHandler(async (_req, res) => {
        const result = await reprocessUnmappedPunches();
        res.json({
            success: true,
            data: result,
            message: `Linked ${result.linked} punch(es), rebuilt ${result.daysRebuilt} day(s)`,
        });
    })
);

// The office line has a dynamic public IP and the firewall only lets that IP reach the receiver.
// When the IP changes, an HR user at the office presses a button: we record the IP their request
// came from, and a root cron on the VPS (hr-office-ip-sync) moves the ufw rule to it. The device
// holds unacknowledged punches, so nothing is lost while the rule is stale.

async function readOfficeIp(): Promise<string | null> {
    if (!env.BIOMETRIC_OFFICE_IP_FILE) return null;
    try {
        const ip = (await fs.readFile(env.BIOMETRIC_OFFICE_IP_FILE, 'utf8')).trim();
        return isIPv4(ip) ? ip : null;
    } catch {
        return null;
    }
}

function isPublicIPv4(ip: string): boolean {
    if (!isIPv4(ip)) return false;
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return !(
        a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
}

router.post(
    '/biometric/office-ip',
    authorize('HR'),
    asyncHandler(async (req, res) => {
        if (!env.BIOMETRIC_OFFICE_IP_FILE) throw new BadRequestError('Office network update is not set up on this server');
        const ip = (req.ip || '').replace(/^::ffff:/, '');
        if (!isPublicIPv4(ip)) throw new BadRequestError(`Could not detect a public IPv4 address for this network (got "${ip}")`);

        const previous = await readOfficeIp();
        const tmp = `${env.BIOMETRIC_OFFICE_IP_FILE}.tmp`;
        await fs.writeFile(tmp, `${ip}
`);
        await fs.rename(tmp, env.BIOMETRIC_OFFICE_IP_FILE);
        console.log(`[biometric] office IP set to ${ip} (was ${previous ?? 'unset'}) by user ${req.user?.userId}`);

        res.json({
            success: true,
            data: { ip, previous },
            message: previous === ip
                ? `This network (${ip}) is already allowed`
                : `Allowed ${ip}; the device should reconnect within 2 minutes`,
        });
    })
);

export default router;
