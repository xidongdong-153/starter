CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`resource` text NOT NULL,
	`action` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_key_unique` ON `permissions` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_resource_action_unique` ON `permissions` (`resource`,`action`);--> statement-breakpoint
CREATE INDEX `permissions_archived_at_idx` ON `permissions` (`archived_at`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	`assigned_by` text,
	PRIMARY KEY(`role_id`, `permission_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `role_permissions_permission_role_idx` ON `role_permissions` (`permission_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_unique` ON `roles` (`key`);--> statement-breakpoint
CREATE INDEX `roles_archived_at_idx` ON `roles` (`archived_at`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	`assigned_by` text,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_user_idx` ON `user_roles` (`role_id`,`user_id`);--> statement-breakpoint
INSERT INTO `roles` (`id`, `key`, `name`, `description`, `is_system`, `archived_at`, `created_at`, `updated_at`) VALUES
  ('019c3e00-0000-7000-8000-000000000001', 'admin', '管理员', '拥有全部已注册权限', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0000-7000-8000-000000000002', 'operator', '操作员', '可以管理自己的文件', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0000-7000-8000-000000000003', 'viewer', '只读用户', '只能查看和读取自己的文件', true, NULL, 1786254001432, 1786254001432);--> statement-breakpoint
INSERT INTO `permissions` (`id`, `key`, `resource`, `action`, `description`, `is_system`, `archived_at`, `created_at`, `updated_at`) VALUES
  ('019c3e00-0001-7000-8000-000000000001', 'authorization:read', 'authorization', 'read', '查看用户角色和权限目录', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0001-7000-8000-000000000002', 'authorization:manage', 'authorization', 'manage', '修改用户角色和角色权限', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0001-7000-8000-000000000003', 'file:list', 'file', 'list', '查看自己的文件列表', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0001-7000-8000-000000000004', 'file:read', 'file', 'read', '读取自己的文件', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0001-7000-8000-000000000005', 'file:upload', 'file', 'upload', '上传自己的文件', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0001-7000-8000-000000000006', 'file:rename', 'file', 'rename', '重命名自己的文件', true, NULL, 1786254001432, 1786254001432),
  ('019c3e00-0001-7000-8000-000000000007', 'file:delete', 'file', 'delete', '删除自己的文件', true, NULL, 1786254001432, 1786254001432);--> statement-breakpoint
INSERT INTO `role_permissions` (`role_id`, `permission_id`, `assigned_at`, `assigned_by`) VALUES
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000001', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000002', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000003', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000004', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000005', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000006', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000001', '019c3e00-0001-7000-8000-000000000007', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000002', '019c3e00-0001-7000-8000-000000000003', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000002', '019c3e00-0001-7000-8000-000000000004', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000002', '019c3e00-0001-7000-8000-000000000005', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000002', '019c3e00-0001-7000-8000-000000000006', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000002', '019c3e00-0001-7000-8000-000000000007', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000003', '019c3e00-0001-7000-8000-000000000003', 1786254001432, NULL),
  ('019c3e00-0000-7000-8000-000000000003', '019c3e00-0001-7000-8000-000000000004', 1786254001432, NULL);--> statement-breakpoint
INSERT OR IGNORE INTO `user_roles` (`user_id`, `role_id`, `assigned_at`, `assigned_by`)
SELECT `id`, '019c3e00-0000-7000-8000-000000000002', 1786254001432, NULL FROM `user`;