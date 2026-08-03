import SwiftUI

@main
struct PickWatchApp: App {
  @StateObject private var link = PhoneLink.shared

  init() {
    // Ask up front so the HealthKit prompt doesn't interrupt the first tap on
    // Start. Declining only costs the stay-frontmost behavior; the walk itself
    // is unaffected.
    WorkoutSession.shared.requestAuthorization()
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(link)
    }
  }
}
