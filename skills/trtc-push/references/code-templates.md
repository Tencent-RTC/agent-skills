# TIMPush 接入代码模板

> Android：阶段 5（Gradle）和阶段 6（Application）的可复制模板。
> **Android 凭据一律走 `local.properties` + `BuildConfig` / `manifestPlaceholders`，
> 不允许字面量出现在 Gradle / Manifest / Application。**
>
> iOS：凭据走 **gitignore 的 `TIMPushCredentials` / 必要时 `ChatCredentials` 源文件**
> + 仓内 `.example`；**禁止**主 `Info.plist` / `timpush.local.xcconfig` 存机密。
> 写 Application / AppDelegate 代码前先读 `timpush-sdk-api.md` 核对包名与类型。

## 阶段 5.1：build.gradle 加载 local.properties + BuildConfig

Groovy DSL：

```groovy
def localProps = new Properties()
def localPropsFile = rootProject.file('local.properties')
if (localPropsFile.exists()) {
    localProps.load(new FileInputStream(localPropsFile))
}

android {
    defaultConfig {
        buildConfigField "String", "TIMPUSH_SDK_APP_ID",
            "\"${localProps.getProperty('TIMPUSH_SDK_APP_ID', '')}\""
        buildConfigField "String", "TIMPUSH_APP_KEY",
            "\"${localProps.getProperty('TIMPUSH_APP_KEY', '')}\""

        manifestPlaceholders = [
            "VIVO_APPKEY": localProps.getProperty('TIMPUSH_VIVO_APP_KEY', ''),
            "VIVO_APPID" : localProps.getProperty('TIMPUSH_VIVO_APP_ID', ''),
            "HONOR_APPID": localProps.getProperty('TIMPUSH_HONOR_APP_ID', '')
        ]
    }
}
```

Kotlin DSL：

```kotlin
import java.util.Properties
import java.io.FileInputStream

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) load(FileInputStream(f))
}

android {
    defaultConfig {
        buildConfigField("String", "TIMPUSH_SDK_APP_ID",
            "\"${localProps.getProperty("TIMPUSH_SDK_APP_ID", "")}\"")
        buildConfigField("String", "TIMPUSH_APP_KEY",
            "\"${localProps.getProperty("TIMPUSH_APP_KEY", "")}\"")

        manifestPlaceholders["VIVO_APPKEY"] = localProps.getProperty("TIMPUSH_VIVO_APP_KEY", "")
        manifestPlaceholders["VIVO_APPID"]  = localProps.getProperty("TIMPUSH_VIVO_APP_ID", "")
        manifestPlaceholders["HONOR_APPID"] = localProps.getProperty("TIMPUSH_HONOR_APP_ID", "")
    }
}
```

确保 `android.buildFeatures.buildConfig = true`（AGP 8+ 默认关闭）。

vivo / 荣耀的 `manifestPlaceholders` 已由这里注入，不要再 hard-code 真值到 build.gradle。

## 阶段 5.2：华为 AGConnect Gradle 插件

选了华为时，除了 `com.tencent.timpush:huawei` 依赖和华为 Maven 仓库，还必须配置
AGConnect Gradle 插件，让 `app/agconnect-services.json` 在构建时被解析。

Kotlin DSL（root `build.gradle.kts`，`buildscript` 风格）：

```kotlin
buildscript {
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://developer.huawei.com/repo/") }
    }
    dependencies {
        classpath("com.huawei.agconnect:agcp:<current-version>")
    }
}
```

Kotlin DSL（app `build.gradle.kts`）：

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

apply(plugin = "com.huawei.agconnect")
```

Groovy DSL（app `build.gradle`）：

```groovy
apply plugin: 'com.huawei.agconnect'
```

完成后跑 `./gradlew :app:assembleDebug`，构建日志必须出现：

```text
Using the AGConnect-Config file: <project>/app/agconnect-services.json
```

如果没有这行，华为通道接入未完成；运行时高概率报
`registerPush failed, errCode=800006, errMsg=Huawei appId missing`。更多华为问题
统一见 `../issues/cards/android/vendor-huawei.md`。

## 阶段 5.3：荣耀 / FCM Gradle 插件

选了荣耀或 FCM 时，也需要按 `fetch_vendor_setup_guide.integration_requirements`
配置对应插件和配置文件：

| 厂商 | 项目级 classpath | 应用级插件 | 配置文件 |
|---|---|---|---|
| 荣耀 | `com.hihonor.mcs:asplugin:2.0.1.300` | `com.hihonor.mcs.asplugin` | `app/mcs-services.json` |
| FCM | `com.google.gms:google-services:4.3.15` | `com.google.gms.google-services` | `app/google-services.json` |

Groovy DSL（项目级 `build.gradle`）：

```groovy
buildscript {
    dependencies {
        classpath 'com.hihonor.mcs:asplugin:2.0.1.300'
        classpath 'com.google.gms:google-services:4.3.15'
    }
}
```

Groovy DSL（app `build.gradle`）：

```groovy
apply plugin: 'com.hihonor.mcs.asplugin'
apply plugin: 'com.google.gms.google-services'
```

Kotlin DSL（项目级 `build.gradle.kts`）：

```kotlin
buildscript {
    dependencies {
        classpath("com.hihonor.mcs:asplugin:2.0.1.300")
        classpath("com.google.gms:google-services:4.3.15")
    }
}
```

Kotlin DSL（app `build.gradle.kts`）：

```kotlin
plugins {
    id("com.hihonor.mcs.asplugin")
    id("com.google.gms.google-services")
}
```

只添加 selected vendors 需要的插件；未接入荣耀或 FCM 时不要无差别添加。

## 阶段 6：Application 类 registerPush

> `TIMPushCallback` 是带泛型的 **abstract class**（不是 interface）；
> 包名是 `com.tencent.qcloud.tim.push.*`（不是 `com.tencent.timpush.*`）。

Java：

```java
import com.tencent.qcloud.tim.push.TIMPushCallback;
import com.tencent.qcloud.tim.push.TIMPushManager;

