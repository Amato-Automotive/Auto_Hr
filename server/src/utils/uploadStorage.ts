import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Client as FtpClient } from 'basic-ftp';
import { Readable, Writable } from 'node:stream';
import { env } from '../config/env.js';

const LOCAL_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const LOCAL_PRIVATE_ROOT = path.resolve(process.cwd(), 'private-uploads');

const MIME_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export function extensionForMimeType(mimeType: string, fallback = 'bin'): string {
    return MIME_EXTENSIONS[mimeType] ?? fallback;
}

async function putLocal(relativePath: string, buffer: Buffer): Promise<string> {
    const absolutePath = path.join(LOCAL_UPLOAD_ROOT, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return `/uploads/${relativePath}`;
}

let htaccessEnsured = false;

async function ensureNoDirectoryListing(client: FtpClient) {
    if (htaccessEnsured) return;
    await client.ensureDir(env.FTP_REMOTE_ROOT);
    await client.uploadFrom(Readable.from(Buffer.from('Options -Indexes\n')), '.htaccess');
    htaccessEnsured = true;
}

async function putHostingerFtp(relativePath: string, buffer: Buffer): Promise<string> {
    const client = new FtpClient();
    client.ftp.verbose = false;

    try {
        await client.access({
            host: env.FTP_HOST,
            port: env.FTP_PORT,
            user: env.FTP_USER,
            password: env.FTP_PASSWORD,
            secure: env.FTP_SECURE,
        });

        await ensureNoDirectoryListing(client);

        const remoteDir = path.posix.join(env.FTP_REMOTE_ROOT, path.dirname(relativePath));
        await client.ensureDir(remoteDir);
        await client.uploadFrom(Readable.from(buffer), path.basename(relativePath));
    } finally {
        client.close();
    }

    const base = env.UPLOAD_PUBLIC_BASE_URL.replace(/\/$/, '');
    return `${base}/${relativePath}`;
}

/**
 * Stores a public asset (e.g. avatar) via the configured driver and returns its public URL.
 * `relativePath` is forward-slash separated, e.g. "avatars/foo.png".
 */
export async function putUploadFile(relativePath: string, buffer: Buffer): Promise<string> {
    if (env.UPLOAD_STORAGE_DRIVER === 'hostinger-ftp') {
        return putHostingerFtp(relativePath, buffer);
    }
    return putLocal(relativePath, buffer);
}

/**
 * Deletes a public asset given the URL `putUploadFile` returned. URLs that don't belong to the
 * configured storage (e.g. pasted links) are ignored.
 */
export async function removeUploadFile(publicUrl: string): Promise<void> {
    const prefix = env.UPLOAD_STORAGE_DRIVER === 'hostinger-ftp'
        ? `${env.UPLOAD_PUBLIC_BASE_URL.replace(/\/$/, '')}/`
        : '/uploads/';
    if (!publicUrl.startsWith(prefix)) return;
    const relativePath = publicUrl.slice(prefix.length);
    if (!relativePath || relativePath.split('/').includes('..')) return;

    if (env.UPLOAD_STORAGE_DRIVER !== 'hostinger-ftp') {
        await rm(path.join(LOCAL_UPLOAD_ROOT, relativePath), { force: true });
        return;
    }

    const client = new FtpClient();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: env.FTP_HOST,
            port: env.FTP_PORT,
            user: env.FTP_USER,
            password: env.FTP_PASSWORD,
            secure: env.FTP_SECURE,
        });
        await client.remove(path.posix.join(env.FTP_REMOTE_ROOT, relativePath));
    } finally {
        client.close();
    }
}

