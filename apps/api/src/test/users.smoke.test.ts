import type {
  UserManagementUserDetail,
  UserManagementUserPage,
} from "@starter/contracts";
import { ApiErrorCodes, RoleKeys } from "@starter/contracts";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { account, profiles } from "@api/infra/db/schema/index.js";
import { runBootstrapAdmin } from "@api/scripts/bootstrap-admin.js";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

it("用户目录接口在未登录时返回 401，无权限时返回 403", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const unauthenticatedList = await app.request("/api/users");
    expect(unauthenticatedList.status).toBe(401);
    expect((await readFailure(unauthenticatedList)).error.code).toBe(
      ApiErrorCodes.AUTH_UNAUTHENTICATED,
    );

    const unauthenticatedDetail = await app.request(
      "/api/users/019c3e00-0010-7000-8000-000000000099",
    );
    expect(unauthenticatedDetail.status).toBe(401);

    const user = await register(app, "viewer@example.com");
    const viewerCookie = user.cookie;

    const viewerList = await app.request("/api/users", {
      headers: { cookie: viewerCookie },
    });
    expect(viewerList.status).toBe(403);
    expect((await readFailure(viewerList)).error.code).toBe(
      ApiErrorCodes.AUTH_FORBIDDEN,
    );

    const viewerDetail = await app.request(
      "/api/users/019c3e00-0010-7000-8000-000000000099",
      { headers: { cookie: viewerCookie } },
    );
    expect(viewerDetail.status).toBe(403);

    const admin = await register(app, "admin@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    };
    const bootstrapMessages: string[] = [];
    const bootstrapOutput = {
      error(message: string) {
        bootstrapMessages.push(message);
      },
      log(message: string) {
        bootstrapMessages.push(message);
      },
    };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);

    const adminList = await app.request("/api/users", {
      headers: { cookie: admin.cookie },
    });
    expect(adminList.status).toBe(200);
  } finally {
    cleanup();
  }
});

it("admin 可读取默认分页、搜索、角色筛选和稳定排序", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "list-admin@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "list-admin@example.com",
    };
    const bootstrapOutput = { error() {}, log() {} };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);

    // Create 5 users with distinct emails for stable sort testing
    const emails = [
      "alice@example.com",
      "bob@example.com",
      "charlie@example.com",
      "david@example.com",
      "eve@example.com",
    ];
    for (const email of emails) {
      await register(app, email);
    }

    // Default pagination
    const defaultPage = await app.request("/api/users", {
      headers: { cookie: admin.cookie },
    });
    expect(defaultPage.status).toBe(200);
    const defaultData = (await readSuccess<UserManagementUserPage>(defaultPage))
      .data;
    expect(defaultData.items.length).toBe(6); // 5 new + 1 admin
    expect(defaultData.total).toBe(6);
    expect(defaultData.page).toBe(1);
    expect(defaultData.pageSize).toBe(20);

    // Custom page and pageSize
    const customPage = await app.request("/api/users?page=1&pageSize=2", {
      headers: { cookie: admin.cookie },
    });
    expect(customPage.status).toBe(200);
    const customData = (await readSuccess<UserManagementUserPage>(customPage))
      .data;
    expect(customData.items.length).toBe(2);
    expect(customData.pageSize).toBe(2);

    // Search by name (using email prefix since name is "Test User")
    const searchByName = await app.request("/api/users?search=alice", {
      headers: { cookie: admin.cookie },
    });
    expect(searchByName.status).toBe(200);
    const searchNameData = (
      await readSuccess<UserManagementUserPage>(searchByName)
    ).data;
    expect(searchNameData.items.length).toBe(1);
    expect(searchNameData.items[0]?.email).toBe("alice@example.com");

    // Search by email
    const searchByEmail = await app.request("/api/users?search=bob@example", {
      headers: { cookie: admin.cookie },
    });
    expect(searchByEmail.status).toBe(200);
    const searchEmailData = (
      await readSuccess<UserManagementUserPage>(searchByEmail)
    ).data;
    expect(searchEmailData.items.length).toBe(1);
    expect(searchEmailData.items[0]?.email).toBe("bob@example.com");

    // Case-insensitive search
    const caseInsensitive = await app.request("/api/users?search=ALICE", {
      headers: { cookie: admin.cookie },
    });
    expect(caseInsensitive.status).toBe(200);
    const caseData = (
      await readSuccess<UserManagementUserPage>(caseInsensitive)
    ).data;
    expect(caseData.items.length).toBe(1);

    // Wildcard characters in search should not expand results
    const wildcardSearch = await app.request("/api/users?search=%25", {
      headers: { cookie: admin.cookie },
    });
    expect(wildcardSearch.status).toBe(200);
    const wildcardData = (
      await readSuccess<UserManagementUserPage>(wildcardSearch)
    ).data;
    expect(wildcardData.items.length).toBe(0);

    // Role filter: all non-admin users are operator by default
    const roleFilter = await app.request("/api/users?roleKey=operator", {
      headers: { cookie: admin.cookie },
    });
    expect(roleFilter.status).toBe(200);
    const roleData = (await readSuccess<UserManagementUserPage>(roleFilter))
      .data;
    expect(roleData.total).toBe(5);

    // Role filter: no users are viewer
    const viewerFilter = await app.request("/api/users?roleKey=viewer", {
      headers: { cookie: admin.cookie },
    });
    expect(viewerFilter.status).toBe(200);
    const viewerFilterData = (
      await readSuccess<UserManagementUserPage>(viewerFilter)
    ).data;
    expect(viewerFilterData.total).toBe(0);
  } finally {
    cleanup();
  }
});

