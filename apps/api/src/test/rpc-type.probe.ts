import { hc } from "hono/client";
import type { AppType } from "../rpc.js";
import type { InferRequestType, InferResponseType } from "hono/client";

const _client = hc<AppType>("http://localhost:7788");
type C = typeof _client;

type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// ---- 1. 29 个 openapi operation 全部存在（Hono 4.13 嵌套 client 链） ----
type _k01 = Assert<Eq<keyof C & "index", "index">>;
type _k02 = Assert<Eq<keyof C & "health", "health">>;
type _k03 = Assert<Eq<keyof C["api"]["system"] & "logs", "logs">>;
type _k04 = Assert<Eq<keyof C["api"]["config"] & "auth", "auth">>;
type _k05 = Assert<Eq<keyof C["api"] & "me", "me">>;
type _k06 = Assert<Eq<keyof C["api"]["profile"] & "$get", "$get">>;
type _k07 = Assert<Eq<keyof C["api"]["profile"] & "$patch", "$patch">>;
type _k08 = Assert<Eq<keyof C["api"]["profile"]["avatar"] & "$put", "$put">>;
type _k09 = Assert<
  Eq<keyof C["api"]["profile"]["avatar"] & "$delete", "$delete">
>;
type _k10 = Assert<Eq<keyof C["api"]["profiles"] & ":userId", ":userId">>;
type _k11 = Assert<Eq<keyof C["api"]["files"] & "$get", "$get">>;
type _k12 = Assert<Eq<keyof C["api"]["files"] & "$post", "$post">>;
type _k13 = Assert<Eq<keyof C["api"]["files"][":fileId"] & "$patch", "$patch">>;
type _k14 = Assert<
  Eq<keyof C["api"]["files"][":fileId"] & "$delete", "$delete">
>;
type _k15 = Assert<Eq<keyof C["api"]["users"] & "$get", "$get">>;
type _k16 = Assert<Eq<keyof C["api"]["users"][":userId"] & "$get", "$get">>;
type _k17 = Assert<
  Eq<keyof C["api"]["users"][":userId"]["status"] & "$patch", "$patch">
>;
type _k18 = Assert<Eq<keyof C["api"]["me"]["permissions"] & "$get", "$get">>;
type _k19 = Assert<
  Eq<keyof C["api"]["authorization"]["users"] & "$get", "$get">
>;
type _k20 = Assert<
  Eq<
    keyof C["api"]["authorization"]["users"][":userId"]["roles"] & "$put",
    "$put"
  >
>;
type _k21 = Assert<
  Eq<keyof C["api"]["authorization"]["roles"] & "$get", "$get">
>;
type _k22 = Assert<
  Eq<keyof C["api"]["authorization"]["roles"] & "$post", "$post">
>;
type _k23 = Assert<
  Eq<keyof C["api"]["authorization"]["roles"][":roleKey"] & "$patch", "$patch">
>;
type _k24 = Assert<
  Eq<
    keyof C["api"]["authorization"]["roles"][":roleKey"]["archive"] & "$post",
    "$post"
  >
>;
type _k25 = Assert<
  Eq<
    keyof C["api"]["authorization"]["roles"][":roleKey"]["restore"] & "$post",
    "$post"
  >
>;
type _k26 = Assert<
  Eq<
    keyof C["api"]["authorization"]["roles"][":roleKey"]["impact"] & "$get",
    "$get"
  >
>;
type _k27 = Assert<
  Eq<
    keyof C["api"]["authorization"]["permissions"][":permissionKey"]["impact"] &
      "$get",
    "$get"
  >
>;
type _k28 = Assert<
  Eq<
    keyof C["api"]["authorization"]["roles"][":roleKey"]["permissions"] &
      "$put",
    "$put"
  >
>;
type _k29 = Assert<
  Eq<keyof C["api"]["authorization"] & "audit-events", "audit-events">
>;

// ---- 2. 具体 data 类型保留（不退化） ----
// /health: data.ok 是 true 字面量
type HealthData = InferResponseType<C["health"]["$get"], 200>["data"];
type _h1 = Assert<Eq<HealthData, { ok: true }>>;

// /api/config/auth: providers 具体结构
type AuthConfigData = InferResponseType<
  C["api"]["config"]["auth"]["$get"],
  200
>["data"];
type _h2 = Assert<
  Eq<
    AuthConfigData,
    {
      providers: {
        email: true;
        github: boolean;
        google: boolean;
      };
    }
  >
>;

// /api/profiles/{userId}: 动态 param + 具体 data
type ProfileReq = InferRequestType<C["api"]["profiles"][":userId"]["$get"]>;
type _h3 = Assert<Eq<ProfileReq["param"], { userId: string }>>;
type PublicProfileData = InferResponseType<
  C["api"]["profiles"][":userId"]["$get"],
  200
>["data"];
type _h4 = Assert<Eq<PublicProfileData["avatarUrl"], string | null>>;

// /api/users: query 存在 page/pageSize（z.coerce 的 z.input 是 unknown，
// 客户端传参边界由 adapter 在子任务 3 处理，服务端解析后 z.infer 输出 page: number）
type UsersReq = InferRequestType<C["api"]["users"]["$get"]>;
type _h5 = Assert<Eq<keyof UsersReq["query"] & "page", "page">>;
type UsersData = InferResponseType<C["api"]["users"]["$get"], 200>["data"];
type _h6 = Assert<Eq<UsersData["items"][number]["id"], string>>;
type _h7 = Assert<
  Eq<UsersData["items"][number]["status"], "active" | "suspended">
