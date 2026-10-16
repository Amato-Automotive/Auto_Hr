/** "HH:MM:SS" between check-in and check-out, or null when either is missing or out is before in. */
export function calculateWorkingHours(checkIn?: string | null, checkOut?: string | null): string | null {
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