private void registerTIMPush() {
    int sdkAppId = Integer.parseInt(BuildConfig.TIMPUSH_SDK_APP_ID);
    String appKey = BuildConfig.TIMPUSH_APP_KEY;
    TIMPushManager.getInstance().registerPush(
        this,
        sdkAppId,
        appKey,
        new TIMPushCallback<Object>() {
            @Override public void onSuccess(Object data) {
                Log.d("TIMPush", "registerPush success, data=" + data);
                // 控制台接入测试需要 registrationID；SDK 不会默认打印，必须主动取并打日志。
                TIMPushManager.getInstance().getRegistrationID(new TIMPushCallback<Object>() {
                    @Override public void onSuccess(Object regId) {
                        Log.i("TIMPush", "registrationID=" + regId);
                    }
                    @Override public void onError(int errCode, String errMsg, Object d) {
                        Log.e("TIMPush", "getRegistrationID failed, errCode=" + errCode + ", errMsg=" + errMsg);
                    }
                });
            }
            @Override public void onError(int errCode, String errMsg, Object data) {
                Log.e("TIMPush", "registerPush failed, errCode=" + errCode + ", errMsg=" + errMsg);
            }
        }
    );
}
```

Kotlin：

```kotlin
import com.tencent.qcloud.tim.push.TIMPushCallback
import com.tencent.qcloud.tim.push.TIMPushManager

private fun registerTIMPush() {
    val sdkAppId = BuildConfig.TIMPUSH_SDK_APP_ID.toIntOrNull() ?: 0
    val appKey = BuildConfig.TIMPUSH_APP_KEY
    if (sdkAppId == 0 || appKey.isEmpty()) {
        Log.e("TIMPush", "credentials missing in local.properties")
        return
    }
    TIMPushManager.getInstance().registerPush(
        this,
        sdkAppId,
        appKey,
        object : TIMPushCallback<Any>() {
            override fun onSuccess(data: Any?) {
                Log.d("TIMPush", "registerPush success, data=$data")
                // 控制台接入测试需要 registrationID；SDK 不会默认打印，必须主动取并打日志。
                TIMPushManager.getInstance().getRegistrationID(object : TIMPushCallback<Any>() {
                    override fun onSuccess(regId: Any?) {
                        Log.i("TIMPush", "registrationID=$regId")
                    }
                    override fun onError(errCode: Int, errMsg: String?, d: Any?) {
                        Log.e("TIMPush", "getRegistrationID failed, errCode=$errCode, errMsg=$errMsg")
                    }
                })
            }
            override fun onError(errCode: Int, errMsg: String?, data: Any?) {
                Log.e("TIMPush", "registerPush failed, errCode=$errCode, errMsg=$errMsg")
            }
        }
    )
}
```

写完 Application 类后**必须本地跑一次 `./gradlew :app:compileDebugKotlin`
（或 `:compileDebugJavaWithJavac`）验证编译通过**；SDK 包名/类型搞错时 IDE 静态
检查可能不标红，只有真编译会爆 `Unresolved reference`。

**必须**在 `registerPush` 成功回调里再调 `getRegistrationID`，并打印固定关键字
`registrationID=`。后续控制台接入测试 / 排查都依赖用户能从 logcat 立刻复制该值；
SDK 不会默认打出 registrationID。

---

## iOS：TIMPushCredentials（Push 凭据）

> 真值文件 `TIMPushCredentials.swift` → `.gitignore`。  
> 仓内提交 `TIMPushCredentials.example.swift`（占位）。  
> **禁止**写入主 `Info.plist` / `timpush.local.xcconfig`。

Swift example（提交此文件）：

```swift
enum TIMPushCredentials {
    /// 与 Chat 共用的 SDKAppID
    static let sdkAppID: Int = 0 // YOUR_SDKAPPID
    /// 推送服务 Push 控制台「客户端密钥」；im_chat 场景 registerPush 可忽略
    static let appKey: String = "YOUR_PUSH_APP_KEY"
    /// 腾讯云 APNs 证书 ID（businessID）
    static let businessID: Int = 0 // YOUR_BUSINESS_ID
}
```

真值文件：结构相同，填入真实数字/字符串；文件名去掉 `.example`，并加入 `.gitignore`：

```gitignore
TIMPushCredentials.swift
TIMPushCredentials.m
ChatCredentials.swift
ChatCredentials.m
```

把 `TIMPushCredentials.swift` 加入 App target → Compile Sources。

ObjC 等价：`TIMPushCredentials.h` 声明常量 / `TIMPushCredentials.m` 定义；example 用
`TIMPushCredentials.example.m`（或成对 example 头尾）。

## iOS：ChatCredentials（仅当工程尚无 Chat 凭据）

若 detect 已发现任意既有 Chat 凭据路径 → **不要创建本文件，不要改用户文件**。

仅当 `im_chat` / `mixed` 且工程内无 Chat 凭据时新建：

```swift
enum ChatCredentials {
    static let sdkAppID: Int = 0 // YOUR_SDKAPPID
    static let secretKey: String = "YOUR_CHAT_SECRET_KEY"
}
```

同样：`.example` 进仓，真值文件 gitignore。

## iOS：AppDelegate 读取 Credentials

```swift
import TIMPush

