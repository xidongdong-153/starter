import type { FileItem } from "@starter/contracts";
import { ApiErrorCodes } from "@starter/contracts";
import { expect, it } from "vitest";
import {
  createTestApp,
  readFailure,
  readSuccess,
  register,
} from "./helpers.js";

it("文件上传、列表、下载、重命名、删除和用户所有权隔离可用", async () => {
  const { app, cleanup } = createTestApp();
  try {
    const first = await register(app, "first@example.com");
    const second = await register(app, "second@example.com");
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", {
        type: "image/png",
      }),
    );

    const upload = await app.request("/api/files", {
      method: "POST",
      headers: { cookie: first.cookie },
      body: form,
    });
    expect(upload.status).toBe(201);
    const file = (await readSuccess<FileItem>(upload)).data;
    expect(file.id[14]).toBe("7");

    const list = await app.request("/api/files", {
      headers: { cookie: first.cookie },
    });
    expect((await readSuccess<FileItem[]>(list)).data).toHaveLength(1);

    const content = await app.request(file.contentUrl, {
      headers: { cookie: first.cookie },
    });
    expect(content.status).toBe(200);
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );

    const rename = await app.request(`/api/files/${file.id}`, {
      method: "PATCH",
      headers: {
        cookie: first.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "renamed.png" }),
    });
    expect((await readSuccess<FileItem>(rename)).data.name).toBe("renamed.png");

    for (const response of [
      await app.request(file.contentUrl, {
        headers: { cookie: second.cookie },
      }),
      await app.request(`/api/files/${file.id}`, {
        method: "PATCH",
        headers: {
          cookie: second.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "stolen.png" }),
      }),
      await app.request(`/api/files/${file.id}`, {
        method: "DELETE",
        headers: { cookie: second.cookie },
      }),
    ]) {
      expect(response.status).toBe(404);
      expect((await readFailure(response)).error.code).toBe(
        ApiErrorCodes.COMMON_NOT_FOUND,
      );
    }

    const avatar = await app.request("/api/profile/avatar", {
      method: "PUT",
      headers: {
        cookie: first.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileId: file.id }),
    });
    expect(avatar.status).toBe(200);

    const remove = await app.request(`/api/files/${file.id}`, {
      method: "DELETE",
      headers: { cookie: first.cookie },
    });
    expect(remove.status).toBe(200);
    expect((await readSuccess<{ ok: boolean }>(remove)).data.ok).toBe(true);
    expect(
      (await app.request(`/api/profiles/${first.user.id}/avatar`)).status,
    ).toBe(404);

    const emptyList = await app.request("/api/files", {
      headers: { cookie: first.cookie },
    });
    expect((await readSuccess<FileItem[]>(emptyList)).data).toEqual([]);
  } finally {
    cleanup();
  }
});
