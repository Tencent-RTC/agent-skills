# Xcode 15+ 新工程默认 ENABLE_USER_SCRIPT_SANDBOXING = YES，会让 [CP] Embed Pods Frameworks 的 rsync 失败。
# 通过 xcodeproj gem 修改你的主工程，而不是手改 pbxproj 文本。
post_install do |installer|
  installer.aggregate_targets.each do |agg|
    agg.user_project.native_targets.each do |t|
      t.build_configurations.each { |c| c.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO' }
    end
    agg.user_project.save
  end
end
