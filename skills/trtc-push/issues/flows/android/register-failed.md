# Android registerPush 注册失败排查流程

## 与 MCP 的关系

本文件是 **分支知识**，不拥有独立主链。

- ROUTER `workflow_id`：`troubleshoot-android`
- 主链 owner：`flows/android/offline-not-received.md`
- 本文件挂载：主要挂 `stage-4-register-observation`（须先过 stage-1 / stage-3）
- 执行仍走上述 MCP workflow（进入后先过 `stage-0-investigation-plan`）；本文件不能替代 engine，也不能跳过主链门控（stage-1 有效性、stage-3 配置等）。

## 首轮证据

**顺序硬约束**：未过 `../../cards/common/console-validity-gate.md`（推送服务 + 厂商证书有效性，对齐 MCP stage-1）与主链配置校验（MCP stage-3）前，不下钻本卡细节。

1. 完整错误码与报错文本（不要只贴「失败」两个字）。
2. 完整 logcat（含堆栈）。
3. `timpush-configs.json` 关键字段是否更新到当前 App（旧包用旧文件容易错）。
4. `android/app` 厂商 JSON 与工程位置。
5. `registerPush` 调用代码与调用时机。
6. 设备品牌与是否 GMS 可用（若目标含 FCM）。

## 关系

- 已拿到 TIMPush `800xxx` / 厂商级错误码时，**先读** `../../cards/android/error-codes.md`，再回到本流程收尾或升级。
- 海外 FCM / GMS 受限细节 → `../../cards/android/fcm-gms-domestic.md`。
- 本流程与「某品牌厂商通道不达」专项的关系：厂商 JSON / 包名 / 指纹细节 → `vendor-not-received.md`。

## 排查顺序

1. 主链 stage-1：控制台有效性（服务 + 厂商证），参见上方首轮证据。
2. 主链 stage-3：配置校验提醒（厂商证 / configs / 包名指纹）；失败含「certificate fingerprint」「6003」先核 SHA256。
3. 若报错属 `800005` 家族（Tencent 或厂商标识非法），走 `error-codes.md`。
4. 若指向 FCM 或 Google 服务，先排除 GMS / 网络 / Firebase 配置。
5. 仍失败再比对 demo 与集成文档；若主链 stage-7 仍无法定位，再抓 IM SDK xlog（不要一上来就要）：**复现 → 重启应用 → 再登录 IM → 导出 *.xlog**，调用 MCP `get_imsdk_log_guide` / `decode_imsdk_xlog` / `analyze_imsdk_push_log`。

## 分支处理

| 分支                                            | 判断信号                      | 处理动作                                                                               |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| 错误码已明确                                        | `800xxx` / `6003` 等       | `../../cards/android/error-codes.md`                                               |
| `timpush-configs` 或 `google-services.json` 错误 | 与控制台元数据不一致                | 核对控制台 + `vendor-not-received.md`                                                   |
| SHA-256 不一致                                   | `certificate fingerprint` | 用 `compute_signing_sha256` 对齐厂商控制台                                                 |
| `MissingWebViewPackageException`              | 无 WebView                 | 恢复 WebView 后再验证                                                                    |
| 华为 / 荣耀                                       | AGConnect / 包名 / 指纹       | `../../cards/android/vendor-huawei.md` / `vendor-honor.md`                         |
| FCM                                           | GMS / 防火墙 / 订阅            | `../../cards/android/fcm-gms-domestic.md`                                          |
| uni-app / 鸿蒙特殊                                | 非标准 Android               | `../cross-platform/uniapp-integration.md` 或 `../harmonyos/offline-not-received.md` |

## 验证信号

- stage-1 有效性通过；错误码指向已明确。
- 修正后 `registerPush` 成功且能获得有效 RegistrationID。

## 何时升级 / 转交

- 全部本地证据与厂商元数据均正常，厂商控制台仍返回不可解释错误。
- 需要厂商后台截图与工单链信息时转客服 / 厂商通道。

## 常见错误

- 仅凭「注册失败」四个字排查而不抓错误码。
- 忽略「先过控制台有效性 + 配置校验」而直接怀疑代码。
- 把 FCM 网络问题当成腾讯云侧必现 bug。
- 在华为 / 荣耀上漏配 SHA-256 或错放 `agconnect-services.json`。
- 用旧 `timpush-configs.json` 适配新 App。

