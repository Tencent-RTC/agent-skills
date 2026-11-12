# 鸿蒙 Chat 空白工程最小可编译模板

适用：客户工程没有任何 TUIKit 源码或依赖（例如 DevEco “Empty Ability” 模板）。本模板基于公开上游 `Tencent-RTC/TUIKit_Harmony`，以上游 `main@e2551ed`（2026-11-03）为参考基线，在 DevEco 6.0.1 / `compatibleSdkVersion` 15 与 17 下用 `ohpm install` + `hvigor assembleHap` 实测编译通过；上游更新后若编译失败，先对照该提交的差异定位，再按[排障](troubleshooting.md)处理。仍需按[入口审批](../SKILL.md#结构化提问与等待所有业务文件共用)先给文件级方案并取得授权再写入；客户工程已有登录、导航、窗口或依赖时以客户现状为准，只取需要的片段。签名、上机运行和真实账号收发由客户验证。

## 1. 获取源码

- 官方仓库：GitHub `https://github.com/Tencent-RTC/TUIKit_Harmony.git`，国内镜像 CNB `https://cnb.cool/tencent/cloud/trtc/TUIKit_Harmony`；官方手动集成文档：`https://cloud.tencent.com/document/product/269/125128`。
- 方案前允许只读核对：`git ls-remote --symref <仓库> HEAD` 取默认分支和提交，再 `git clone --depth 1` 到**客户工程外的系统临时目录**阅读 `oh-package.json5`、`Index.ets` 和 Demo，不写入客户工程。
- 授权后只复制 3 个模块到客户工程内的新目录（示例 `tuikit/`），**保持相对层级**：`chat/uikit/oh-package.json5` 以 `file:../../atomic_x/` 引用 AtomicX，层级被打乱会解析失败。不要复制 `.git`、`oh_modules`、`build`、`.hvigor`。同时新建 `tuikit/UPSTREAM.md`，写明上游仓库地址、提交号、拉取日期和复制的模块，供后续[版本核对](integration.md#本地-tuikit-harmony-源码版本核对)作为可信记录。

```text
<project>/
├── entry/
└── tuikit/
    ├── UPSTREAM.md        # 上游地址、提交号、日期
    ├── atomic_x/          # @tencentcloud/atomicx
    ├── call/              # @tencentcloud/tuicallkit
    └── chat/uikit/        # chatuikit
```

纳入客户版本库：`tuikit/`（含被 ohpm 改写的各模块 `oh-package-lock.json5`）和 `entry/oh-package-lock.json5`；不纳入 `oh_modules/`、`build/`、`.hvigor/` 与构建日志。

`@tencentcloud/atomicxcore`、`@tencentcloud/imsdk` 等由 ohpm 中心仓库安装，**不是**本地模块；上游没有 `call_v2` 或 `client_uikit` 目录。

## 2. 工程配置

`build-profile.json5` 的 `modules` 追加：

```json5
{ "name": "atomic_x", "srcPath": "./tuikit/atomic_x", "targets": [ { "name": "default", "applyToProducts": [ "default" ] } ] },
{ "name": "chatuikit", "srcPath": "./tuikit/chat/uikit" },
{ "name": "tuicallkit", "srcPath": "./tuikit/call" }
```

`compatibleSdkVersion` 沿用客户现值；官方文档要求 API 15 及以上（`5.0.3(15)`），低于此值先与客户确认。

`entry/oh-package.json5` 的 `dependencies`：

```json5
"@tencent/mmkv": "1.3.5",
"@tencentcloud/atomicxcore": "^5.1.0",
"@tencentcloud/atomicx": "file:../tuikit/atomic_x",
"chatuikit": "file:../tuikit/chat/uikit",
"@tencentcloud/tuicallkit": "file:../tuikit/call"
```

版本以复制下来的 `tuikit/atomic_x/oh-package.json5` 实际声明为准。`ohpm install --all` 会提示 `@tencentcloud/imsdk` 版本冲突并自动解析为较高版本，属于预期；它还会改写 `tuikit/` 下各模块的 `oh-package-lock.json5`。

`entry/src/main/module.json5` 的 `requestPermissions` 只需：

```json5
{ "name": "ohos.permission.INTERNET" },
{ "name": "ohos.permission.GET_NETWORK_INFO" }
```

CallKit/AtomicX 的 HAR 在编译时会自动合并 `CAMERA`、`MICROPHONE`、`KEEP_BACKGROUND_RUNNING`、`MODIFY_AUDIO_SETTINGS`、`VIBRATE`（可在 `entry/build/default/intermediates/res/default/module.json` 核对），宿主不要重复声明；需要自定义 `reason` 时再在宿主覆盖。运行时授权由组件在使用时申请。

`entry/src/main/resources/base/profile/main_pages.json` 注册新增页面，例如 `"pages/Index", "pages/HomePage"`。

## 3. EntryAbility

在模板已有生命周期中补齐 4 处：`onCreate` 初始化 MMKV 与 `ContextProvider`；`loadContent` 成功回调里 `attach`；`onWindowStageDestroy` 里 `detach`；`onConfigurationUpdate` 同步深浅色/语言。

```ts
import { AbilityConstant, Configuration, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { MMKV } from '@tencent/mmkv';
import { ContextProvider } from '@tencentcloud/atomicx/src/main/ets/basecomponent/Index';
import { TUICallKit } from '@tencentcloud/tuicallkit';

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    MMKV.initialize(this.context.getApplicationContext());
    ContextProvider.init(this.context);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'Chat', 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      try {
        TUICallKit.createInstance(this.context).attach(windowStage);
      } catch (e) {
        hilog.error(DOMAIN, 'Chat', 'TUICallKit.attach failed: %{public}s', JSON.stringify(e));
      }
    });
  }

  onWindowStageDestroy(): void {
    try {
      TUICallKit.createInstance(this.context).detach();
    } catch (e) {
      hilog.warn(DOMAIN, 'Chat', 'TUICallKit.detach failed: %{public}s', JSON.stringify(e));
    }
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    ContextProvider.onConfigurationUpdate(newConfig);
  }
}
```

## 4. 登录

客户没有业务登录时，可在文件级方案中默认采用运行时输入 SDKAppID / UserID / UserSig 的登录页，并在方案里写明“如需对接已有业务登录请选调整方案”，不必为此单独多问一轮；UserSig 由客户服务端为该 UserID 签发，不在客户端计算或保存 SecretKey。Promise 失败值是 `@tencentcloud/atomicxcore` 的 `ErrorInfo extends Error { code?: number }`，需保留真实错误码，不要照抄 Demo 把错误码固定为 `0`。

```ts
import { router } from '@kit.ArkUI';
import { ErrorInfo, LoginStore } from '@tencentcloud/atomicxcore';

@Entry
@Component
struct Index {
  @State sdkAppIdText: string = '';
  @State userId: string = '';
  @State userSig: string = '';
  @State loggingIn: boolean = false;
  @State errorText: string = '';

  private describeError(reason: Object): string {
    if (reason instanceof ErrorInfo) {
      return `code=${reason.code ?? -1}, message=${reason.message}`;
    }
    return reason instanceof Error ? reason.message : String(reason);
  }

  private doLogin(): void {
    const sdkAppId: number = Number(this.sdkAppIdText.trim());
    const userId: string = this.userId.trim();
    const userSig: string = this.userSig.trim();
    if (this.loggingIn) {
      return;
    }
    if (!Number.isInteger(sdkAppId) || sdkAppId <= 0 || userId.length === 0 || userSig.length === 0) {
      this.errorText = 'SDKAppID 须为正整数，UserID 与 UserSig 不能为空';
      return;
    }
    this.errorText = '';
    this.loggingIn = true;
    LoginStore.shared().login(sdkAppId, userId, userSig, getContext(this))
      .then(() => {
        this.loggingIn = false;
        router.replaceUrl({ url: 'pages/HomePage' });
      })
      .catch((reason: Object) => {
        this.loggingIn = false;
        this.errorText = `登录失败：${this.describeError(reason)}`;
      });
  }

  build() {
    Column({ space: 16 }) {
      TextInput({ placeholder: 'SDKAppID', text: this.sdkAppIdText })
        .type(InputType.Number)
        .onChange((value: string) => { this.sdkAppIdText = value; })
      TextInput({ placeholder: 'UserID', text: this.userId })
        .onChange((value: string) => { this.userId = value; })
      TextInput({ placeholder: 'UserSig（由业务服务端签发）', text: this.userSig })
        .type(InputType.Password)
        .onChange((value: string) => { this.userSig = value; })
      if (this.errorText.length > 0) {
        Text(this.errorText).fontColor(Color.Red).width('100%')
      }
      Button(this.loggingIn ? '登录中…' : '登录')
        .width('100%')
        .enabled(!this.loggingIn)
        .onClick(() => { this.doLogin(); })
    }
    .width('100%')
    .height('100%')
    .padding({ left: 24, right: 24, top: 48 })
  }
}
```

## 5. 会话列表、聊天页与通话事件桥

`ChatDialog` 是 `@CustomDialog`，由宿主创建 `CustomDialogController` 并 `open()`；点击已有会话直接传 `ConversationInfo.conversationID` 原值。AtomicX 与 CallKit 都有 `CallMediaType`，需给 CallKit 的类型起别名。`.calls(...)` 返回 Promise，失败要提示用户；CallKit 也会在内部拦截部分失败，不能把“Promise 未 reject”当作通话成功。

```ts
import { common } from '@kit.AbilityKit';
import { ImmersiveMode, LevelMode, promptAction, router } from '@kit.ArkUI';
import { ConversationsPage, ChatDialog } from 'chatuikit';
import { ConversationInfo, LoginEvent, LoginStore } from '@tencentcloud/atomicxcore';
import { TUIEventBus, TUIObserver, NotifyParams } from '@tencentcloud/atomicx/src/main/ets/basecomponent/Index';
import { CallMediaType } from '@tencentcloud/atomicx/src/main/ets/call/common/CallStore';
import { TUICallKit, CallMediaType as CallKitMediaType, CallParams as CallKitParams } from '@tencentcloud/tuicallkit';

const CALL_START_EVENT: string = 'call.startCall';

class CallStartObserver implements TUIObserver {
  private context: common.Context;

  constructor(context: common.Context) {
    this.context = context;
  }

  onNotify(event: string, _key: string | null, params: NotifyParams | null): void {
    if (event !== CALL_START_EVENT || !params?.data) {
      return;
    }
    const data = params.data;
    const participantIds: string[] = (data['participantIds'] as string[]) ?? [];
    if (participantIds.length === 0) {
      return;
    }
    const mediaType: CallMediaType = (data['mediaType'] as CallMediaType) ?? CallMediaType.audio;
    const callKitMediaType: CallKitMediaType =
      mediaType === CallMediaType.video ? CallKitMediaType.video : CallKitMediaType.audio;
    const chatGroupId: string = (data['chatGroupId'] as string) ?? '';
    const timeout: number = (data['timeout'] as number) ?? 30;
    let callParams: CallKitParams | undefined = undefined;
    if (chatGroupId.length > 0) {
      callParams = new CallKitParams('', timeout, '', chatGroupId);
    }
    TUICallKit.createInstance(this.context).calls(participantIds, callKitMediaType, callParams)
      .catch((reason: Object) => {
        const desc: string = reason instanceof Error ? reason.message : String(reason);
        promptAction.showToast({ message: `发起通话失败：${desc}` });
      });
  }
}

@Entry
@Component
struct HomePage {
  private chatDialogController?: CustomDialogController;
  private callEventObserver?: TUIObserver;
  private unsubscribeLoginEvent?: () => void;

  aboutToAppear(): void {
    const context: common.Context = getContext(this);
    TUICallKit.createInstance(context);
    this.callEventObserver = new CallStartObserver(context);
    TUIEventBus.getInstance().subscribe(CALL_START_EVENT, null, this.callEventObserver);
    this.unsubscribeLoginEvent = LoginStore.shared().loginEventEmitter.subscribe(this, (event: LoginEvent) => {
      if (event === LoginEvent.KICKED_OFFLINE || event === LoginEvent.LOGIN_EXPIRED) {
        this.closeChatDialog();
        router.replaceUrl({ url: 'pages/Index' });
      }
    });
  }

  aboutToDisappear(): void {
    if (this.callEventObserver) {
      TUIEventBus.getInstance().unsubscribe(CALL_START_EVENT, null, this.callEventObserver);
      this.callEventObserver = undefined;
    }
    if (this.unsubscribeLoginEvent) {
      this.unsubscribeLoginEvent();
      this.unsubscribeLoginEvent = undefined;
    }
    this.closeChatDialog();
  }

  private closeChatDialog(): void {
    if (this.chatDialogController) {
      this.chatDialogController.close();
      this.chatDialogController = undefined;
    }
  }

  private openChat(item: ConversationInfo): void {
    const conversationID: string = item.conversationID ?? '';
    if (conversationID.length === 0) {
      return;
    }
    this.closeChatDialog();
    this.chatDialogController = new CustomDialogController({
      builder: ChatDialog({
        conversationID: conversationID,
        title: item.title || conversationID,
        avatarUrl: item.avatarURL || '',
        status: '',
        onBack: () => { this.chatDialogController = undefined; }
      }),
      autoCancel: false,
      alignment: DialogAlignment.Center,
      customStyle: true,
      keyboardAvoidMode: KeyboardAvoidMode.NONE,
      maskColor: 'rgba(0, 0, 0, 0)',
      cancel: () => { this.chatDialogController = undefined; },
      levelMode: LevelMode.EMBEDDED,
      immersiveMode: ImmersiveMode.EXTEND
    });
    this.chatDialogController.open();
  }

  build() {
    Column() {
      ConversationsPage({
        onConversationClick: (item: ConversationInfo) => { this.openChat(item); }
      })
    }
    .width('100%')
    .height('100%')
  }
}
```

`router.replaceUrl`、`getContext`、`promptAction.showToast` 在较新 API 下会有 deprecated 告警，不影响编译；客户工程已用 `Navigation` / `UIContext` 时改用其等价写法。联系人页、设置页按[集成](integration.md#登录页面与会话)的 `ContactsPage` 参数追加。

## 6. 构建

依次尝试：工程自带 `hvigorw`；DevEco Studio 的 Build HAP；DevEco 自带 hvigor（macOS 示例，路径按客户安装位置调整）：

```sh
T=/Applications/DevEco-Studio.app/Contents/tools
export PATH="$T/node/bin:$T/ohpm/bin:$PATH" DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
ohpm install --all
LOG="${TMPDIR:-/tmp}/ohos-chat-build.log"
node "$T/hvigor/bin/hvigorw.js" --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon > "$LOG" 2>&1
grep -E "BUILD (SUCCESSFUL|FAILED)" "$LOG"
```

构建日志写到工程外，避免污染客户版本库。

首次编译 3–6 分钟，日志重定向到文件后再筛选第一处 `ERROR`。`atomic_x` 自身的 ArkTS `WARN` 属于上游现状，不需要修改。产物为 `entry/build/default/outputs/default/entry-default-unsigned.hap`；未配置签名时 hvigor 会跳过签名，安装到设备需客户在 DevEco 中配置自动签名。

## 7. 交付与客户验证

交付时说明：已编译、未签名、未上机。请客户在 DevEco 配置签名后运行，验证登录成功与失败提示、会话列表、点击进入正确会话、双方文本收发、单聊/群聊发起语音和视频通话（需在控制台开通音视频服务）、返回与键盘弹收、深浅色切换。最小链路完成后按[入口](../SKILL.md#主动推进与交付)只问一次是否准备测试账号和消息。