>;

// /api/users/{userId}/status: JSON body + 多状态 + data.from
type StatusReq = InferRequestType<
  C["api"]["users"][":userId"]["status"]["$patch"]
>;
type _h8 = Assert<Eq<StatusReq["json"], { status: "active" | "suspended" }>>;
type StatusData = InferResponseType<
  C["api"]["users"][":userId"]["status"]["$patch"],
  200
>["data"];
type _h9 = Assert<Eq<StatusData["from"], "active" | "suspended">>;

// 多状态响应：403 的 error 结构
type UsersFailure = InferResponseType<C["api"]["users"]["$get"], 403>;
type _h10 = Assert<Eq<UsersFailure["ok"], false>>;
// error.code 是已登记错误码联合，包含真实码值
type _h11 = Assert<
  "AUTH.UNAUTHENTICATED" extends UsersFailure["error"]["code"] ? true : false
>;

// 动态 param 推导 roleKey
type RoleReq = InferRequestType<
  C["api"]["authorization"]["roles"][":roleKey"]["$patch"]
>;
type _h12 = Assert<Eq<RoleReq["param"], { roleKey: string }>>;

// audit-events query 存在 page + data.action 包含 user.status_changed 分支
type AuditReq = InferRequestType<
  C["api"]["authorization"]["audit-events"]["$get"]
>;
type _h13 = Assert<Eq<keyof AuditReq["query"] & "page", "page">>;
type AuditData = InferResponseType<
  C["api"]["authorization"]["audit-events"]["$get"],
  200
>["data"];
type _h14 = Assert<
  "user.status_changed" extends AuditData["items"][number]["action"]
    ? true
    : false
>;

// ---- 3. AI 子域路由和具体类型保留 ----
type AiProvidersData = InferResponseType<
  C["api"]["ai"]["admin"]["providers"]["$get"],
  200
>["data"];
type _ai1 = Assert<Eq<AiProvidersData[number]["providerId"], string>>;

type AiUsageReq = InferRequestType<C["api"]["ai"]["usage"]["calls"]["$get"]>;
type _ai2 = Assert<Eq<keyof AiUsageReq["query"] & "page", "page">>;
type AiUsageData = InferResponseType<
  C["api"]["ai"]["usage"]["calls"]["$get"],
  200
>["data"];
type _ai3 = Assert<
  "succeeded" extends AiUsageData["items"][number]["result"] ? true : false
>;

type AiConversationReq = InferRequestType<
  C["api"]["ai"]["conversations"][":conversationId"]["$get"]
>;
type _ai4 = Assert<Eq<AiConversationReq["param"], { conversationId: string }>>;
type AiConversationData = InferResponseType<
  C["api"]["ai"]["conversations"][":conversationId"]["$get"],
  200
>["data"];
type _ai5 = Assert<
  "assistant" extends AiConversationData["messages"][number]["role"]
    ? true
    : false
>;

type SystemPromptReq = InferRequestType<
  C["api"]["ai"]["system-prompts"][":id"]["$put"]
>;
type _ai6 = Assert<Eq<SystemPromptReq["param"], { id: string }>>;
type SystemPromptData = InferResponseType<
  C["api"]["ai"]["system-prompts"][":id"]["$put"],
  200
>["data"];
type _ai7 = Assert<Eq<SystemPromptData["content"], string>>;

type AiSkillReq = InferRequestType<C["api"]["ai"]["skills"][":id"]["$put"]>;
type _ai8 = Assert<Eq<AiSkillReq["param"], { id: string }>>;
type _ai9 = Assert<Eq<keyof AiSkillReq["json"] & "enabled", "enabled">>;
type AiSkillData = InferResponseType<
  C["api"]["ai"]["skills"][":id"]["$put"],
  200
>["data"];
type _ai10 = Assert<Eq<AiSkillData["content"], string>>;

// ---- 4. 特殊接口保持原样：不伪造 JSON schema ----
// POST /api/files 在 AppType 中（createRoute），但 form 是 File 任意对象
type UploadReq = InferRequestType<C["api"]["files"]["$post"]>;
type _s1 = Assert<Eq<keyof UploadReq["form"] & "file", "file">>;

export type RpcTypeProbePass = [
  _k01,
  _k02,
  _k03,
  _k04,
  _k05,
  _k06,
  _k07,
  _k08,
  _k09,
  _k10,
  _k11,
  _k12,
  _k13,
  _k14,
  _k15,
  _k16,
  _k17,
  _k18,
  _k19,
  _k20,
  _k21,
  _k22,
  _k23,
  _k24,
  _k25,
  _k26,
  _k27,
  _k28,
  _k29,
  _h1,
  _h2,
  _h3,
  _h4,
  _h5,
  _h6,
  _h7,
  _h8,
  _h9,
  _h10,
  _h11,
  _h12,
  _h13,
  _h14,
  _ai1,
  _ai2,
  _ai3,
  _ai4,
  _ai5,
  _ai6,
  _ai7,
  _ai8,
  _ai9,
  _ai10,
  _s1,
];
