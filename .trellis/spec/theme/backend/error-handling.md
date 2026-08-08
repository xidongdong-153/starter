# Theme 后端错误边界

`hexToRgb`、`hexToHsl` 等纯函数对非法颜色返回 `null`，`hexToRgba` 在无法解析时返回透明黑色，`mixColors` 在任一输入非法时返回第一个颜色。这些是当前 API，调用方应按返回值处理，不在 API 中把主题解析错误伪装成业务 `AppError`。

不要把主题颜色错误信息写入 API response，也不要在服务端日志中记录用户私有设置以外的无关内容。
