import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "@api/modules/auth/auth.schema.js";
import { files } from "@api/modules/files/files.schema.js";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const profiles = sqliteTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  avatarFileId: text("avatar_file_id").references(() => files.id, {
    onDelete: "set null",
  }),
  bio: text("bio"),
  contactEmail: text("contact_email"),
  location: text("location"),
  availableForWork: integer("available_for_work", { mode: "boolean" })
    .notNull()
    .default(false),
  socialLinks: text("social_links").notNull().default("[]"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(user, { fields: [profiles.userId], references: [user.id] }),
  avatar: one(files, {
    fields: [profiles.avatarFileId],
    references: [files.id],
  }),
}));

// user.profile 反向关系放在本模块，避免 auth 模块反向依赖 profile
export const userProfileRelations = relations(user, ({ one }) => ({
  profile: one(profiles),
}));
