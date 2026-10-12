/**
 * Secureye / Smackbio "Event Transfer Mode = TCP/IP" push protocol (TerminalType M50, e.g. S-F4BK).
 *
 * The device opens a TCP connection to the host and sends NUL-terminated XML messages:
 *   <?xml version="1.0"?><Message><TerminalType>M50</TerminalType><DeviceUID>..</DeviceUID>
 *   <TerminalID>1</TerminalID><DeviceSerialNo>S/N..</DeviceSerialNo><TransID>45143</TransID>
 *   <Event>TimeLog</Event><Year>2026</Year>...<UserID>31</UserID><AttendStat>Duty Off</AttendStat>
 *   <VerifMode>Face</VerifMode>...</Message>\0
 *
 * Each TimeLog/AdminLog must be acknowledged, or the device resends the same record forever:
 *   <?xml version="1.0"?><Message><Request>UploadedLog</Request><TransID>45143</TransID></Message>\0
 * KeepAlive is answered with Request=KeptAlive. (Format taken from SbLogServer.dll shipped in
 * Secureye's ONtime Attendance installer.)
 */

export type DeviceEvent = 'TimeLog' | 'AdminLog' | 'KeepAlive' | 'Alarm' | 'VerifyUserReq' | string;

export interface DeviceMessage {
    event: DeviceEvent | null;
    transId: number | null;
    serialNo: string | null;
    terminalType: string | null;
}

export interface TimeLog {
    transId: number;
    serialNo: string;
    terminalType: string | null;
    userId: number;
    /** Device wall-clock date, YYYY-MM-DD. */
    date: string;
    /** Device wall-clock time, HH:MM:SS. */
    time: string;
    attendStat: string | null;
    verifyMode: string | null;
}

/** Largest message we buffer before treating the stream as garbage (photos can make TimeLogs big). */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

function tag(xml: string, name: string): string | null {
    const match = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
    return match ? match[1]!.trim() : null;
}

function toInt(value: string | null): number | null {
    if (value === null || !/^\d+$/.test(value)) return null;
    return Number(value);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Splits a receive buffer into complete NUL-terminated messages; returns the unfinished remainder. */
export function splitMessages(buffer: string): { messages: string[]; rest: string } {
    const parts = buffer.split('\0');
    const rest = parts.pop() ?? '';
    return { messages: parts.map((p) => p.trim()).filter(Boolean), rest };
}

export function parseMessage(xml: string): DeviceMessage {
    return {
        event: tag(xml, 'Event'),
        transId: toInt(tag(xml, 'TransID')),
        serialNo: tag(xml, 'DeviceSerialNo'),
        terminalType: tag(xml, 'TerminalType'),
    };
}

/** Parses a TimeLog message, or returns null if any required field is missing or out of range. */
export function parseTimeLog(xml: string): TimeLog | null {
    const msg = parseMessage(xml);
    const userId = toInt(tag(xml, 'UserID'));
    const [y, mo, d, h, mi, s] = ['Year', 'Month', 'Day', 'Hour', 'Minute', 'Second'].map((t) => toInt(tag(xml, t)));
    if (msg.event !== 'TimeLog' || msg.transId === null || !msg.serialNo || userId === null) return null;
    if (y == null || mo == null || d == null || h == null || mi == null || s == null) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

    return {
        transId: msg.transId,
        serialNo: msg.serialNo,
        terminalType: msg.terminalType,
        userId,
        date: `${y}-${pad2(mo)}-${pad2(d)}`,
        time: `${pad2(h)}:${pad2(mi)}:${pad2(s)}`,
        attendStat: tag(xml, 'AttendStat'),
        verifyMode: tag(xml, 'VerifMode'),
    };
}

export function buildReply(request: 'UploadedLog' | 'KeptAlive', transId: number): string {
    return `<?xml version="1.0"?><Message><Request>${request}</Request><TransID>${transId}</TransID></Message>\0`;
}
