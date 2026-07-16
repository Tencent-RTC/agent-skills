# TIMPush 9.x SDK API 坐标

> 写 Application / registerPush 代码**前必须先读本文件**。这是 PushDemo 首次接入
> 翻车的根因所在（把 Maven groupId 当成 Java 包名）。

**`com.tencent.timpush` 是 Maven groupId，不是 Java 包名。** 把 groupId 当成
Java 包名 `import` 会直接 `Unresolved reference`。

| 项 | 真实值 |
|---|---|
| Maven groupId | `com.tencent.timpush` |
| 核心 artifact | `com.tencent.timpush:timpush:<version>` |
| 厂商 artifact | `com.tencent.timpush:huawei` / `xiaomi` / `oppo` / `vivo` / `honor` / `meizu` / `fcm` |
| **Java/Kotlin 包名** | **`com.tencent.qcloud.tim.push`** |
| Manager 类 | `com.tencent.qcloud.tim.push.TIMPushManager`（abstract，`getInstance()` 拿单例） |
| Callback 类 | `com.tencent.qcloud.tim.push.TIMPushCallback<T>`（**abstract class + 泛型，不是 interface**） |
| Listener 类 | `com.tencent.qcloud.tim.push.TIMPushListener`（abstract class，方法都是空实现） |
| Message 类 | `com.tencent.qcloud.tim.push.TIMPushMessage` |

`TIMPushManager` 关键方法签名（从 9.0.7652 反编译，跨小版本基本稳定）：

```java
public static TIMPushManager getInstance();
public abstract void registerPush(Context, int sdkAppId, String appKey, TIMPushCallback callback);
public abstract void unRegisterPush(TIMPushCallback callback);
public abstract void getRegistrationID(TIMPushCallback callback);
public abstract void setRegistrationID(String regId, TIMPushCallback callback);
public abstract void addPushListener(TIMPushListener listener);
public abstract void removePushListener(TIMPushListener listener);
public abstract void forceUseFCMPushChannel(boolean enable);
public abstract void disablePostNotificationInForeground(boolean disable);
```

`TIMPushCallback<T>` 签名：

```java
public void onSuccess(T data);                           // 默认空实现
public void onError(int errCode, String errMsg, T data); // 默认空实现
```

> **Kotlin 实例化**：`object : TIMPushCallback<Any>() { ... }`（带括号；是抽象类不是接口；泛型不能省）。
> **Java 实例化**：`new TIMPushCallback<Object>() { ... }`（泛型不能省，否则触发 raw type 警告或在严格设置下编译失败）。

`TIMPushListener` 三个回调（abstract class，按需 override）：

```java
public void onRecvPushMessage(TIMPushMessage message);  // 透传消息到达
public void onRevokePushMessage(String messageID);      // 消息被撤回
public void onNotificationClicked(String ext);          // 用户点击通知，ext 是自定义参数
```

`TIMPushMessage` 字段：`title` / `desc` / `ext` / `messageID`（均有 getter/setter）。

`TIMPushOpenActivity` 是 SDK 自带的点击中转 Activity：点击通知 → 先经过它 →
拉起 launcher Activity（冷启动场景）+ 触发 `onNotificationClicked(ext)` → finish。
业务侧**不要**在 listener 里自己 `startActivity` 跳目标页（会和 SDK 拉起的
launcher 重复），正确做法是 listener 只发事件、UI 层订阅后再跳。

## SDK 升级后如何复核签名

如果 SDK 升级后 `TIMPushManager` 签名变了，先反编译核对当前 aar，再写代码：

```bash
# 找到 aar
find ~/.gradle/caches/modules-2/files-2.1/com.tencent.timpush/timpush -name '*.aar'
# 解压
unzip <path-to-aar> -d /tmp/timpush-extract
# javap 看签名（mac 自带 javap 无 JDK 时不可用，需手动指向 JDK 17）
/Library/Java/JavaVirtualMachines/jdk-17.0.2.jdk/Contents/Home/bin/javap \
  -classpath /tmp/timpush-extract/classes.jar \
  com.tencent.qcloud.tim.push.TIMPushManager
```
