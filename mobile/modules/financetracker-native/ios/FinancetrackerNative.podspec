Pod::Spec.new do |s|
  s.name           = 'FinancetrackerNative'
  s.version        = '0.1.0'
  s.summary        = 'Native capabilities for Finance Tracker (Live Activity control on iOS).'
  s.description    = 'Local Expo module: iOS Live Activity (Dynamic Island) start/update/end bridge.'
  s.author         = 'Finance Tracker'
  s.homepage       = 'https://github.com/poornachandratejasvi/finance_tracker'
  s.platforms      = { :ios => '16.1' }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