async function putPrivateLocal(relativePath: string, buffer: Buffer): Promise<void> {
    const absolutePath = path.join(LOCAL_PRIVATE_ROOT, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
}

async function getPrivateLocal(relativePath: string): Promise<Buffer> {
    return readFile(path.join(LOCAL_PRIVATE_ROOT, relativePath));
}

async function removePrivateLocal(relativePath: string): Promise<void> {
    await rm(path.join(LOCAL_PRIVATE_ROOT, relativePath), { force: true });
}

let privateHtaccessEnsured = false;

// Belt-and-suspenders: even though the app only ever reaches this folder over FTP
// (never returns a public URL for it), block direct web access in case someone
// guesses the path — Hostinger serves the whole account as static files by default.
async function ensurePrivateFolderBlocked(client: FtpClient) {
    if (privateHtaccessEnsured) return;
    await client.ensureDir(env.FTP_PRIVATE_REMOTE_ROOT);
    await client.uploadFrom(Readable.from(Buffer.from('Require all denied\n')), '.htaccess');
    privateHtaccessEnsured = true;
}

async function putPrivateFtp(relativePath: string, buffer: Buffer): Promise<void> {
    const client = new FtpClient();
    client.ftp.verbose = false;

    try {
        await client.access({
            host: env.FTP_HOST,
            port: env.FTP_PORT,
            user: env.FTP_USER,
            password: env.FTP_PASSWORD,
            secure: env.FTP_SECURE,
        });

        await ensurePrivateFolderBlocked(client);

        const remoteDir = path.posix.join(env.FTP_PRIVATE_REMOTE_ROOT, path.dirname(relativePath));
        await client.ensureDir(remoteDir);
        await client.uploadFrom(Readable.from(buffer), path.basename(relativePath));
    } finally {
        client.close();
    }
}

async function getPrivateFtp(relativePath: string): Promise<Buffer> {
    const client = new FtpClient();
    client.ftp.verbose = false;

    const chunks: Buffer[] = [];
    const sink = new Writable({
        write(chunk, _encoding, callback) {
            chunks.push(chunk);
            callback();
        },
    });

    try {
        await client.access({
            host: env.FTP_HOST,
            port: env.FTP_PORT,
            user: env.FTP_USER,
            password: env.FTP_PASSWORD,
            secure: env.FTP_SECURE,
        });

        const remotePath = path.posix.join(env.FTP_PRIVATE_REMOTE_ROOT, relativePath);
        await client.downloadTo(sink, remotePath);
    } finally {
        client.close();
    }

    return Buffer.concat(chunks);
}

async function removePrivateFtp(relativePath: string): Promise<void> {
    const client = new FtpClient();
    client.ftp.verbose = false;

    try {
        await client.access({
            host: env.FTP_HOST,
            port: env.FTP_PORT,
            user: env.FTP_USER,
            password: env.FTP_PASSWORD,
            secure: env.FTP_SECURE,
        });

        const remotePath = path.posix.join(env.FTP_PRIVATE_REMOTE_ROOT, relativePath);
        await client.remove(remotePath);
    } finally {
        client.close();
    }
}

/**
 * Stores a private asset (e.g. an employee document) with no public URL — only
 * `getPrivateUploadFile` can read it back, and callers must apply their own
 * authorization checks before calling either function. `relativePath` is
 * forward-slash separated, e.g. "employee-documents/42/foo.pdf".
 */
export async function putPrivateUploadFile(relativePath: string, buffer: Buffer): Promise<void> {
    if (env.UPLOAD_STORAGE_DRIVER === 'hostinger-ftp') {
        return putPrivateFtp(relativePath, buffer);
    }
    return putPrivateLocal(relativePath, buffer);
}

export async function getPrivateUploadFile(relativePath: string): Promise<Buffer> {
    if (env.UPLOAD_STORAGE_DRIVER === 'hostinger-ftp') {
        return getPrivateFtp(relativePath);
    }
    return getPrivateLocal(relativePath);
}

export async function removePrivateUploadFile(relativePath: string): Promise<void> {
    if (env.UPLOAD_STORAGE_DRIVER === 'hostinger-ftp') {
        return removePrivateFtp(relativePath);
    }
    return removePrivateLocal(relativePath);
}
