-- 2026-10-23: company assets (laptops, phones, tablets) issued to employees — profile "Assets" tab.
-- Generated with `prisma migrate diff` against the previous schema; it only adds this table.
-- Apply once on the VPS (back up first: DEPLOYMENT.md §7), then restart hr-api.

-- CreateTable
CREATE TABLE `employee_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `serial_number` VARCHAR(100) NULL,
    `assigned_on` DATE NOT NULL,
    `returned_on` DATE NULL,
    `notes` TEXT NULL,
    `assigned_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_assets_employee_id_returned_on_idx`(`employee_id`, `returned_on`),
    INDEX `employee_assets_serial_number_idx`(`serial_number`),
    INDEX `employee_assets_assigned_by_id_idx`(`assigned_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employee_assets` ADD CONSTRAINT `employee_assets_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_assets` ADD CONSTRAINT `employee_assets_assigned_by_id_fkey` FOREIGN KEY (`assigned_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

