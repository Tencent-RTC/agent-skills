# capability-catalog — 官网有、skill 未做成 slice 的功能应对手册

> **用途**：用户在集成过程中明确提到某个官网「高级功能」时，AI 据此判断该怎么回应，
> **禁止一刀切说「暂不支持」**。由 `SKILL.md` Step 1 的 slice 兜底行分派。
>
> **范围**：只登记官网 Call / Flutter「高级功能」侧边栏的 4 项。命中则按对应类别应对；
> 未登记的能力才回落到「确实无法支持」+ 说明原因。
>
> **底层事实**：当前 `tencent_calls_uikit 5.0.0` 的通话 UI 是封闭的（私有类、无按钮注入点）。
> 凡是「需要在通话界面内加按钮」的功能，UIKit 都无法叠加——只能脱离 UIKit、在
> `atomic_x_core` 层自建通话页（视频渲染可复用公开组件 `CallCoreView`，但布局+按钮要重写）。
> 这是**界面重构级**工作量，不是「叠加一个能力」。

---

## 三种应对类别

| 类别 | 含义 | AI 应对基调 |
|------|------|-----------|
| **default-on** | SDK 默认已生效，零代码零配置 | 直接告知「已生效，无需集成」 |
| **stackable** | 无 UI，纯参数/开关，可叠加到现有 UIKit 集成 | 走「说明前置 → 等用户回填 → 帮加代码」标准流 |
| **relayer** | 需要在通话界面内加按钮，UIKit 无法叠加 | **诚实告知这是界面重构级岔路口**，拿到用户明确「确认要走」再给 engine API + 自建页方向 |

---

## AI 降噪 — `default-on`

**官网结论（原文）**：「TUICallKit 目前已默认开通 AI 降噪功能，用户无需进行额外的设置或操作，即可在应用中享受高质量的降噪效果。」

**应对**：
> AI 降噪在 TUICallKit 里是**默认开启**的，你不需要写任何代码或做任何配置，通话中已经在生效。

- 不生成代码，不改任何文件。
- engine 层也没有对应开关 API（因为是自动生效），不要去找 API 让用户调。

---

## 云端录制 — `stackable`

**能力现状**：客户端可控，`CallParams.cloudRecordPolicy`（`followConsoleConfig` / `enable` / `disable`）真透传到 native（`call_store_converter.dart:78`）。**无 UI，是发起通话时的一个参数。**

**前置（必须先完成）**：
- 腾讯云控制台**开通云端录制能力**（SDK 源码注释原文：*Prerequisite: the relevant capability must already be enabled in the console*）。
- 录制产物（存储位置/格式）在控制台配置，不在客户端代码里。

**应对（标准 config→回填→继续 流程）**：
1. 告知：云端录制需要先在控制台开通「云端录制」能力（按语言分流给控制台链接：中文给国内站+国际站，英文只给国际站）。
2. 让用户开通后回来确认。
3. 用户确认后，在发起通话的 `CallParams` 上加参数：
   ```dart
   CallParams(cloudRecordPolicy: CloudRecordPolicy.enable)   // 强制本次录制
   // 或 CloudRecordPolicy.followConsoleConfig（默认，跟随控制台全局配置）
   ```
   落点：`group_call.dart` 的 `CallParams(...)` 构造处，或 `call_service.dart` 的
   `startCall`/`startGroupCall` 调用链（参考 optional-tweaks 的 `call-timeout` 改法）。

**注意**：录制策略只影响「是否录」，录制文件的下载/回放由控制台+服务端处理，非客户端职责。

---

## 美颜特效 — `relayer`（且比虚拟背景更重）

**能力现状（以官网 Flutter 文档为准）**：
- 官网 Flutter 美颜的**真实路径是 Xmagic 腾讯特效 SDK**：通过 `TRTCVideoFrameListener`
  自定义视频帧回调 + `XmagicApiManager.process(...)` 处理纹理，**不是**调某个一键美颜方法。
- `TUICallEngine.setBeautyLevel(double)` 虽在 SDK 源码里存在，但**官网 Flutter 美颜文档
  完全不使用它**，其在 Flutter 上是否生效未经验证——**不要当作「开箱能用的捷径」推荐**。

**前置（很重）**：
- LiteAVSDK_Professional
- 下载**腾讯特效 SDK（Xmagic）+ MotionRes 素材文件夹**
- 按购买套餐（如 S1-04）添加对应 maven 依赖（美颜是**付费增值**能力）
- Android 需在 AndroidManifest 配置 `libOpenCL.so`

**UIKit 现状**：通话界面无美颜按钮，无注入点。

**应对（relayer 岔路口，且要如实说明「更重」）**：
> Flutter 上的美颜不是一个开关，而是要接入**腾讯特效 Xmagic SDK**：下载特效 SDK +
> 素材文件、按套餐加依赖、自己接管视频帧处理管线，还得脱离 UIKit 通话页把美颜按钮
> 自己做进去。这是**独立 SDK 集成 + 界面重构**级别的工作，而且是付费增值能力。
>
> 你确认要走的话，我给你官网 Xmagic 集成文档的方向；如果只是想要基础通话，UIKit 现状不含美颜。

- 不要承诺 `setBeautyLevel` 能一键美颜。
- 未拿到用户明确确认前，不下场写 Xmagic 集成 / 自建通话页。
- 官网参考：`https://trtc.io/zh/document/59406?product=call&menulabel=uikit&platform=flutter`

---

## 虚拟背景 — `relayer`

**能力现状**：`TUICallEngine.setBlurBackground(int level)` / `setVirtualBackground(String imagePath)` 真 FFI，engine 层可用。UIKit 的 `enableVirtualBackground` 是**占位空实现**（详见 `slices/call/flutter/virtual-background.md`）。

**前置**：控制台购买 `Group Call`（群组通话版）套餐 + 下载与 SDK 版本匹配的模型文件（官网「虚拟背景」页已列明）。

**UIKit 现状**：通话界面无虚拟背景按钮，无注入点。

**应对（relayer 岔路口）**：
> 同美颜——engine 层有 `setBlurBackground`/`setVirtualBackground`，但 UIKit 通话界面没有按钮、加不进去。要用得脱离 UIKit 自建通话页（视频复用 `CallCoreView`，按钮自写），且需控制台开通 Group Call 套餐 + 下载模型文件。这是界面重构级工作。
>
> 详细结论见 `slices/call/flutter/virtual-background.md`。

- 未拿到用户明确确认前不下场写自建页。

---

## 应对总原则

1. **禁止对本手册内的功能直接说「做不了」**。
2. `default-on` → 告知已生效，收手。
3. `stackable` → 走 config→回填→继续，帮用户把参数/开关加到现有集成里。
4. `relayer` → 诚实说清「这是界面重构级、要脱离 UIKit」，拿到明确确认再给方向；skill **不下场代写整套自建通话页**（超出叠加范畴，需专门立项）。
5. 本手册未登记的能力 → 回落「这个能力当前 skill 暂不支持」+ 简述原因（是纯服务端 / 无 Flutter API / 冷门场景）。