it("用户详情返回聚合的 provider、profile 和头像 URL，缺失时返回空值", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "detail-admin@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "detail-admin@example.com",
    };
    const bootstrapOutput = { error() {}, log() {} };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);

    const target = await register(app, "target@example.com");
    const targetUserId = target.user.id;

    // Add a provider account for the target user
    runtime.db
      .insert(account)
      .values({
        id: "019c3e00-0020-7000-8000-000000000001",
        accountId: "github-account-id",
        providerId: "github",
        userId: targetUserId,
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    runtime.db
      .insert(account)
      .values({
        id: "019c3e00-0020-7000-8000-000000000002",
        accountId: "credential-account-id",
        providerId: "credential",
        userId: targetUserId,
        password: "hashed-password",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    // Delete auto-created profile first, then add a custom one
    runtime.db.delete(profiles).where(eq(profiles.userId, targetUserId)).run();
    runtime.db
      .insert(profiles)
      .values({
        userId: targetUserId,
        avatarFileId: null,
        bio: "Test bio",
        contactEmail: "target-contact@example.com",
        location: "Test location",
        availableForWork: true,
        socialLinks: JSON.stringify(["https://github.com/target"]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const detailResponse = await app.request(`/api/users/${targetUserId}`, {
      headers: { cookie: admin.cookie },
    });
    expect(detailResponse.status).toBe(200);
    const detailData =
      await readSuccess<UserManagementUserDetail>(detailResponse);
    const detail = detailData.data;

    expect(detail.id).toBe(targetUserId);
    expect(detail.name).toBe("Test User");
    expect(detail.email).toBe("target@example.com");
    expect(detail.roleKeys).toEqual([RoleKeys.OPERATOR]);
    expect(detail.providers).toEqual(["credential", "github"]);
    expect(detail.profile).not.toBeNull();
    expect(detail.profile?.bio).toBe("Test bio");
    expect(detail.profile?.contactEmail).toBe("target-contact@example.com");
    expect(detail.profile?.location).toBe("Test location");
    expect(detail.profile?.availableForWork).toBe(true);
    expect(detail.profile?.socialLinks).toEqual(["https://github.com/target"]);
    expect(detail.profile?.avatarUrl).toBeNull();

    // Response must not contain sensitive fields
    const responseText = JSON.stringify(detailData);
    expect(responseText).not.toContain("secret-access-token");
    expect(responseText).not.toContain("secret-refresh-token");
    expect(responseText).not.toContain("hashed-password");
    expect(responseText).not.toContain("accessToken");
    expect(responseText).not.toContain("refreshToken");
    expect(responseText).not.toContain("password");
  } finally {
    cleanup();
  }
});

it("用户详情在用户不存在时返回 404，资料缺失时返回基础信息", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "notfound-admin@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "notfound-admin@example.com",
    };
    const bootstrapOutput = { error() {}, log() {} };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);

    // Non-existent user
    const notFound = await app.request(
      "/api/users/019c3e00-0010-7000-8000-000000000099",
      { headers: { cookie: admin.cookie } },
    );
    expect(notFound.status).toBe(404);
    expect((await readFailure(notFound)).error.code).toBe(
      ApiErrorCodes.COMMON_NOT_FOUND,
    );

    // User without profile
    const noProfile = await register(app, "noprofile@example.com");
    const noProfileUserId = noProfile.user.id;

    // Delete the auto-created profile to test the null profile case
    runtime.db
      .delete(profiles)
      .where(eq(profiles.userId, noProfileUserId))
      .run();

    const noProfileDetail = await app.request(`/api/users/${noProfileUserId}`, {
      headers: { cookie: admin.cookie },
    });
    expect(noProfileDetail.status).toBe(200);
    const noProfileData = (
      await readSuccess<UserManagementUserDetail>(noProfileDetail)
    ).data;
    expect(noProfileData.id).toBe(noProfileUserId);
    expect(noProfileData.profile).toBeNull();
    expect(noProfileData.providers).toEqual(["credential"]);
    expect(noProfileData.roleKeys).toEqual([RoleKeys.OPERATOR]);
  } finally {
    cleanup();
  }
});

