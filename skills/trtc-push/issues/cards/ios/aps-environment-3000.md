# iOS APNs code=3000 / aps-environment 缺失

## 现象

- `didFailToRegisterForRemoteNotificationsWithError`
- `Error Domain=NSCocoaErrorDomain Code=3000`
- `未找到应用程序的“aps-environment”的授权字符串`
- `registerPush failed code=3000`

## 根因（按优先级）

1. **`.entitlements` 文件为空**（`<dict/>`）或不含 `aps-environment`。
2. **`CODE_SIGN_ENTITLEMENTS` 未关联**到 App target（pbxproj 无该设置）。
3. **XcodeGen**：只在 Xcode UI 加了 Push Notifications，或只写了
   `entitlements.path` 没写 `entitlements.properties`——下次 `xcodegen generate`
   会清掉 Capability / 把 entitlements 覆写成空 dict。
4. Apple Developer App ID 未开 Push（较少表现为这句文案，但仍需核对）。

## 修复

### XcodeGen 工程（推荐一次做对）

```yaml
# project.yml target
entitlements:
  path: App/App.entitlements
  properties:
    aps-environment: development
settings:
  base:
    PRODUCT_BUNDLE_IDENTIFIER: com.your.real.bundleid  # 勿回退 com.example.*
    DEVELOPMENT_TEAM: YOURTEAMID
```

然后：`xcodegen generate` → `pod install` → 打开 `.xcworkspace` → Clean →
删真机旧包 → 重装。

### 非 XcodeGen

Xcode → Signing & Capabilities → + Push Notifications，确认 entitlements
含 `aps-environment`。

### 用 MCP 复核

`detect_ios_project` 应返回：

- `aps_environment_present=true`
- `entitlements_file_empty=false`
- XcodeGen 时 `xcodegen_entitlements_wired=true`
- 无 `aps_environment_*` / `xcodegen_entitlements_not_in_yml` warnings

## 验证

真机登录后不应再出现 code=3000；应出现业务日志
`>>>>> TIMPush registerPush success` 与 `>>>>> TIMPush registrationID=`。
