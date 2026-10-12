import 'dotenv/config';
import net from 'node:net';
import { env } from './config/env.js';
import prisma from './config/db.js';
import { MAX_MESSAGE_BYTES, buildReply, parseMessage, parseTimeLog, splitMessages } from './biometric/protocol.js';
import { recomputeDay, savePunch, touchDevice } from './biometric/attendance.js';

/**
 * Biometric push receiver — a separate long-running process (PM2: `hr-biometric`), because the
 * device holds a raw TCP connection open, which the HTTP API process isn't built for.
 *
 * Order per punch: save to DB → acknowledge → rebuild that day's attendance. If saving fails we
 * don't acknowledge, so the device keeps the record and resends it on its next attempt.
 */

const allowedSerials = new Set(env.BIOMETRIC_ALLOWED_SERIALS.split(',').map((s) => s.trim()).filter(Boolean));
const log = (msg: string) => console.log(`[biometric] ${msg}`);

async function handleMessage(xml: string, socket: net.Socket, remoteIp: string): Promise<boolean> {
    const msg = parseMessage(xml);
    if (!msg.serialNo) {
        log(`ignoring message without DeviceSerialNo from ${remoteIp}`);
        return true;
    }
    if (allowedSerials.size > 0 && !allowedSerials.has(msg.serialNo)) {
        log(`rejecting unknown device ${msg.serialNo} from ${remoteIp}`);
        return false; // closes the connection
    }

    const deviceId = await touchDevice(msg.serialNo, msg.terminalType, remoteIp);

    switch (msg.event) {
        case 'TimeLog': {
            const punch = parseTimeLog(xml);
            if (!punch) {
                log(`unparseable TimeLog #${msg.transId} — acknowledging so the queue isn't blocked`);
                if (msg.transId !== null) socket.write(buildReply('UploadedLog', msg.transId), 'latin1');
                return true;
            }
            const saved = await savePunch(deviceId, punch);
            socket.write(buildReply('UploadedLog', punch.transId), 'latin1');
            if (saved.duplicate) return true;

            if (saved.employeeId) {
                // The punch is already stored and acknowledged; a failure here only delays the
                // attendance row, which the next punch that day rebuilds.
                const result = await recomputeDay(saved.employeeId, saved.date)
                    .catch((error: Error) => `attendance rebuild failed: ${error.message}`);
                log(`#${punch.transId} user ${punch.userId} ${punch.date} ${punch.time} → employee ${saved.employeeId} (${result})`);
            } else {
                log(`#${punch.transId} user ${punch.userId} ${punch.date} ${punch.time} → no employee with this biometric ID (stored)`);
            }
            return true;
        }
        case 'AdminLog':
            // Device admin actions (power on, menu access) — acknowledged, not stored.
            if (msg.transId !== null) socket.write(buildReply('UploadedLog', msg.transId), 'latin1');
            return true;
        case 'KeepAlive':
            if (msg.transId !== null) socket.write(buildReply('KeptAlive', msg.transId), 'latin1');
            return true;
        default:
            log(`unhandled event "${msg.event}" #${msg.transId} — ignored`);
            return true;
    }
}

const server = net.createServer((socket) => {
    const remoteIp = (socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    let buffer = '';
    // Messages from one connection are processed strictly in order.
    let queue: Promise<void> = Promise.resolve();

    socket.setKeepAlive(true, 60_000);
    socket.setTimeout(10 * 60_000, () => socket.destroy());

    socket.on('data', (chunk) => {
        buffer += chunk.toString('latin1');
        if (buffer.length > MAX_MESSAGE_BYTES) {
            log(`message from ${remoteIp} exceeded ${MAX_MESSAGE_BYTES} bytes — dropping connection`);
            socket.destroy();
            return;
        }
        const { messages, rest } = splitMessages(buffer);
        buffer = rest;
        for (const xml of messages) {
            queue = queue.then(async () => {
                if (socket.destroyed) return;
                try {
                    const keepOpen = await handleMessage(xml, socket, remoteIp);
                    if (!keepOpen) socket.destroy();
                } catch (error) {
                    // Not acknowledged → the device retries this record later.
                    log(`error handling message from ${remoteIp}: ${(error as Error).message}`);
                    socket.destroy();
                }
            });
        }
    });
    socket.on('error', (error) => log(`socket error from ${remoteIp}: ${error.message}`));
});

async function main() {
    await prisma.$connect();
    server.listen(env.BIOMETRIC_PORT, '0.0.0.0', () => {
        log(`receiver listening on port ${env.BIOMETRIC_PORT}` +
            (allowedSerials.size ? ` (allowed devices: ${[...allowedSerials].join(', ')})` : ' (any device serial accepted)'));
    });
}

async function shutdown() {
    log('shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((error) => {
    console.error('[biometric] failed to start:', error);
    process.exit(1);
});
