Pod::Spec.new do |s|
  s.name           = 'TodaySpendActivityKit'
  s.version        = '0.1.0'
  s.summary        = 'Shared ActivityAttributes type for the Today Spend Live Activity.'
  s.author         = 'Finance Tracker'
  s.homepage       = 'https://github.com/poornachandratejasvi/finance_tracker'
  # Deliberately depends on nothing but Apple's own ActivityKit/Foundation --
  # this pod is linked directly by the widget extension (targets/widget/pods.rb),
  # and an App Extension cannot link React Native (RN's own Fabric component
  # code calls UIApplication.sharedApplication, which is unavailable there --
  # this is exactly what broke the build when the extension linked
  # FinancetrackerNative, which depends on ExpoModulesCore -> React-Core).
  # FinancetrackerNative.podspec depends on this pod too, so both sides share
  # the identical compiled TodaySpendAttributes type without either one
  # pulling React Native into the extension's link graph.
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.source_files = "**/*.{h,m,mm,swift}"
end
