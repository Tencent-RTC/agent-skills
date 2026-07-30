# TRTC Agent Skills

**[English](README.md)** | 简体中文

TRTC Agent Skills 是由[腾讯实时音视频（TRTC）](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ)提供的一套 Agent Skill，帮助开发者在应用中接入实时音视频、直播、即时通信和 TIMPush 离线推送等能力，覆盖从初始配置到代码实现的完整流程。

你不必再从大量文档中查找接入步骤。只需用自然语言说出想实现的功能，Skill 就会识别你的需求、确认必要信息，并逐步引导你完成接入。

它适用于视频会议、直播间、1v1 视频问诊、在线课堂、客服聊天和移动端离线推送等场景，支持 Web、iOS、Android 和 Flutter 等平台。

---

## 关于 Tencent RTC

[Tencent RTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ)（实时音视频）为全球数千家企业提供实时音频、视频和对话式 AI 体验。依托覆盖200多个国家和地区的全球边缘网络，TRTC 提供低于300ms的超低延迟大规模实时通信能力。

---

## 安装

使用 npx 安装器。在项目根目录执行：

```bash
# 默认 — 自动检测已安装的 IDE（~/.{claude,cursor,codebuddy,codex}/）
# 为每一个检测到的 IDE 都安装好；都没检测到时回退到 claude
npx -y @tencent-rtc/trtc-agent-skills@latest add

# 强制为所有支持的 IDE 都装一份（即使你本机没装那个 IDE）
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# 只为某个指定的 IDE 安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 重装前先清理旧的安装
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

---

## 能做什么

当你提到 TRTC 或描述一个实时通信场景时，Skill 会自动触发，无需任何斜杠命令，直接用自然语言提问即可。

- **探索与评估**——在修改项目之前运行 Demo，或了解可用的集成方案。
- **集成能力**——检查项目、明确需求，并逐步引导完成集成。
- **扩展现有集成**——在已有项目中添加支持的能力，无需重新开始集成。
- **排查问题**——诊断集成错误、配置问题和异常运行行为。
- **查询官方信息**——基于官方文档回答 API、错误码、限制、计费和最佳实践等问题，并提供对应链接。
- **恢复之前的工作**——在本地保存集成进度，以便在后续会话中继续。

---

## 支持的产品与平台

| 产品或场景 | 支持平台 | 引导能力 | 示例 Prompt |
|---|---|---|---|
| **Conference** | Web（Vue 3 / React） | Demo 配置、会议集成、屏幕共享、会中聊天、功能扩展和问题排查 | • *"在我的 React 应用中添加视频会议"*<br>• *"从零开始带我构建一个完整的会议室"*<br>• *"会议已经可以使用了，现在添加屏幕共享"*<br>• *"用户加入房间时遇到错误 6206"* |
| **Conversational AI：AI 客服** | Web | 语音智能体配置、知识库、人工转接、工具调用、会话摘要和现有后端集成 | • *"使用 TRTC 构建一个 AI 客服"*<br>• *"给我的网站添加语音 AI 客服"*<br>• *"将 AI 客服接入现有的 Node.js 后端"*<br>• *"为我的语音智能体添加知识库问答和人工转接"* |
| **Conversational AI：AI 口语陪练** | Web | 场景角色扮演、即时纠错、回复建议、能力报告、自定义学习知识和现有应用集成 | • *"使用 TRTC 构建一个 AI 英语口语陪练"*<br>• *"在现有应用中添加 AI 口语练习"* |
| **Conversational AI：AI 实时翻译** | Web | 实时翻译、多语言会议口译、双语字幕、转写和会议扇出 | • *"使用 TRTC 构建一个 AI 实时翻译助手"*<br>• *"为我的会议室添加实时翻译"*<br>• *"在视频会议中显示双语字幕"* |
| **Chat** | Web | Chat 集成、消息、会话、群组、用户资料、功能扩展和问题排查 | • *"在我的 Web 应用中添加即时通信"*<br>• *"构建一个客服聊天页面"*<br>• *"在现有 React 应用中添加群聊"*<br>• *"帮我排查收不到消息的问题"* |
| **Push** | Android / iOS / Flutter / UniApp | TIMPush 配置、厂商通道、APNs、角标、服务端 API、控制台限制检查和问题排查 | • *"帮我在 Android 应用中集成 TIMPush"*<br>• *"为 iOS 应用配置 APNs 离线推送"*<br>• *"为 Flutter 应用配置厂商推送通道"*<br>• *"为推送通知添加未读消息角标"*<br>• *"`registerPush` 失败，错误码为 800006"* |
| **Call** | Flutter | Demo 体验、1v1 和群组音视频通话、将通话嵌入现有应用、功能扩展和问题排查 | • *"我想体验 Flutter 通话 Demo"*<br>• *"在我的 Flutter 应用中添加 1v1 视频通话"*<br>• *"在现有应用中添加群组语音通话"*<br>• *"来电页面没有显示"* |
| **Live** | 即将支持 | 暂不提供引导式集成 | • *"查看观众连麦的相关文档"*<br>• *"Tencent RTC 提供哪些直播能力？"* |
| **RTC Engine** | 即将支持 | 暂不提供引导式集成 | • *"如何发布和订阅音视频流？"*<br>• *"查看 RTC Engine 房间管理文档"* |

即使尚未支持引导式集成，也可以查询所有 Tencent RTC 产品的文档、错误码、计费和产品限制。

---

## 工作原理

1. **理解你的请求**  
   Skill 会识别你的目标，例如体验 Demo、开始集成、添加能力、排查问题或查询文档。

2. **检查你的项目**  
   当 Skill 可以访问项目时，它会识别框架、平台、现有依赖和当前集成状态。

3. **确认集成路径**  
   Skill 只会询问确定产品、平台和实现方案所需的必要问题。

4. **引导并验证集成**  
   对于支持的工作流，Skill 会说明计划变更，每次实现一项能力，并在继续之前验证结果。

5. **保存进度**  
   集成进度会保存在 `.trtc-session.yaml` 中，后续会话可以从上一个检查点继续。

---

## 相关链接

- [TRTC 文档](https://trtc.io/document)
- [控制台（国际站）](https://console.trtc.io)
- [控制台（中国站）](https://console.cloud.tencent.com)
- [提交问题](https://github.com/Tencent-RTC/agent-skills/issues)

---

## 联系我们

如需技术支持或企业定制优惠，可访问 [trtc.io/contact](https://trtc.io/contact) 提交联系方式，我们的团队将尽快与您联系。
