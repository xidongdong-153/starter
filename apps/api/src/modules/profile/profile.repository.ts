import type { AppDatabase } from "@api/infra/db/client.js";
import type { UpdateProfileInput } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { account, files, profiles, user } from "@api/infra/db/schema/index.js";

export function createProfileRepository(db: AppDatabase) {
  async function findByUserId(userId: string) {
    return db
      .select({ profile: profiles, user })
      .from(profiles)
      .innerJoin(user, eq(profiles.userId, user.id))
      .where(eq(profiles.userId, userId))
      .get();
  }

  async function findAvatarByUserId(userId: string) {
    return db
      .select({ file: files })
      .from(profiles)
      .innerJoin(files, eq(profiles.avatarFileId, files.id))
      .where(eq(profiles.userId, userId))
      .get();
  }

  async function listProviders(userId: string) {
    return db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId));
  }

  function update(userId: string, input: UpdateProfileInput): void {
    const now = new Date();
    db.transaction((tx) => {
      tx.update(user)
        .set({ name: input.name, updatedAt: now })
        .where(eq(user.id, userId))
        .run();
      tx.update(profiles)
        .set({
          bio: input.bio,
          contactEmail: input.contactEmail,
          location: input.location,
          availableForWork: input.availableForWork,
          socialLinks: JSON.stringify(input.socialLinks),
          updatedAt: now,
        })
        .where(eq(profiles.userId, userId))
        .run();
    });
  }

  function setAvatar(userId: string, fileId: string | null): void {
    db.update(profiles)
      .set({ avatarFileId: fileId, updatedAt: new Date() })
      .where(eq(profiles.userId, userId))
      .run();
  }

  return { findAvatarByUserId, findByUserId, listProviders, setAvatar, update };
}

export type ProfileRepository = ReturnType<typeof createProfileRepository>;
export type ProfileRecord = NonNullable<
  Awaited<ReturnType<ProfileRepository["findByUserId"]>>
>;