// TIMPushListener / Delegate 中：
@objc func businessID() -> Int32 {
    Int32(TIMPushCredentials.businessID)
}

// standalone_push:
TIMPushManager.registerPush(
    Int32(TIMPushCredentials.sdkAppID),
    appKey: TIMPushCredentials.appKey,
    succ: { deviceToken in
        print(">>>>> TIMPush registerPush success deviceToken=\(deviceToken)")
        TIMPushManager.getRegistrationID { regId in
            print(">>>>> TIMPush registrationID=\(regId ?? "")")
        }
    },
    fail: { code, desc in
        print("registerPush failed code=\(code) desc=\(desc ?? "")")
    }
)

// im_chat / mixed：在 IM login 成功后，appKey 传 nil / ""
TIMPushManager.registerPush(
    Int32(TIMPushCredentials.sdkAppID),
    appKey: nil,
    succ: { deviceToken in
        print(">>>>> TIMPush registerPush success deviceToken=\(deviceToken)")
        TIMPushManager.getRegistrationID { regId in
            print(">>>>> TIMPush registrationID=\(regId ?? "")")
        }
    },
    fail: { code, desc in
        print("registerPush failed code=\(code) desc=\(desc ?? "")")
    }
)
```

> 以上 `registerPush` / `getRegistrationID` 签名以工程内 TIMPush 头文件与
> `timpush-sdk-api.md` 为准；模板侧重**凭据读取位置**，不要把真值写进 AppDelegate。
> 检索日志请过滤 `>>>>> TIMPush`；SDK 默认不一定打印无前缀的 `registerPush success`。

### XcodeGen：Push entitlements（防 code=3000）

```yaml
# project.yml — target 下
entitlements:
  path: PushDemo/PushDemo.entitlements
  properties:
    aps-environment: development
settings:
  base:
    PRODUCT_BUNDLE_IDENTIFIER: com.your.real.bundleid
    DEVELOPMENT_TEAM: YOURTEAMID
```

仅写 `entitlements.path`、不写 `properties` 时，`xcodegen generate` 可能把
entitlements 文件覆写成空 `<dict/>`，真机 registerPush 报 code=3000。

---

## Flutter：`lib/tim_push_credentials.dart`

```dart
/// EXAMPLE — commit as tim_push_credentials.example.dart
class TimPushCredentials {
  static const int sdkAppId = 0; // YOUR_SDKAPPID
  static const String appKey = 'YOUR_PUSH_APP_KEY';
  static const int apnsCertificateID = 0; // YOUR_BUSINESS_ID
}
```

真值文件同结构，加入 `.gitignore`：`lib/tim_push_credentials.dart`。  
registerPush 从该类读取；Android 厂商密钥仍走 `android/local.properties`。

## UniApp：`push_credentials.js`

```js
// EXAMPLE — commit as push_credentials.example.js
export const sdkAppId = 0 // YOUR_SDKAPPID
export const appKey = 'YOUR_PUSH_APP_KEY'
```

真值文件 gitignore：`push_credentials.js`。  
iOS `businessID` 仍写 `nativeResources/ios/Resources/timpush-configs.json`（官方路径，不是 AppKey）。
