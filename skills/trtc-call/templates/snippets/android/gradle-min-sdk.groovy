// 拼进 android/app/build.gradle 的 android { defaultConfig { ... } } 内：
// - minSdkVersion 若已 ≥ 21 则不改；< 21 则改为 21
// - multiDexEnabled 若已存在则保持；不存在则补 true

minSdkVersion 21
multiDexEnabled true
