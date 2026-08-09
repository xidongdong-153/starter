import type { AppDatabase } from "@api/infra/db/client.js";
import type { UserManagementQuery } from "@starter/contracts";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  account,
  profiles,
  roles,
  user,
  userRoles,
} from "@api/infra/db/schema/index.js";

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (char) => `!${char}`);
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RoleAssignmentRow {
  userId: string;
  roleKey: string;
}

interface ListUsersResult {
  users: UserRow[];
  roleAssignments: RoleAssignmentRow[];
  total: number;
}

interface UserDetailRow {
  user: UserRow;
  roleKeys: string[];
  providers: string[];
  profile: typeof profiles.$inferSelect | null;
}

export function createUsersRepository(db: AppDatabase) {
  async function listUsers(
    query: UserManagementQuery,
  ): Promise<ListUsersResult> {
    const conditions: ReturnType<typeof sql>[] = [];

    if (query.search) {
      const escaped = escapeLike(query.search);
      const likePattern = `%${escaped}%`;
      conditions.push(
        or(
          sql`${user.name} LIKE ${likePattern} ESCAPE '!'`,
          sql`${user.email} LIKE ${likePattern} ESCAPE '!'`,
        )!,
      );
    }

    if (query.roleKey) {
      const roleSubquery = db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(roles.key, query.roleKey), isNull(roles.archivedAt)));
      conditions.push(inArray(user.id, roleSubquery));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countRows = await db
      .select({ count: sql<number>`count(distinct ${user.id})` })
      .from(user)
      .where(whereClause);

    const total = countRows[0]?.count ?? 0;

    const offset = (query.page - 1) * query.pageSize;
    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(whereClause)
      .orderBy(asc(user.email), asc(user.id))
      .limit(query.pageSize)
      .offset(offset);

    const userIds = users.map((u) => u.id);
    let roleAssignments: RoleAssignmentRow[] = [];
    if (userIds.length > 0) {
      roleAssignments = await db
        .select({ userId: userRoles.userId, roleKey: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(inArray(userRoles.userId, userIds), isNull(roles.archivedAt)),
        )
        .orderBy(asc(userRoles.userId), asc(roles.key));
    }

    return { users, roleAssignments, total };
  }

  async function getUserDetail(userId: string): Promise<UserDetailRow | null> {
    const userRecord = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .get();

    if (!userRecord) return null;

    const roleRows = await db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), isNull(roles.archivedAt)))
      .orderBy(asc(roles.key));

    const providerRows = await db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId))
      .orderBy(asc(account.providerId));

    const profileRecord = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    return {
      user: userRecord,
      roleKeys: roleRows.map((r) => r.key),
      providers: [...new Set(providerRows.map((p) => p.providerId))].sort(),
      profile: profileRecord ?? null,
    };
  }

  return { getUserDetail, listUsers };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
