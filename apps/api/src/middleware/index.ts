import type { AppRegistrar } from "@api/bootstrap/app.types.js";
import { registerBodyLimit } from "./body-limit.middleware.js";
import { registerCors } from "./cors.middleware.js";
import { registerRequestContext } from "./request-context.middleware.js";
import { registerRequestLog } from "./request-log.middleware.js";
import { registerSecureHeaders } from "./secure-headers.middleware.js";
import { registerTimeout } from "./timeout.middleware.js";
import { registerTiming } from "./timing.middleware.js";

export { registerBodyLimit } from "./body-limit.middleware.js";
export { registerCors } from "./cors.middleware.js";
export { registerRequestContext } from "./request-context.middleware.js";
export { registerRequestLog } from "./request-log.middleware.js";
export { registerSecureHeaders } from "./secure-headers.middleware.js";
export { registerTimeout } from "./timeout.middleware.js";
export { registerTiming } from "./timing.middleware.js";

/**
 * 中间件注册顺序即请求处理顺序：
 * RequestContext 必须最先注册，后面的中间件依赖 c.var.requestId 和 c.var.logger。
 */
export const registerMiddleware: AppRegistrar = (app, runtime) => {
  registerRequestContext(app, runtime.logger);
  registerSecureHeaders(app, runtime.env);
  registerRequestLog(app);
  registerCors(app, runtime.env);
  registerBodyLimit(app);
  registerTiming(app, runtime.env);
  registerTimeout(app);
};
