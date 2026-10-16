/**
 * Short leave: 2 hours at the start ("Morning") or end ("Evening") of a working day.
 * One per calendar month (pending or approved), not carried forward, never spans days and
 * doesn't consume paid-leave quota. Stored as an ordinary Leave row with `days = 0`; the slot
 * is part of the type string so no schema change is needed.
 */
export const SHORT_LEAVE_MORNING = 'Short Leave (Morning)';
export const SHORT_LEAVE_EVENING = 'Short Leave (Evening)';
export const SHORT_LEAVE_TYPES = [SHORT_LEAVE_MORNING, SHORT_LEAVE_EVENING] as const;
export const SHORT_LEAVE_HOURS = 2;
export const SHORT_LEAVES_PER_MONTH = 1;

/** Office-time window each short leave covers (office day starts 9:30, ends 6:00 PM). */
export const SHORT_LEAVE_WINDOWS: Record<string, string> = {
    [SHORT_LEAVE_MORNING]: '9:30–11:30 AM',
    [SHORT_LEAVE_EVENING]: '4:00–6:00 PM',
};

export function isShortLeave(type: string | null | undefined): boolean {
    return Boolean(type && (SHORT_LEAVE_TYPES as readonly string[]).includes(type));
}

/** Prisma filter that excludes short leaves (for "who is away today"-style full-day counts). */
export const NOT_SHORT_LEAVE = { type: { notIn: [...SHORT_LEAVE_TYPES] } };

/** Inclusive list of YYYY-MM-DD dates from `startYmd` to `endYmd`. */
export function datesInRange(startYmd: string, endYmd: string): string[] {
    const dates: string[] = [];
    const day = new Date(`${startYmd}T00:00:00.000Z`);
    const stop = new Date(`${endYmd}T00:00:00.000Z`);
    while (day <= stop) {
        dates.push(day.toISOString().slice(0, 10));
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return dates;
}

/** The office works Monday–Saturday: Sundays and company holidays inside a leave aren't charged. */
export function isChargeableLeaveDay(ymd: string, holidayDates: Set<string>): boolean {
    return new Date(`${ymd}T00:00:00.000Z`).getUTCDay() !== 0 && !holidayDates.has(ymd);
}