it("列表接口排除敏感字段，不包含 password、token 和 OAuth 密钥", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "sensitive-admin@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "sensitive-admin@example.com",
    };
    const bootstrapOutput = { error() {}, log() {} };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);

    const target = await register(app, "sensitive@example.com");
    const targetUserId = target.user.id;

    runtime.db
      .insert(account)
      .values({
        id: "019c3e00-0020-7000-8000-000000000099",
        accountId: "github-account-id",
        providerId: "github",
        userId: targetUserId,
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    const listResponse = await app.request("/api/users?search=sensitive", {
      headers: { cookie: admin.cookie },
    });
    expect(listResponse.status).toBe(200);
    const listText = await listResponse.text();
    expect(listText).not.toContain("secret-access-token");
    expect(listText).not.toContain("secret-refresh-token");
    expect(listText).not.toContain("accessToken");
    expect(listText).not.toContain("refreshToken");
    expect(listText).not.toContain("password");
    expect(listText).not.toContain("token");
  } finally {
    cleanup();
  }
});

it("列表按邮箱和 ID 稳定排序，分页 total 与筛选条件一致", async () => {
  const { app, cleanup, runtime } = createTestApp();
  try {
    const admin = await register(app, "stable-admin@example.com");
    const bootstrapEnv = {
      APP_ENV: "test",
      BETTER_AUTH_SECRET: runtime.env.BETTER_AUTH_SECRET,
      DATABASE_PATH: runtime.env.DATABASE_PATH,
      FILES_DIR: runtime.env.FILES_DIR,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: "stable-admin@example.com",
    };
    const bootstrapOutput = { error() {}, log() {} };
    expect(runBootstrapAdmin(bootstrapEnv, bootstrapOutput)).toBe(0);

    // Create users with specific emails to test stable sort
    const emails = [
      "a-user@example.com",
      "b-user@example.com",
      "c-user@example.com",
      "d-user@example.com",
      "e-user@example.com",
    ];
    for (const email of emails) {
      await register(app, email);
    }

    // Get first page
    const page1 = await app.request("/api/users?page=1&pageSize=2", {
      headers: { cookie: admin.cookie },
    });
    const page1Data = (await readSuccess<UserManagementUserPage>(page1)).data;
    expect(page1Data.items.length).toBe(2);
    expect(page1Data.items[0]?.email).toBe("a-user@example.com");
    expect(page1Data.items[1]?.email).toBe("b-user@example.com");

    // Get second page
    const page2 = await app.request("/api/users?page=2&pageSize=2", {
      headers: { cookie: admin.cookie },
    });
    const page2Data = (await readSuccess<UserManagementUserPage>(page2)).data;
    expect(page2Data.items.length).toBe(2);
    expect(page2Data.items[0]?.email).toBe("c-user@example.com");
    expect(page2Data.items[1]?.email).toBe("d-user@example.com");

    // Get third page
    const page3 = await app.request("/api/users?page=3&pageSize=2", {
      headers: { cookie: admin.cookie },
    });
    const page3Data = (await readSuccess<UserManagementUserPage>(page3)).data;
    expect(page3Data.items.length).toBe(2);
    expect(page3Data.items[0]?.email).toBe("e-user@example.com");
    expect(page3Data.items[1]?.email).toBe("stable-admin@example.com");

    // Empty page beyond last
    const page4 = await app.request("/api/users?page=4&pageSize=2", {
      headers: { cookie: admin.cookie },
    });
    const page4Data = (await readSuccess<UserManagementUserPage>(page4)).data;
    expect(page4Data.items.length).toBe(0);
    expect(page4Data.total).toBe(6);
    expect(page4Data.page).toBe(4);
  } finally {
    cleanup();
  }
});
