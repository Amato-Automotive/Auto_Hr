import prisma from '../config/db.js';
import type { TimeLog } from './protocol.js';

// Same rules as the biometric file upload in routes/attendance.ts (processAttendanceRecords).
// Grace-late handling is applied when attendance is read, not stored here.
const LATE_THRESHOLD = '09:30:00';
const OVERTIME_AFTER = '18:00:00';
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Statuses HR sets deliberately — punches never overwrite these. */
const PUNCH_OWNED_STATUSES = new Set(['PRESENT', 'ABSENT']);

const toSeconds = (hms: string) => {
    const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s;
};
const toHms = (secs: number) =>
    [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60].map((v) => String(v).padStart(2, '0')).join(':');
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
/** "1 hr 5 mins" — same wording as the file-upload path. */
const formatLateBy = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return [hrs > 0 ? `${hrs} hr` : '', mins > 0 ? `${mins} mins` : ''].filter(Boolean).join(' ') || '0 mins';
};

// ─── Devices ─────────────────────────────────────────────────

const deviceIdBySerial = new Map<string, number>();
const lastTouchedAt = new Map<string, number>();

/** Returns the device's id, creating it on first contact; records last-seen at most every 30s. */
export async function touchDevice(serialNo: string, terminalType: string | null, ip: string | null): Promise<number> {
    const now = Date.now();
    const cached = deviceIdBySerial.get(serialNo);
    if (cached && now - (lastTouchedAt.get(serialNo) ?? 0) < 30_000) return cached;

    const device = await prisma.biometricDevice.upsert({
        where: { serialNo },
        update: { lastSeenAt: new Date(now), lastIp: ip, ...(terminalType ? { terminalType } : {}) },
        create: { serialNo, terminalType, lastSeenAt: new Date(now), lastIp: ip },
        select: { id: true },
    });
    deviceIdBySerial.set(serialNo, device.id);
    lastTouchedAt.set(serialNo, now);
    return device.id;
}

// ─── Punches ─────────────────────────────────────────────────

export interface SavedPunch {
    duplicate: boolean;
    employeeId: number | null;
    date: string;
}

/** Persists one punch. Idempotent per (device, TransID), so a re-sent record is just reported as a duplicate. */
export async function savePunch(deviceId: number, log: TimeLog): Promise<SavedPunch> {
    const employee = await prisma.employee.findUnique({ where: { biometricId: log.userId }, select: { id: true } });
    const employeeId = employee?.id ?? null;
    const wallClockAsUtc = new Date(`${log.date}T${log.time}.000Z`).getTime();

    // The device routinely sends a record twice; skipDuplicates makes the repeat a silent no-op
    // (count 0) instead of a unique-constraint error that Prisma would log every time.
    const { count } = await prisma.biometricPunch.createMany({
        data: [{
            deviceId,
            transId: log.transId,
            biometricUserId: log.userId,
            employeeId,
            punchDate: dateOnly(log.date),
            punchTime: log.time,
            punchedAt: new Date(wallClockAsUtc - IST_OFFSET_MS),
            attendStat: log.attendStat,
            verifyMode: log.verifyMode,
        }],
        skipDuplicates: true,
    });
    return { duplicate: count === 0, employeeId, date: log.date };
}

// ─── Daily attendance ────────────────────────────────────────

export type RecomputeResult = 'updated' | 'created' | 'protected' | 'no-punches';

/**
 * Rebuilds one employee's attendance row for one day from all their punches that day:
 * first punch = check-in, last punch = check-out (when there's more than one).
 * Leaves the row alone if HR corrected it or set a non-punch status (WFH, On Duty, leave, ...).
 */
export async function recomputeDay(employeeId: number, ymd: string): Promise<RecomputeResult> {
    const date = dateOnly(ymd);
    const [punches, existing, correction] = await Promise.all([
        prisma.biometricPunch.findMany({
            where: { employeeId, punchDate: date },
            select: { punchTime: true },
            orderBy: { punchTime: 'asc' },
        }),
        prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date } } }),
        prisma.attendanceCorrection.findFirst({ where: { employeeId, date }, select: { id: true } }),
    ]);
    if (punches.length === 0) return 'no-punches';
    if (correction || (existing && !PUNCH_OWNED_STATUSES.has(existing.status))) return 'protected';

    const checkIn = punches[0]!.punchTime;
    const last = punches[punches.length - 1]!.punchTime;
    const checkOut = punches.length > 1 && last !== checkIn ? last : null;

    const lateSecs = toSeconds(checkIn) - toSeconds(LATE_THRESHOLD);
    const isLate = lateSecs > 0;
    const otSecs = checkOut ? toSeconds(checkOut) - toSeconds(OVERTIME_AFTER) : 0;

    const fields = {
        day: DAY_NAMES[date.getUTCDay()] ?? '',
        checkIn,
        checkOut,
        totalWorkingHours: checkOut ? toHms(toSeconds(checkOut) - toSeconds(checkIn)) : null,
        isLate,
        lateBy: isLate ? formatLateBy(lateSecs) : '',
        overtime: otSecs > 0,
        otTime: otSecs > 0 ? toHms(otSecs) : '',
        status: 'PRESENT' as const,
    };

    if (existing) {
        await prisma.attendance.update({ where: { id: existing.id }, data: fields });
        return 'updated';
    }
    await prisma.attendance.create({ data: { employeeId, date, ...fields } });
    return 'created';
}

/**
 * Links punches whose device user ID had no matching Employee.biometricId at receive time
 * (e.g. HR set the ID later), then rebuilds the affected days.
 */
export async function reprocessUnmappedPunches(): Promise<{ linked: number; daysRebuilt: number; stillUnmapped: number }> {
    const unmappedIds = await prisma.biometricPunch.findMany({
        where: { employeeId: null },
        distinct: ['biometricUserId'],
        select: { biometricUserId: true },
    });
    const employees = await prisma.employee.findMany({
        where: { biometricId: { in: unmappedIds.map((u) => u.biometricUserId) } },
        select: { id: true, biometricId: true },
    });

    let linked = 0;
    const days = new Set<string>();
    for (const employee of employees) {
        const punches = await prisma.biometricPunch.findMany({
            where: { employeeId: null, biometricUserId: employee.biometricId! },
            select: { punchDate: true },
        });
        const result = await prisma.biometricPunch.updateMany({
            where: { employeeId: null, biometricUserId: employee.biometricId! },
            data: { employeeId: employee.id },
        });
        linked += result.count;
        for (const p of punches) days.add(`${employee.id}|${p.punchDate.toISOString().slice(0, 10)}`);
    }

    for (const key of days) {
        const [employeeId, ymd] = key.split('|');
        await recomputeDay(Number(employeeId), ymd!);
    }

    const stillUnmapped = await prisma.biometricPunch.count({ where: { employeeId: null } });
    return { linked, daysRebuilt: days.size, stillUnmapped };
}
