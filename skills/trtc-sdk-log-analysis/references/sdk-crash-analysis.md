# SDK Native Crash 分析指南（TRTC / IM 通用）

> 客户提供 crash 堆栈/dump 时的分析方法论。TRTC 与 IM SDK 底层都是 C++ + JNI/OC 桥接，方法通用。
> 本文只覆盖"日志分析之外的 crash 物料处理"；crash 前的 SDK 日志仍按各平台模式文档分析。

## TL;DR

5 步处理客户提交的 native crash：

1. **物料完备性检查**：SDK 版本号 + CPU 架构 + 完整堆栈（带偏移地址或函数名）
2. **判定是否 SDK 的 crash**：堆栈中**首个 SDK 库帧**才是分析重点；纯系统库栈顶 → 大概率系统层 bug
3. **取对应版本带符号表的库**（symbols / release framework + dSYM / dll + pdb）
4. **平台对应符号化**：Android 优先 addr2line（最快）；iOS / Windows 用 IDA
5. **IDA 定位行号**：函数起始地址 + 偏移量计算跳转地址，按 G 跳转，F5 反编译

---

## 一、物料完备性 Checklist

| 字段 | 例子 | 缺失影响 |
|------|------|---------|
| **SDK 版本号** | TRTC 12.8 / ImSDK 5.1.60 | 取不到对应符号，无法符号化 |
| **CPU 架构** | armeabi-v7a / arm64-v8a / x86_64 | 用错架构得到完全错误的地址映射 |
| **完整堆栈** | 含偏移地址或函数名 | 单内存地址无法定位 |
| **崩溃时间点/频率** | 进房后 5 秒 / 10 次 1 次 | 影响复现与优先级 |
| **平台与系统版本** | Android 12 / iOS 14.5 / Win10 | 系统 bug 类 crash 强相关 |
| **崩溃类型** | SIGABRT / EXC_BAD_ACCESS / 0xC0000005 | 决定第一阶段判定方向 |

> Windows 平台客户只给 .dmp 文件也可以——用 WinDbg 提取偏移地址（见 §四）。

---

## 二、判定是否真的是 SDK 的 crash

**关键原则**：堆栈最上面**首个 SDK 库地址**才是分析起点。

### 纯系统层 crash 的典型形态

```
SIGABRT:
#00 pc 00049f38 /system/lib/libc.so (tgkill+12)
#01 pc 000476b3 /system/lib/libc.so (pthread_kill+34)
...
#10 pc 001fde7f /data/app/.../lib/arm/libImSDK.so   ← 第一个 SDK 帧，从这里开始分析
```

往下是系统/虚拟机的 abort 流程，**不是 SDK 的 bug**。

### 系统层 crash 实例（可直接回复客户）

**低版本 Android OkHttp SSL crash**：

```
#03 com.android.org.conscrypt.OpenSSLSocketImpl.startHandshake
#04 com.android.okhttp.Connection.upgradeToTls
...
#13 com.tencent.imsdk.looper.HttpClient$3.run
```

> SDK 使用标准 `HttpURLConnection`，但 Android 系统层用 okhttp 实现，低版本 okhttp 有已知 bug（okhttp issue #5286）崩在系统层。
> **回复模板**：该 crash 是 Android 系统层 OkHttp 实现的已知 bug，主要发生在低版本 Android 机型，SDK 无法控制。建议：① 升级 Android 版本；② 应用层做 retry 容错。

### 已知 SDK 侧案例：`std::random_device` 构造 crash

- **根因**：`random_device` 构造时 `fopen("/dev/urandom")` 读随机源；fopen 失败抛 C++ 异常，老版本 SDK 未 try-catch → crash
- **fopen 失败最可能原因**：进程**文件句柄达到上限**（句柄泄漏）
- 各平台默认句柄上限：Windows 512 / Linux & Android 1024 / Mac & iOS 10240
- **回复模板**：该 crash 通常对应进程文件句柄达上限，常见于业务侧文件/socket 未正确关闭。建议用 lsof / `getrlimit` 实测句柄数并排查泄漏；SDK 后续版本会加 try-catch 兜底。

---

## 三、Android：addr2line（推荐，最快）

