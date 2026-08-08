# Theme 前端质量规范

## 检查命令

```bash
pnpm --filter @starter/theme check-types
pnpm --filter @starter/theme lint
pnpm --filter @starter/theme format:check
pnpm --filter @starter/theme build
pnpm --filter @starter/admin check-types
pnpm --filter @starter/web check-types
```

## 变更检查

- Dawn 和 Moon 都有完整的基础背景、surface、文字、border、primary、danger、success、warning、info 变量。
- CSS 变量名在 `core.css`、`admin.css`、`web.css` 中保持一致，新增 token 要同步入口映射。
- Admin 的 Ant Design algorithm 和组件 token 在两套主题下都能得到配置。
- system 主题首屏脚本和客户端 hook/store 不产生 hydration mismatch。
- 颜色函数的非法输入和色阶生成边界有单元级验证或调用方检查。

不要只在单一浏览器应用的一个主题下检查颜色变化。
