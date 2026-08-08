import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "@api/modules/auth/auth.schema.js";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("files_storage_path_unique").on(table.storagePath),
    index("files_owner_id_idx").on(table.ownerId),
  ],
);

export const filesRelations = relations(files, ({ one }) => ({
  owner: one(user, { fields: [files.ownerId], references: [user.id] }),
}));

// user.files 反向关系放在本模块，避免 auth 模块反向依赖 files
export const userFilesRelations = relations(user, ({ many }) => ({
  files: many(files),
}));
