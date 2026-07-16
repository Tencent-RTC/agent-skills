# python 反代适配器

`fastapi_reverse_proxy.py.tpl` —— 转发到骨架服务 `/api/v1/meeting/*` 的示例路由，转发前带一个必须实现的权限校验占位函数 `require_room_owner`。

拷贝后：
1. 去掉 `.tpl` 后缀
2. 替换 `${SKELETON_BASE_URL}` 和 `${ROUTE_PREFIX}`
3. 实现 `require_room_owner`，接入你自己系统的权限判断（见 `../integration_templates/room-owner-authz-note.md`）
4. 挂到你的 FastAPI app：`app.include_router(router)`

如果你是单目标场景（不需要 meeting-ops），把转发目标换成 `/api/v1/translation/start` / `/stop` 即可，不需要权限校验占位（该端点不是特权操作，但仍建议做基础鉴权）。
