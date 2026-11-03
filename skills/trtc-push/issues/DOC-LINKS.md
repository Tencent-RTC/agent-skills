# 官方文档链接索引（DOC-LINKS）

本文件是 **所有官网文档链接的唯一登记处**。卡片 / 流程 / 路由里只写 `key`，不写链接；需要给用户链接时，来这里查。

## 使用规则

- **官网链接有值** → 给用户官网链接。
- **官网链接为空（状态「待发布」或「待补官网链接」）** → 不给链接，告诉用户「官网《文档页》的『章节』这一节」，用户可自行搜索。
- 禁止在本 Skill 任何文件里写内部文档站地址；`npm run verify` 会拦截。
- 官网文档发布后，运行 `npm run doc:links`（默认只预览，加 `--write` 才写入）自动填「官网链接」和「状态」；也可手工只改这两列，其他文件不用动。

## 字段说明

| 列 | 含义 |
|---|---|
| `key` | 稳定标识，卡片 / 流程头部的 `doc_source` 和 `ROUTER.json` 的 `doc_key` 引用它。起好后不要改名 |
| 文档页 | 文档在官网目录里的位置，不含 `.mdx`，如 `常见问题/Android 平台问题` |
| 章节 | 该页内的标题原文（完全一致）；留空表示整页 |
| 官网链接 | 发布后由人工填写；为空即「待补」 |
| 状态 | `待发布`（文档页还没上线）、`待补官网链接`（页面已上线、链接还没填，或线上缺这一小节）或 `已发布` |

对账脚本（`npm run doc:check`，见 `scripts/doc-reconcile.js`）会按「文档页 + 章节」在本地文档里定位这一节，用它的内容指纹判断卡片是否过期。

## 链接表

