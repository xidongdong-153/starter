import type { AppRegistrar } from "@api/bootstrap/app.types.js";
import { Scalar } from "@scalar/hono-api-reference";

export const registerOpenApi: AppRegistrar = (app, runtime) => {
  if (!runtime.env.OPENAPI_ENABLED) return;

  app
    .doc("/doc", {
      openapi: "3.0.0",
      info: {
        version: "0.1.0",
        title: "Starter API",
        description: "Starter 项目的 HTTP API 文档",
      },
      tags: [
        { name: "System", description: "系统状态接口" },
        { name: "Auth", description: "登录状态接口" },
        { name: "Profile", description: "用户资料接口" },
        { name: "Files", description: "文件接口" },
      ],
    })
    .get(
      "/reference",
      Scalar({
        url: "/doc",
        pageTitle: "Starter API Reference",
        layout: "modern",
        theme: "default",
        isEditable: false,
        showSidebar: true,
        hideClientButton: true,
        withDefaultFonts: false,
        defaultHttpClient: { targetKey: "js", clientKey: "fetch" },
        cdn: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.64.1",
      }),
    );
};
