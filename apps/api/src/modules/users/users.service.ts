import type {
  UserManagementProfile,
  UserManagementQuery,
  UserManagementUser,
  UserManagementUserDetail,
  UserManagementUserPage,
  UserStatus,
} from "@starter/contracts";
import type { UsersRepository } from "./users.repository.js";
import { ApiErrorCodes } from "@starter/contracts";
import { AppError } from "@api/shared/app-error.js";

function toUserManagementUser(
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    emailVerified: boolean;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  roleKeys: string[],
): UserManagementUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    emailVerified: user.emailVerified,
    status: user.status as UserManagementUser["status"],
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    roleKeys,
  };
}

function toUserManagementProfile(
  profile: {
    bio: string | null;
    contactEmail: string | null;
    location: string | null;
    availableForWork: boolean;
    socialLinks: string;
    avatarFileId: string | null;
    updatedAt: Date;
  } | null,
  userId: string,
): UserManagementProfile | null {
  if (!profile) return null;

  let socialLinks: string[];
  try {
    socialLinks = JSON.parse(profile.socialLinks) as string[];
  } catch {
    socialLinks = [];
  }

  return {
    bio: profile.bio,
    contactEmail: profile.contactEmail,
    location: profile.location,
    availableForWork: profile.availableForWork,
    socialLinks,
    avatarUrl: profile.avatarFileId ? `/api/profiles/${userId}/avatar` : null,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function createUsersService(repository: UsersRepository) {
  async function listUsers(
    query: UserManagementQuery,
  ): Promise<UserManagementUserPage> {
    const search = query.search?.trim() || undefined;
    const result = await repository.listUsers({ ...query, search });

    const roleKeysByUser = new Map<string, string[]>();
    for (const assignment of result.roleAssignments) {
      const roleKeys = roleKeysByUser.get(assignment.userId) ?? [];
      roleKeys.push(assignment.roleKey);
      roleKeysByUser.set(assignment.userId, roleKeys);
    }

    return {
      items: result.users.map((u) =>
        toUserManagementUser(u, roleKeysByUser.get(u.id) ?? []),
      ),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async function getUserDetail(
    userId: string,
  ): Promise<UserManagementUserDetail> {
    const result = await repository.getUserDetail(userId);
    if (!result) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "用户不存在", 404);
    }

    const base = toUserManagementUser(result.user, result.roleKeys);
    return {
      ...base,
      providers: result.providers,
      profile: toUserManagementProfile(result.profile, userId),
    };
  }

  async function updateUserStatus(
    actorId: string,
    targetUserId: string,
    status: UserStatus,
    requestId: string | null,
  ): Promise<{ id: string; status: UserStatus }> {
    const result = repository.updateUserStatus(
      actorId,
      targetUserId,
      status,
      requestId,
    );
    switch (result.kind) {
      case "user-not-found":
        throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "用户不存在", 404);
      case "self-suspend":
        throw new AppError(
          ApiErrorCodes.COMMON_INVALID_REQUEST,
          "不能禁用自己",
          400,
        );
      default:
        return { id: result.id, status: result.status };
    }
  }

  return { getUserDetail, listUsers, updateUserStatus };
}

export type UsersService = ReturnType<typeof createUsersService>;
