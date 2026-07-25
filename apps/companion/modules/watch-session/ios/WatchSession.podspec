Pod::Spec.new do |s|
  s.name           = 'WatchSession'
  s.version        = '1.0.0'
  s.summary        = 'WatchConnectivity bridge for the PICK Apple Watch companion'
  s.description    = 'Phone-side WCSession wrapper: receives start/end commands from the watch and pushes live walk stats to it.'
  s.author         = 'PICK'
  s.homepage       = 'https://github.com/jakeverbiest/pick-app'
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
