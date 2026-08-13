import type {
  AccountProfile,
  FileItem,
  PublicProfile,
} from "@starter/contracts";
import { expect, it } from "vitest";
import { createTestApp, readSuccess, register } from "./helpers.js";

it("登录用户可以读取、更新和公开读取个人资料，并设置和清空头像", async () => {
  const { app, cleanup } = createTestApp();
  try {
    const { cookie, user } = await register(app, "profile@example.com");

    const initial = await app.request("/api/profile", { headers: { cookie } });
    expect(initial.status).toBe(200);
    expect((await readSuccess<AccountProfile>(initial)).data.name).toBe(
      "Test User",
    );

    const update = await app.request("/api/profile", {
      method: "PATCH",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Public Name",
        bio: "公开简介",
        contactEmail: "contact@example.com",
        location: "Shanghai",
        availableForWork: true,
        socialLinks: ["https://example.com"],
      }),
    });
    expect(update.status).toBe(200);
    const current = (await readSuccess<AccountProfile>(update)).data;
    expect(current.email).toBe("profile@example.com");
    expect(current.providers).toContain("credential");

    const publicResponse = await app.request(`/api/profiles/${user.id}`);
    expect(publicResponse.status).toBe(200);
    const profile = (await readSuccess<PublicProfile>(publicResponse)).data;
    expect(profile).toMatchObject({
      name: "Public Name",
      bio: "公开简介",
    });
    expect(profile).not.toHaveProperty("email");

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", {
        type: "image/png",
      }),
    );
    const upload = await app.request("/api/files", {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    const file = (await readSuccess<FileItem>(upload)).data;

    const avatar = await app.request("/api/profile/avatar", {
      method: "PUT",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: file.id }),
    });
    expect(avatar.status).toBe(200);
    expect((await readSuccess<{ fileId: string }>(avatar)).data.fileId).toBe(
      file.id,
    );
    const avatarContent = await app.request(`/api/profiles/${user.id}/avatar`);
    expect(avatarContent.status).toBe(200);
    expect(avatarContent.headers.get("content-type")).toBe("image/png");
    expect(avatarContent.headers.get("content-length")).toBe("4");
    expect(avatarContent.headers.get("cache-control")).toBe(
      "public, max-age=300",
    );
    expect(new Uint8Array(await avatarContent.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );

    const clear = await app.request("/api/profile/avatar", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(clear.status).toBe(200);
    expect((await readSuccess<{ ok: boolean }>(clear)).data.ok).toBe(true);
    expect((await app.request(`/api/profiles/${user.id}/avatar`)).status).toBe(
      404,
    );
  } finally {
    cleanup();
  }
});
