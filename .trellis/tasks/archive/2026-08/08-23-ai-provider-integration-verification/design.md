# 子任务技术设计

## 验证矩阵

以 `providerId + modelId` 为主键贯穿 definition、config、runtime、catalog、enabled models、model test、Agent Run 和 model calls。每个 protocol 至少有 success/auth/timeout/upstream 一组 fake upstream。

## 生命周期矩阵

create -> check -> enable -> add model -> set default -> model test -> Agent Run -> disable -> delete；分别验证权限、revision、引用冲突、清理和重启恢复。

## 安全矩阵

验证 dangerous scheme、DNS rebinding/私网 IP、redirect、secret DTO/log/snapshot/transcript/SSE 泄漏、非法模型能力、超长输入、响应体和模型数量限制。

## 结果

测试失败按 boundary 回派 Child 1/2/3，不在集成任务添加旁路兼容；最终记录真实上游 Provider 未配置时的环境限制。
