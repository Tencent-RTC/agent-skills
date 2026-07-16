# iOS：No such module 'TIMPush'（XcodeGen 清掉 CocoaPods 脚本）

## 适用现象

当用户反馈以下任一现象时，优先使用本卡：

- `No such module 'TIMPush'`
- `Unable to find module dependency: 'TIMPush'`
- AppDelegate `import TIMPush` 编译失败，但 `Podfile` 已有 `pod 'TIMPush'`
- 刚执行过 `xcodegen generate` 或工程存在 `project.yml` / `project.yaml`

不适用于：

- Podfile 根本没有 TIMPush、从未 `pod install`。先走正常接入 / `wizard-ios` stage-6。
- SPM / 手动拖 framework 集成路径（本卡默认 CocoaPods）。

## 共同根因

CocoaPods 会把 `[CP] Check Pods Manifest.lock`、`[CP] Embed Pods Frameworks`、
`Pods-*.xcconfig` 等写入 `project.pbxproj`。`xcodegen generate` 按 `project.yml`
重写 pbxproj，会清掉这些脚本。结果是：

- `Pods/`、`Podfile.lock` 仍在
- Podfile 里仍有 TIMPush
- 但 Xcode 工程不再链接 Pods → `import TIMPush` 报 No such module

## 必须收集的证据

- 是否存在 `project.yml` / `project.yaml`
- `detect_ios_project` 返回的 `uses_xcodegen`、`cocoapods_integration_broken`、
  `cocoapods_pbxproj_integrated`、`warnings`
- `project.pbxproj` 是否还能搜到 `[CP] Check Pods Manifest.lock`
- 用户是否用 `.xcodeproj` 而非 `.xcworkspace` 打开工程

## 排查步骤

1. 调 `detect_ios_project`；若 `cocoapods_integration_broken=true` 或 warnings 含
   `cocoapods_pbxproj_scripts_missing`，直接按本卡修复。
2. 若 `uses_xcodegen=true` 且最近跑过 generate，默认假设脚本已被清掉。
3. 确认不是「开错工程」：必须打开 `.xcworkspace`。

## 解决方案

1. 在 iOS 工程根目录执行：`pod install`（若刚改过 `project.yml`：先
   `xcodegen generate`，再 `pod install`）。
2. 用 `.xcworkspace` 重新打开工程并 Clean Build Folder。
3. 不要改 Pod 名、不要把 `import TIMPush` 改成别的 module 名。
4. 长期：在文档 / CI 里固定顺序 `xcodegen generate` → `pod install`。

## 验证信号

- `project.pbxproj` 再次出现 `[CP] Check Pods Manifest.lock`（或等价 [CP] 脚本）
- `detect_ios_project.cocoapods_integration_broken === false`
- AppDelegate `import TIMPush` 编译通过
