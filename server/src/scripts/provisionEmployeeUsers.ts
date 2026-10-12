import 'dotenv/config';
import { PrismaClient, type Employee } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

type EmployeeForProvisioning = Pick<
    Employee,
    'id' | 'name' | 'email' | 'employeeNumber' | 'biometricId'
>;

interface ProvisionedUserPreview {
    employeeId: number;
    employeeName: string;
    username: string;
    action: 'CREATE';
}

function getArgValue(name: string): string | null {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function sanitizeUsername(value: string): string {
    const sanitized = value
        .trim()
        .toLowerCase()
        .replace(/@.*$/, '')
        .replace(/[^a-z0-9._-]+/g, '.')
        .replace(/^[._-]+|[._-]+$/g, '')
        .replace(/[._-]{2,}/g, '.');

    return sanitized || 'employee';
}

function baseUsername(employee: EmployeeForProvisioning): string {
    if (employee.employeeNumber) return sanitizeUsername(employee.employeeNumber);
    if (employee.email) return sanitizeUsername(employee.email);
    if (employee.biometricId) return `bio${employee.biometricId}`;
    return sanitizeUsername(employee.name);
}

async function uniqueUsername(base: string, employeeId: number): Promise<string> {
    const trimmedBase = base.slice(0, 50);
    const existing = await prisma.user.findUnique({ where: { username: trimmedBase } });
    if (!existing) return trimmedBase;

    const idSuffix = `-${employeeId}`;
    const withId = `${trimmedBase.slice(0, 50 - idSuffix.length)}${idSuffix}`;
    const existingWithId = await prisma.user.findUnique({ where: { username: withId } });
    if (!existingWithId) return withId;

    for (let counter = 2; counter < 1000; counter++) {
        const suffix = `-${employeeId}-${counter}`;
        const candidate = `${trimmedBase.slice(0, 50 - suffix.length)}${suffix}`;
        const taken = await prisma.user.findUnique({ where: { username: candidate } });
        if (!taken) return candidate;
    }

    throw new Error(`Could not generate a unique username for employee ${employeeId}`);
}

function printPreview(rows: ProvisionedUserPreview[], passwordLabel: string): void {
    if (rows.length === 0) {
        console.log('No active employees without users were found.');
        return;
    }

    console.table(rows);
    console.log(`Generic password: ${passwordLabel}`);
}

async function main(): Promise<void> {
    const apply = hasFlag('apply');
    const password = getArgValue('password') ?? process.env.GENERIC_EMPLOYEE_PASSWORD ?? '';

    if (apply && password.length < 6) {
        throw new Error('Provide a generic password with --password=... or GENERIC_EMPLOYEE_PASSWORD. Minimum length is 6.');
    }

    const employees = await prisma.employee.findMany({
        where: {
            isActive: true,
            user: null,
        },
        select: {
            id: true,
            name: true,
            email: true,
            employeeNumber: true,
            biometricId: true,
        },
        orderBy: { name: 'asc' },
    });

    const previews: ProvisionedUserPreview[] = [];
    for (const employee of employees) {
        const username = await uniqueUsername(baseUsername(employee), employee.id);
        previews.push({
            employeeId: employee.id,
            employeeName: employee.name,
            username,
            action: 'CREATE',
        });
    }

    if (!apply) {
        printPreview(previews, password ? password : '<set with --password or GENERIC_EMPLOYEE_PASSWORD>');
        console.log('\nDry run only. Re-run with --apply to create these users.');
        return;
    }

    if (previews.length === 0) {
        printPreview(previews, password);
        return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.$transaction(
        previews.map((row) =>
            prisma.user.create({
                data: {
                    username: row.username,
                    passwordHash,
                    role: 'EMPLOYEE',
                    employeeId: row.employeeId,
                    isActive: true,
                },
            })
        )
    );

    printPreview(previews, password);
    console.log(`\nCreated ${previews.length} employee user account(s).`);
}

main()
    .catch((error) => {
        console.error('Provisioning failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
