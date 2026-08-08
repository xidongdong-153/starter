import type { InferSelectModel } from "drizzle-orm";
import type { AppDatabase } from "@api/infra/db/client.js";
import { and, desc, eq } from "drizzle-orm";
import { files, profiles } from "@api/infra/db/schema/index.js";

export type FileRecord = InferSelectModel<typeof files>;

export function createFilesRepository(db: AppDatabase) {
  async function listByOwner(ownerId: string): Promise<FileRecord[]> {
    return db
      .select()
      .from(files)
      .where(eq(files.ownerId, ownerId))
      .orderBy(desc(files.createdAt));
  }

  async function findOwned(fileId: string, ownerId: string) {
    return db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId)))
      .get();
  }

  async function create(input: FileRecord): Promise<FileRecord> {
    return db.insert(files).values(input).returning().get();
  }

  async function rename(fileId: string, ownerId: string, name: string) {
    return db
      .update(files)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId)))
      .returning()
      .get();
  }

  function deleteOwned(
    fileId: string,
    ownerId: string,
  ): FileRecord | undefined {
    return db.transaction((tx) => {
      const file = tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.ownerId, ownerId)))
        .get();
      if (!file) return undefined;

      tx.update(profiles)
        .set({ avatarFileId: null, updatedAt: new Date() })
        .where(eq(profiles.avatarFileId, file.id))
        .run();
      tx.delete(files).where(eq(files.id, file.id)).run();
      return file;
    });
  }

  return { create, deleteOwned, findOwned, listByOwner, rename };
}

export type FilesRepository = ReturnType<typeof createFilesRepository>;
