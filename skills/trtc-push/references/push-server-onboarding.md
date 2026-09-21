# 后台 API 能力介绍 + 管理员凭据配置引导

> **何时读**：wizard 走到 `stage-8-unfinished-checklist` / `stage-10-roadmap` 结尾
> 输出「后台 API 能力衔接段」时，或 `stage-11-survey` 的 Q2 落到
> `unavailable`（无管理员凭据没跑自动验证）分支时。任何要向用户解释
> 「管理员凭据是什么 / 配了之后 AI 能做什么」的场景都以本文件为唯一副本，
> 禁止在多个 workflow prompt 里重复写长文本。
> troubleshoot workflow 的 stage-final-report 出现「让用户自动验证」时同样引用。

---

## 一、给用户输出的「能力衔接段」模板

> **什么时候用哪个版本**：
> - **wizard stage-8**：只用下面的「短版（2 行）」，不要抄完整 5 条。
> - **wizard stage-10**：只用一行回指（「配好管理员凭据 + 有真机时，我可以直接帮你跑三态验证」）。
> - **用户主动问「怎么配 MCP / 配了能干什么」，或 stage-11 落到 `unavailable` 分支**：才用「完整版（5 条）」+ 第二节 snippet + 第三节 UserSig 步骤。
>
> 同一个概念在一次会话里只完整展开一次；重复铺开是实测反馈里的主要噪音来源。

### 短版（2 行，wizard stage-8 用）

配好**管理员凭据**（`IM_SDKAPPID` / `IM_IDENTIFIER` / `IM_USERSIG` 三个 MCP 环境变量，只在本机读、不进聊天和工程）后，我可以直接帮你核对控制台证书、下载 `timpush-configs.json`、代发前台/后台/杀进程三态测试推送，不用你去控制台一步步点。

已经配好了就说「配置好了」或「帮我核对下控制台配置」；想现在配就说「怎么配 MCP」；先手动跑就说「先手动」，我给你手动版指引。

### 完整版（5 条，用户主动问 / `unavailable` 分支才用）

**「管理员凭据」是什么**：三个 MCP 环境变量的合称——`IM_SDKAPPID`（应用
SDKAppID）、`IM_IDENTIFIER`（管理员 UserID，默认 `administrator`）、
`IM_USERSIG`（管理员 UserSig）。凭据只在 MCP 进程本地读，不会出现在聊天
或工程文件里。配上之后，AI 就能通过 IM 公网 REST API 替你做以下事情：

**已实现的后台能力（配好凭据后 AI 可直接调用，不用你去控制台点击）：**

1. **核对腾讯云控制台证书**：查每个厂商证书登记的包名 / Bundle ID / 点击
   Intent，是否与工程 `applicationId` / Bundle ID 一致。**这是控制台『发得
   出、收不到』问题最高频的根因**，在接入期就能发现。
2. **自动下载 timpush-configs.json**：直接写进工程 `assets/` / `nativeResources`
   对应目录，你不用去控制台手动下载、拷贝。
3. **代发前台 / 后台 / 杀进程三态测试推送**：给出目标 UserID，AI 直接调后台发
   一条测试推送，不用你打开控制台的『接入测试 → 创建测试任务』；每态发完
   AI 会主动追问「收到了没」并记账。
4. **trace 推送轨迹**：某台设备没收到时，逐环给出失败原因（是根本没上报
   token、还是厂商通道被丢弃、还是本地通知被禁用）。
5. **查设备推送状态**：目标 UserID 在这台设备上 token 是否上报、通知开关
   是否开启、静默时段是否命中。

**AI 无法替你做（这些仍需你手动）**：上传厂商证书到腾讯云控制台（后台没
有上传类 API）；真机上装 App / 允许通知；华为 / 荣耀控制台改包名或 SHA-256
指纹。

---

## 二、可直接复制的 mcp.json 片段

按用户 IDE 选择对应文件：Cursor = `.cursor/mcp.json`；Claude Code = `.claude/settings.local.json`；
CodeBuddy = `.mcp.json`。**如果该文件里已经有 `trtc-push-mcp` 条目，只把
下面的 `env` 三行合并进去，不要覆盖整个条目**。