| key | 文档页 | 章节 | 官网链接 | 状态 |
|---|---|---|---|---|
| faq-android-samsung-brands | 常见问题/Android 平台问题 | 支持向三星、中兴、传音等手机推送吗？ | https://cloud.tencent.com/document/product/269/130368#450e2267-7307-44b1-9b70-24054b268eee | 已发布 |
| faq-android-notification-settings | 常见问题/Android 平台问题 | 设备通知栏设置对推送有什么影响？ | https://cloud.tencent.com/document/product/269/130368#b056d370-2f68-4e73-b5b5-4168235290b9 | 已发布 |
| faq-android-fcm-notes | 常见问题/Android 平台问题 | FCM 推送有哪些注意事项？ | https://cloud.tencent.com/document/product/269/130368#4d3d1fd2-c804-4af8-8f6f-bd982183d73a | 已发布 |
| faq-android-sdk-conflict | 常见问题/Android 平台问题 | 第三方推送 SDK 与 TIMPush 冲突，如何处理？ | https://cloud.tencent.com/document/product/269/130368#21267dd8-5b6c-42b5-a464-e9cbc5ce81e5 | 已发布 |
| faq-android-agconnect-build | 常见问题/Android 平台问题 | 编译时报 com.huawei.agconnect 错误，如何处理？ | https://cloud.tencent.com/document/product/269/130368#114759ce-3369-4875-a34d-f90cffb8b6a2 | 已发布 |
| faq-android-800005 | 常见问题/Android 平台问题 | registerPush 报错 800005、800006 或 800008，如何处理？ | https://cloud.tencent.com/document/product/269/130368#45de08d3-8b00-418a-bfe9-6f25ec6457cb | 已发布 |
| faq-android-huawei-register | 常见问题/Android 平台问题 | 华为或荣耀注册报错（907135702 等），如何处理？ | https://cloud.tencent.com/document/product/269/130368#21968b65-2243-4566-9ca1-891f4cbd422d | 已发布 |
| faq-android-huawei-token-empty | 常见问题/Android 平台问题 | 华为设备注册失败且 Token 为空，如何处理？ | https://cloud.tencent.com/document/product/269/130368#9512ddd5-a0cf-43e0-8f24-8672007914f4 | 已发布 |
| faq-android-huawei-80300002 | 常见问题/Android 平台问题 | 华为推送报错 80300002（Android），如何处理？ | https://cloud.tencent.com/document/product/269/130368#71387692-10b9-4611-8918-d6e30a79e5a8 | 已发布 |
| faq-android-debug-release | 常见问题/Android 平台问题 | 为什么 Debug 版本正常，Release 版本异常？ | https://cloud.tencent.com/document/product/269/130368#b1aa4ef4-dfb9-4e4a-9b9e-a47f28457d29 | 已发布 |
| faq-android-oppo | 常见问题/Android 平台问题 | OPPO 手机收不到推送，如何排查？ | https://cloud.tencent.com/document/product/269/130368#1da9b1c3-0070-487d-bcd2-348656cefaca | 已发布 |
| faq-android-xiaomi-vivo-store | 常见问题/Android 平台问题 | 小米或 vivo 手机收不到推送，如何处理？ | https://cloud.tencent.com/document/product/269/130368#4f2740d0-ccd5-49ac-83e6-7762256827ff | 已发布 |
| faq-android-xiaomi-errors | 常见问题/Android 平台问题 | 小米推送报错 10016、10041 或 200001，如何处理？ | https://cloud.tencent.com/document/product/269/130368#d4f7a2c9-1e6b-4b83-9a5d-3c8e0f7b2d16 | 已发布 |
| faq-android-fcm-no-receive | 常见问题/Android 平台问题 | Google FCM 收不到推送，如何处理？ | https://cloud.tencent.com/document/product/269/130368#82283f46-a74f-4746-92fa-eb332be57c97 | 已发布 |
| faq-android-vivo-10302 | 常见问题/Android 平台问题 | vivo 推送报错 10302，如何处理？ | https://cloud.tencent.com/document/product/269/130368#06e561d0-1bca-4f08-b871-48d6d8b9bbdc | 已发布 |
| faq-android-vivo-10096 | 常见问题/Android 平台问题 | vivo 推送报错 10096 或 10097，如何处理？ | https://cloud.tencent.com/document/product/269/130368#b8e3c5a1-4d7f-4f20-8c96-1a5d9e2f7b34 | 已发布 |
| faq-android-vivo-channel-id | 常见问题/Android 平台问题 | vivo 的本地通知 CHANNEL_ID 需要填到腾讯云吗？ | https://cloud.tencent.com/document/product/269/130368#a3c6bdf2-f7ac-4bd2-9572-cc43ac8d36ee | 已发布 |
| faq-android-online-callback | 常见问题/Android 平台问题 | 在线时收不到 onRecvPushMessage 回调，如何处理？ | https://cloud.tencent.com/document/product/269/130368#e7b9b6ce-e070-4022-8bb0-5ea2a033c8a5 | 已发布 |
| faq-android-oppo-desc-too-long | 常见问题/Android 平台问题 | OPPO 消息内容过长时收不到推送，如何处理？ | https://cloud.tencent.com/document/product/269/130368#e93f4af2-1969-49af-bde0-91883194d6b9 | 已发布 |
| faq-android-oppo-rest-vs-client | 常见问题/Android 平台问题 | 为什么 OPPO 设备能收到 REST API 推送，却收不到客户端消息推送？ | https://cloud.tencent.com/document/product/269/130368#f5b9541a-0ca3-44e1-a104-432cb2fe282e | 已发布 |
| faq-android-online-not-offline | 常见问题/Android 平台问题 | 能收到离线推送但收不到在线推送，如何处理？ | https://cloud.tencent.com/document/product/269/130368#b3c7fb74-e1da-469c-a8c8-ec211d1f48e3 | 已发布 |
| faq-android-force-stop | 常见问题/Android 平台问题 | 强制停止应用后收不到推送，如何处理？ | https://cloud.tencent.com/document/product/269/130368#e78078f1-0015-4fd8-9b48-703a5c74d971 | 已发布 |
| faq-android-click-jump | 常见问题/Android 平台问题 | 点击通知后无法跳转，如何排查？ | https://cloud.tencent.com/document/product/269/130368#1b8997aa-7c0e-406b-820e-d78040cd24e2 | 已发布 |
| faq-flutter-firebase | 常见问题/Flutter 平台问题 | Flutter 注册 FCM 报错 Default FirebaseApp is not initialized，如何处理？ | https://cloud.tencent.com/document/product/269/139821#aec32e0d-7ece-4ebe-8594-a92c2d1ea3c5 | 已发布 |
| faq-flutter-kicked | 常见问题/Flutter 平台问题 | Flutter 调用 registerPush 后账号被踢出，如何处理？ | https://cloud.tencent.com/document/product/269/139821#72ba557e-c0e4-479d-af75-ab4e6016f5f2 | 已发布 |
| faq-flutter-oppo-fcm | 常见问题/Flutter 平台问题 | Flutter 在 OPPO 设备注册 FCM 失败，如何处理？ | https://cloud.tencent.com/document/product/269/139821#d0eb4b1a-3ee9-4782-b786-cb222359cd5e | 已发布 |
| faq-flutter-click | 常见问题/Flutter 平台问题 | Flutter 点击通知不触发 onNotificationClicked，如何处理？ | https://cloud.tencent.com/document/product/269/139821#6fd3f2b8-d2b1-402b-bf98-57b2398aedfc | 已发布 |
| faq-flutter-callkit | 常见问题/Flutter 平台问题 | Flutter TUICallKit 点击通话通知后不跳转，如何处理？ | https://cloud.tencent.com/document/product/269/139821#0d722def-5607-43da-94dd-98290bfbf97a | 已发布 |
| faq-harmony-android-plan | 常见问题/HarmonyOS 平台问题 | HarmonyOS NEXT 使用 Android 方案收不到推送，如何处理？ | https://cloud.tencent.com/document/product/269/139822#46de5d30-dc63-4377-9fed-338dd3ada50c | 已发布 |
| faq-harmony-80300002 | 常见问题/HarmonyOS 平台问题 | HarmonyOS 推送报错 80300002，如何处理？ | https://cloud.tencent.com/document/product/269/139822#c7d4be02-4d2f-4a90-83c3-1bc6f01b8aac | 已发布 |
| faq-harmony-1000900010 | 常见问题/HarmonyOS 平台问题 | HarmonyOS 推送报错 1000900010，如何处理？ | https://cloud.tencent.com/document/product/269/139822#fedad748-d777-449e-a4d4-d226442e3903 | 已发布 |
| faq-harmony-ohmurl | 常见问题/HarmonyOS 平台问题 | HarmonyOS 开启 useNormalizedOHMUrl 后点击通知崩溃，如何处理？ | https://cloud.tencent.com/document/product/269/139822#ec1eddbb-b24f-47d6-96d4-5233cb366b61 | 已发布 |
| faq-ios-apns-voip | 常见问题/iOS 平台问题 | APNs、VoIP 和 LiveActivity 有什么区别？ | https://cloud.tencent.com/document/product/269/130369#6a13c555-efab-487c-b678-220a05045b34 | 已发布 |
| faq-ios-cert-expired | 常见问题/iOS 平台问题 | iOS 证书过期，如何处理？ | https://cloud.tencent.com/document/product/269/130369#2cda3713-7b96-4243-a766-01bf8e42233d | 已发布 |
| faq-ios-3000 | 常见问题/iOS 平台问题 | iOS 注册报错 errCode 3000，如何处理？ | https://cloud.tencent.com/document/product/269/130369#07481c1d-ab7c-4ef4-962e-de8f4ffbf07c | 已发布 |
| faq-ios-token-mismatch | 常见问题/iOS 平台问题 | 控制台测试提示 Token 与证书不匹配，如何处理？ | https://cloud.tencent.com/document/product/269/130369#27cfbb0f-5d7f-49a8-a284-810d1b46e75b | 已发布 |
| faq-ios-token-sporadic | 常见问题/iOS 平台问题 | 注册时偶现不返回 deviceToken，如何处理？ | https://cloud.tencent.com/document/product/269/130369#fde6ba46-74e0-4eb6-b12d-7fa4e7ac2504 | 已发布 |
| faq-ios-bad-devicetoken | 常见问题/iOS 平台问题 | 后台报错 bad devicetoken，如何处理？ | https://cloud.tencent.com/document/product/269/130369#ceb143b7-7713-4d7d-8d9a-5357df0eeed4 | 已发布 |
| faq-ios-403 | 常见问题/iOS 平台问题 | APNs 报错 403 InvalidProviderToken，如何处理？ | https://cloud.tencent.com/document/product/269/130369#9f56d067-1b14-48fa-ab49-2e29573c9da2 | 已发布 |
| faq-ios-library-not-loaded | 常见问题/iOS 平台问题 | iOS 启动报错 Library not loaded: ImSDK_Plus，如何处理？ | https://cloud.tencent.com/document/product/269/130369#fdc5119b-2b3f-45bc-8a89-430f966bbf41 | 已发布 |
| faq-ios-xcodegen | 常见问题/iOS 平台问题 | XcodeGen 工程编译报错 No such module 'TIMPush'，如何处理？ | https://cloud.tencent.com/document/product/269/130369#3c5e735e-3746-43b6-8aa5-58e9c97b4279 | 已发布 |
| faq-ios-normal-msg-offline | 常见问题/iOS 平台问题 | 普通消息为什么收不到离线推送？ | https://cloud.tencent.com/document/product/269/130369#6e37c0c6-1bd2-45c0-90a4-93200c02c391 | 已发布 |
| faq-ios-no-display | 常见问题/iOS 平台问题 | iOS 已收到推送但没有看到通知，如何检查？ | https://cloud.tencent.com/document/product/269/130369#c8183927-7cb9-4f53-9f08-869beec86a25 | 已发布 |
| faq-ios-click-ext | 常见问题/iOS 平台问题 | 点击通知后拿不到 ext 或无法跳转，如何处理？ | https://cloud.tencent.com/document/product/269/130369#c116e9e9-31e8-415f-8dde-ab0a3201df81 | 已发布 |
| faq-ios-receipt | 常见问题/iOS 平台问题 | iOS 没有收到触达回执，如何处理？ | https://cloud.tencent.com/document/product/269/130369#91167a70-9f97-40a3-9381-d799c48fc02a | 已发布 |
| faq-ios-badge | 常见问题/iOS 平台问题 | iOS 桌面角标和 IM 未读数不一致，如何自定义角标？ | https://cloud.tencent.com/document/product/269/130369#10c82b01-e7d7-4a44-9efa-5c6ad6721ddf | 已发布 |
| faq-other-uniapp | 常见问题/其他平台问题 | uni-app 收不到推送，如何处理？ | https://cloud.tencent.com/document/product/269/139823#6d4a6123-067b-4b4b-8a33-19331312c1d4 | 已发布 |
| faq-other-miniprogram-batch | 常见问题/其他平台问题 | 小程序调用 batch 接口成功，为什么控制台没有记录？ | https://cloud.tencent.com/document/product/269/139823#55da1036-6d09-4af9-b165-6186ce25cc2d | 已发布 |
| faq-common-troubleshoot-entry | 常见问题/通用问题 | 收不到推送，如何排查？ | https://cloud.tencent.com/document/product/269/139820#56eabc8a-1ef5-4dc5-9ca8-ee7e7e33e369 | 已发布 |
| faq-common-custom-msg-offline | 常见问题/通用问题 | 自定义消息为什么收不到离线推送？ | https://cloud.tencent.com/document/product/269/139820#61259998-fe15-4dbd-b3d0-eb479211fc02 | 已发布 |
| faq-common-only-few | 常见问题/通用问题 | 推送只能收到几条，之后就收不到了？ | https://cloud.tencent.com/document/product/269/139820#789bed1a-ad2d-438c-922c-5377534ac67a | 已发布 |
| faq-common-regid-not-exist | 常见问题/通用问题 | 控制台提示 RegistrationID 或 UserID 不存在，如何处理？ | https://cloud.tencent.com/document/product/269/139820#f1e482a6-4a34-48b1-b0b3-ba1193a8d3b6 | 已发布 |
| faq-common-cert-limit | 常见问题/通用问题 | 新增厂商证书时提示数量已达上限，如何处理？ | https://cloud.tencent.com/document/product/269/139820#533cb7e1-aef5-4df7-bbdc-382f33d24e66 | 已发布 |
| faq-common-badge | 常见问题/通用问题 | 角标不显示或不清零，如何处理？ | https://cloud.tencent.com/document/product/269/139820#b6f3acc3-cc10-4623-8574-3526f6fbea61 | 已发布 |
| faq-common-overseas | 常见问题/通用问题 | 海外推送如何配置？ | https://cloud.tencent.com/document/product/269/139820#5dbcf497-5bff-43d4-bab4-b7fd0cceab3d | 已发布 |
| faq-common-push-only | 常见问题/通用问题 | 不接入 IM 聊天能力，只使用推送服务可以吗？ | https://cloud.tencent.com/document/product/269/139820#25fce3ab-40fa-4ccd-8f88-f7064bbb1bbc | 已发布 |
| faq-common-chat-offline | 常见问题/通用问题 | 即时通信 Chat 是否自带离线推送？还需要开通 Push 吗？ | https://cloud.tencent.com/document/product/269/139820#3c105bb8-7c8a-495c-9004-de6157eb78e4 | 已发布 |
| faq-common-sdkappid-diff | 常见问题/通用问题 | 即时通信 Chat 和推送服务 Push 的 SDKAppID 和密钥有什么区别？ | https://cloud.tencent.com/document/product/269/139820#d5e69bbd-c95a-4778-9336-c80c8ca720df | 已发布 |
| faq-common-console-ok-im-offline | 常见问题/通用问题 | 控制台测试推送成功，但 IM 消息离线收不到，如何处理？ | https://cloud.tencent.com/document/product/269/139820#a1eaefa7-719b-4246-874e-2d91bf746b08 | 已发布 |
| faq-common-vs-selfbuild | 常见问题/通用问题 | 推送服务（Push）和自行集成有什么区别？ | https://cloud.tencent.com/document/product/269/139820#6406a772-f6af-46bd-ab51-13e3aa8b5067 | 已发布 |
| faq-common-qps | 常见问题/通用问题 | 推送总量和 QPS 有限制吗？ | https://cloud.tencent.com/document/product/269/139820#f32308cc-3cb5-4cc0-af76-7b45aa1cea2e | 已发布 |
| faq-common-stats-delay | 常见问题/通用问题 | 触达统计是否有延迟？ | https://cloud.tencent.com/document/product/269/139820#e8a45a38-b8b8-4306-992a-064d25eb3de7 | 已发布 |
| faq-common-disable-offline | 常见问题/通用问题 | 如何关闭离线推送消息的接收？ | https://cloud.tencent.com/document/product/269/139820#d2c9d97c-bd99-4665-a1e7-0fd1e8131939 | 已发布 |
| faq-common-plugin-expire | 常见问题/通用问题 | 推送插件费用到期会怎样？ | https://cloud.tencent.com/document/product/269/139820#85fd2cc7-1d54-4059-9d36-c67d9f3247e8 | 已发布 |
| faq-common-privacy | 常见问题/通用问题 | 上架时如何满足隐私合规要求？ | https://cloud.tencent.com/document/product/269/139820#fe7251da-499d-4907-a016-58588a999f60 | 已发布 |
| ts-common-prereq | 常见问题/收不到在线、离线推送排查流程 | 公共前提检查 | https://cloud.tencent.com/document/product/269/139819#ae6cbcfb-53c4-4c0a-94a9-b79061577459 | 已发布 |
| ts-by-type | 常见问题/收不到在线、离线推送排查流程 | 按推送类型、在线/离线状态初步排查 | https://cloud.tencent.com/document/product/269/139819#c9db5471-9c61-4cef-b1e5-657a07f77098 | 已发布 |
| ts-offline-chain | 常见问题/收不到在线、离线推送排查流程 | 离线通知链路排查 | https://cloud.tencent.com/document/product/269/139819#ea408641-0332-4532-8e34-941b8eac9816 | 已发布 |
| ts-chain-register | 常见问题/收不到在线、离线推送排查流程 | 设备情况异常：检查厂商注册 | https://cloud.tencent.com/document/product/269/139819#a196ed80-1751-4bb5-a505-06acc80a825a | 已发布 |
| ts-chain-cert | 常见问题/收不到在线、离线推送排查流程 | 「提交离线通道」报错：检查后台证书 | https://cloud.tencent.com/document/product/269/139819#af776fd2-d9b7-4849-960b-7793d758257a | 已发布 |
| ts-chain-vendor | 常见问题/收不到在线、离线推送排查流程 | 「提交厂商通道」报错：检查厂商下发 | https://cloud.tencent.com/document/product/269/139819#fcf5ed02-65f6-4fba-b0b5-687219d0b245 | 已发布 |
| ts-chain-display | 常见问题/收不到在线、离线推送排查流程 | 已推送至设备但没看到：检查设备展示 | https://cloud.tencent.com/document/product/269/139819#81436a28-5828-4535-833d-58ba1a3cffdc | 已发布 |
| ts-ticket-info | 常见问题/收不到在线、离线推送排查流程 | 提交工单前准备的信息 | https://cloud.tencent.com/document/product/269/139819#9cad53e2-a74d-4504-aac3-5f4256a6e71e | 已发布 |
| doc-chat-push-mixed | 快速接入/Chat 与 Push 混用说明 |  | https://cloud.tencent.com/document/product/269/139824 | 已发布 |
| doc-custom-badge | 快速接入/高级功能/自定义角标 | 厂商通道支持说明 | https://cloud.tencent.com/document/product/269/100645#cd7482b2-4715-40fd-8cfa-e6efb0fd390b | 已发布 |
| doc-troubleshoot-tool | 控制台指南/排查工具 |  | https://cloud.tencent.com/document/product/269/100629 | 已发布 |
| doc-error-codes | 错误码 |  | https://cloud.tencent.com/document/product/269/117847#46e07b24-1ff7-4100-b027-485f667cf7a5 | 已发布 |
