Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'ActivityKit Live Activity for the PICK "cleanup in progress" card'
  s.description    = 'Phone-side bridge that starts/updates/ends the lock-screen + Dynamic Island Live Activity during a cleanup walk.'
  s.author         = 'PICK'
  s.homepage       = 'https://github.com/jakeverbiest/pick-app'
  # Must match the app's deployment target (Podfile: 15.1). Declaring 16.1 here
  # makes `pod install` fail outright with a platform-compatibility error, so the
  # module never links — every ActivityKit call is guarded with
  # `@available(iOS 16.1, *)` instead, which compiles fine against 15.1.
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.license        = { :type => 'MIT' }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
