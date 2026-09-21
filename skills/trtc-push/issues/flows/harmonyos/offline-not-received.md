# HarmonyOS / 鸿蒙推送不达与适配排查流程

## 与 MCP 的关系

本文件是 **主链 owner**。主排障由 MCP `troubleshoot-harmony` 状态机固化，本文件不再用自然语言定义主链顺序。

- ROUTER `workflow_id`：`troubleshoot-harmony`
- 主链阶段：stage-0→6 主链
- 执行：`list_workflows → get_workflow_state → complete_workflow_step`；本文件只提供分诊 / 子链 / 分支知识。

主链以 state 机为准：

| state | 主链步骤 | kind |
|-------|----------|------|
| `stage-0-investigation-plan` | 排查计划确认（开场闸口） | plan |
| `stage-1-console-validity` | 控制台有效性（服务 + 鸿蒙证/签名证） | verify |
| `stage-2-scenario` | 测法与系统/应用形态 | collect |
| `stage-3-config-alignment` | 配置对齐（包名四方 / client_id / 密钥 / Profile） | verify |
| `stage-4-register-observation` | registerPush 观测 | observe |
| `stage-5-token-binding` | 推送 token 绑定 | observe |
| `stage-6-offline-test` | 离线发测 | observe |

**RegistrationID ≠ 推送 token**。

Flutter / uni-app 涉及鸿蒙时引导进入该 workflow，再按本文下钻形态差异。

## 入口现象

鸿蒙设备收不到推送、控制台 RegID 无法测试、Android APK 在鸿蒙设备上离线不达、
或 Flutter / uni-app / HAR 接入鸿蒙后异常。

鸿蒙问题必须先区分系统和应用形态（在 MCP stage-2 收集），不能直接套 Android 厂商通道流程。

## 形态判断（知识）

1. HarmonyOS NEXT / 纯血鸿蒙 vs Android 兼容。
2. 鸿蒙原生 vs Android APK / Flutter / uni-app。
3. 纯血鸿蒙：SDK / 插件是否支持鸿蒙原生 Push。
4. Android 兼容 → `../android/vendor-not-received.md` / `../../cards/android/vendor-huawei.md`。
5. 客户端密钥 vs 服务端密钥。

## 分支处理

| 分支 | 判断信号 | 处理动作 |
|---|---|---|
| 服务未开通 / 到期或证书无效 | 插件关闭、套餐过期、签名证过期 | `../../cards/common/console-validity-gate.md`；MCP stage-1 |
| 纯血 HarmonyOS 使用 Android APK 方案 | NEXT 系统，Android 通道不通 | 改用鸿蒙原生 Push 接入 |
| Android 兼容华为通道异常 | AGConnect / 签名错误 | `../../cards/android/vendor-huawei.md`；`800006` 先查 error-codes |
| 注册失败 | `registerPush` 失败、无 RegID | 下方「注册失败」+ error-codes / 1000900010 |
| 密钥类型错误 | 用服务器密钥注册客户端 Push | 改用客户端密钥 |
| 跨端插件不支持 | Flutter / uni-app 不支持鸿蒙 | 原生混合接入或等产品适配 |
| 点击崩溃 OHMUrl | `useNormalizedOHMUrl` | `../../cards/harmonyos/click-ohmurl-crash.md` |
| 1000900010 | `Illegal application identity` | 下方清单 |
| 80300002 | 服务端回执 | `../../cards/android/error-codes.md` 80300002 节 |
| uni-app 路径报错 | 鸿蒙工具链中文路径 | 工程目录改无中文路径 |
| 签名构建失败 | `certificate has expired` | 重新申请证书与 Profile |

## 注册失败

1. 回补 MCP stage-1（控制台有效性）。
2. 错误码与回调日志。
3. MCP stage-3 配置校验。
4. 注册时机与重试；仍失败 → 升级。

## 1000900010 应用身份校验失败排查清单

按概率从高到低（**校验提醒**）：

1. **签名方式**：手动签名（`.p12` + `.cer` + `.p7b`）；自动签名高发。
2. **包名一致**：AGC / IM 鸿蒙证 / Profile / 工程 `bundleName` 四方一致。
3. **Push Kit 开通后重申 Profile**：旧 Profile 拿不到合法 Push Token。
4. **证书有效期**：签名证过期导致 `SignHap` 失败。
5. **`client_id`**：`module.json5` `metadata` 写死（勿 `$string`）。
6. **设备**：云真机不支持，本地真机验证。

## 验证信号

- stage-1 / stage-3 通过；形态判断清楚。
- 注册成功；stage-5 能查到已绑定推送 token；stage-6 可达或回执可解释。

## 何时升级 / 转交

- 主链完成后仍无法解释最后一跳。
- 需鸿蒙开放平台 / 腾讯云工单与最小复现。