```bash
# 32 位
arm-linux-androideabi-addr2line -e ~/symbols/libImSDK.so -s -f -C 00205375
# 输出：ScopedJString / jni_helper.cpp:131

# 64 位
aarch64-linux-android-addr2line -e ~/symbols/arm64-v8a/libImSDK.so -s -f -C <address>
```

所需物料：Android NDK + 对应版本带符号表的 SDK 库（**注意区分平台/架构**）。

addr2line 失效或需看汇编上下文时改用 IDA：打开 symbols 库 → 按 **G** 输入崩溃地址 → 按 **F5** 反编译。

---

## 四、iOS Crash

1. 从 .crash 文件找 `Crashed:` 标记的崩溃线程，取该线程堆栈中**首个 SDK 库地址**
2. 偏移地址转十六进制（bugly 上可能是十进制）
3. IDA 打开对应版本的 release framework（自带符号）→ 按 G 跳转 → 逐个地址向上查看

**客户只给内存地址（无函数名）时**：

- 堆栈有部分函数名（如 `imcore::Conversation`）→ IDA **Function Window** 搜索该函数名，双击候选比对
- 堆栈是 mangled C++ 名（`__ZNSt3__1...`）→ 复制后**前面补一个下划线**（`___ZN...`）→ IDA View-A 按 G 搜索

---

## 五、Windows Crash

物料：.dmp 文件（或偏移地址）+ 对应版本 **release dll + pdb**（pdb 必不可少）。

1. **WinDbg 提取偏移**（只有 .dmp 时）：
   ```
   0:000> .open <path>.dmp
   0:000> !analyze -v
   ```
   输出含 `FAULTING_IP` 等偏移地址。

2. **关键转换公式**：
   ```
   IDA 地址 = 0x10000000 + 偏移地址
   ```

3. **IDA 打开 dll + pdb**（同目录放置），选项选 `Portable`，后续按 G 跳转 + F5 反编译。

---

## 六、IDA 通用 Tips

| 快捷键 | 作用 |
|--------|------|
| **Ctrl+F** | 搜索函数（函数列表中） |
| **G** | 跳转到指定地址 |
| **F5** | 反编译当前函数为伪 C 代码 |
| **TAB** | 函数调用列表 ↔ 地址列表切换 |
| **Esc** | 回到上一次操作 |
| **空格** | 地址视图 ↔ 代码视图切换 |
| **Ctrl+X** | 显示当前函数的调用方 |

注意：
- 32 位的库用 32 位 IDA 打开（架构匹配）
- Ctrl+F 用的是 Ctrl 不是 Command（Mac 用户易踩坑）
- 加载库时按堆栈选择正确 CPU 架构

---

## 七、IDA 定位行号实战（偏移量计算）

示例：客户提供 平台 iOS arm64 / 函数 `imcore::SqliteStore::ReadFriendProfile` / 偏移量 +64：

1. 解压对应版本 SDK → 拖入 IDA，选 ARM64
2. 函数列表 Ctrl+F 搜 `ReadFriendProfile`（同名函数按参数类型甄别）
3. 看函数起始地址，如 `0x000000000011D4DC`
4. 计算崩溃地址：`0x11D4DC + 0x40 = 0x11D51C`（偏移量 64 = 十六进制 0x40）
5. 按 G 输入 `0x11D51C` 跳转 → 按 F5 反编译 → 光标位置即 crash 位置
6. 结合源码 + 寄存器推导具体行号

> ⚠️ IDA 反编译行号不一定等于源码行号，需结合上下文精确定位。

---

## 八、客户问题快查表

| 客户描述 | 优先动作 | 章节 |
|---------|---------|------|
| "SDK 崩了"（无细节） | 索要版本+架构+完整堆栈+系统版本 | §一 |
| "崩在 libc.so / libart.so / OpenSSLSocketImpl" | 系统层 crash，回复模板 | §二 |
| "只有 .dmp 文件" | WinDbg `!analyze -v` | §五 |
| "iOS bugly 只显示内存地址" | IDA Function Window 搜 mangled 名 | §四 |
| "Android crash 最快定位" | addr2line 一行命令 | §三 |
| "随机偶发 crash 在 random_device" | 句柄泄漏，让客户 lsof 实测 | §二 |
