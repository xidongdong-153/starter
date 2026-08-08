# Admin Hook 规范

## 查询 hooks 与 UI hooks 分开

服务器数据 hooks 放在 `src/api/<domain>/*.query.ts`，使用 `useQuery`、`useMutation` 和 `useQueryClient`。本地交互 hooks 放在 `src/hooks/`，例如 `useMobile` 和 `useRouteListener`。

```tsx
// apps/admin/src/api/profile/profile.query.ts
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(profileQueryKeys.detail(), profile);
    },
  });
}
```

## 副作用生命周期

`useEffect` 只处理订阅、DOM 或外部客户端同步，并返回清理函数。`useMobile` 在 resize 时通过 `requestAnimationFrame` 合并检查，并在卸载时移除监听器和取消 frame；新增同类 hook 要保持这个结构。

```tsx
useEffect(() => {
  window.addEventListener("resize", requestCheckMobile);
  return () => {
    window.removeEventListener("resize", requestCheckMobile);
    cancelAnimationFrame(rafId);
  };
}, []);
```

`useRouteListener` 只从路由匹配结果同步标签栏，不在 effect 中发起业务请求。依赖数组必须包含 effect 读取的 store selector 和路由值。

## Hook 边界

不要在 store action 中调用 React hook。需要跨页面持久化的值放在 Zustand；需要请求缓存的值放在 React Query；组件内一次性的输入仍用 `useState` 或 Ant Design Form。
