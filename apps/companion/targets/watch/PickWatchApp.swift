import SwiftUI

@main
struct PickWatchApp: App {
  @StateObject private var link = PhoneLink.shared

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(link)
    }
  }
}
