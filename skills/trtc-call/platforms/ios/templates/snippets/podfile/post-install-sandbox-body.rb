  installer.aggregate_targets.each do |agg|
    agg.user_project.native_targets.each do |t|
      t.build_configurations.each { |c| c.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO' }
    end
    agg.user_project.save
  end