```json
{
  "mcpServers": {
    "trtc-push-mcp": {
      "command": "npx",
      "args": ["-y", "@tencent-rtc/trtc-push-mcp@latest"],
      "env": {
        "IM_SDKAPPID": "<你本次接入的 SDKAppID，纯数字，例如 1600141418>",
        "IM_IDENTIFIER": "<管理员 UserID，默认填 administrator；如果你在控制台创建了别的管理员 UserID，就填真实那个>",
        "IM_USERSIG": "<用 SecretKey 在本地短期签发的管理员 UserSig，见下方步骤；不要贴到聊天里>"
      }
    }
  }
}
```

**配好后需要重载 IDE 让 MCP 进程读到新 env**：Cursor → 侧边栏 Customize →
MCP，确认 `trtc-push-mcp` 是开的，然后 Reload Window；Claude Code → 退出并
重新 `claude`；CodeBuddy → 重启。

---

## 三、`IM_USERSIG` 从哪里来（三步）

`IM_USERSIG` 是「用 SecretKey 签发的、代表管理员身份的临时令牌」——**危险
度等价于 root 令牌**，任何拿到它的人都能以管理员身份操作你的 IM 应用。因此
不写死在配置文件里、不入 git、不贴聊天。

### 第一步：从 IM 控制台复制 `SecretKey`（一次性）

打开 **[即时通信 IM 控制台](https://console.cloud.tencent.com/im)** →
选中目标应用 → **基本配置** → 展开「密钥信息 → SDKSecretKey」（首次会要求
手机验证）→ 复制字符串。**SecretKey 本身不要写进 MCP env，只用来在本地
生成 UserSig**。

### 第二步：在本地用官方示例签发一段短期 UserSig

推荐用官方 signature/gen-sig 示例代码在本机跑一次，签发 24 小时以内有效
的 UserSig：**[UserSig 签发官方文档](https://cloud.tencent.com/document/product/269/32688)**（含
Node.js / Python / Go / Java / PHP 全语言示例）。参数：`sdkappid`（你的应用
SDKAppID）、`identifier`（一般 `administrator`）、`expire`（推荐 ≤86400 秒）。
用完过期就重签，不要签长期。

### 第三步：把签出来的 UserSig 值填进 `mcp.json` 的 `IM_USERSIG`

粘贴时确认没有多余空格 / 换行。写完保存 → 重载 IDE → 让 AI 调
`check_push_server_readiness` 验证；返回 `configured: true` 即成功。

---

## 四、安全约束（硬）

- ❌ **不要**把 UserSig 或 SecretKey 贴到 AI 对话、Issue、共享文档、聊天群里。
- ❌ **不要**签发长期（>7 天）的管理员 UserSig，也不要把签发脚本里的 SecretKey
  硬编码进入仓代码。
- ❌ **不要**在共享 / 团队构建机上配这些 env，只在你个人开发机配置。
- ✅ 用完销毁；团队人员变动或怀疑泄漏后立刻到控制台 **重置 SecretKey**。
- ✅ 定期用 `check_push_server_readiness` 检查凭据是否仍就绪；工具**永不
  回显** `IM_USERSIG` 值。

---

## 五、AI 输出该段落时的规则（给 skill 侧遵守）

- **展开粒度按场景**：wizard stage-8 只用短版 2 行、stage-10 只用一行回指；完整 5 条能力只在用户主动问或 `unavailable` 分支展开，**禁止**在 stage-8 / stage-10 各铺一遍。
- 该展开完整版时**必须列全 5 条**，不要只挑 1-2 条一句话带过；也不要反过来在不该展开的阶段铺全清单。
- 无论短版还是完整版，都必须点明「管理员凭据 = 三个 MCP 环境变量」，不能只说「配了凭据我就能帮你 X」。
- 输出 `mcp.json` snippet 时**必须用带 `json` 语言标签的 markdown 代码块**，
  保证用户能一键复制；占位符必须写清楚含义（例：`<你本次接入的 SDKAppID，纯数字>`）。
- 输出 UserSig 步骤时**必须给出两个可点击链接**：IM 控制台
  `https://console.cloud.tencent.com/im` 和 UserSig 签发官方文档
  `https://cloud.tencent.com/document/product/269/32688`。
- **禁止**把 UserSig 生成方式一句话概括成「本地短期签发」——用户不知道
  怎么签。
- 输出结束用一句自由回复引导：例「配好后回我『配置好了』或直接说『帮我
  核对下控制台配置』；先不配也 OK，说『先手动跑』我给你手动版指引」——
  不用 AskQuestion / 结构化弹卡。
