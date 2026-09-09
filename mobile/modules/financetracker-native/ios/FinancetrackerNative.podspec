Pod::Spec.new do |s|
  s.name           = 'FinancetrackerNative'
  s.version        = '0.1.0'
  s.summary        = 'Native capabilities for Finance Tracker (Live Activity control on iOS).'
  s.description    = 'Local Expo module: iOS Live Activity (Dynamic Island) start/update/end bridge.'
  s.author         = 'Finance Tracker'
  s.homepage       = 'https://github.com/poornachandratejasvi/finance_tracker'
  # Matches app.json's expo-build-properties ios.deploymentTarget -- CocoaPods
  # compiles this pod at the app-wide target regardless of what's declared
  # here, so keep them in sync to avoid confusion (see the matching comment
  # in targets/widget/expo-target.config.js, where this mismatch actually
  # broke a build).
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
