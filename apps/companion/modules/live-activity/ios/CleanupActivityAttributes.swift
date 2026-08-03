import Foundation
import ActivityKit

// ⚠️ DUPLICATE BY DESIGN — keep in sync with `targets/widget/Attributes.swift`.
//
// This copy is compiled into the LiveActivity dev pod (the module that starts
// the activity); the widget target compiles its own. A pod and an Apple target
// can't share a source file, and ActivityKit matches on the struct's name and
// Codable shape rather than its Swift module, so two copies is the working
// pattern. Change a field here → change it there. See ../README.md.
@available(iOS 16.1, *)
public struct CleanupActivityAttributes: ActivityAttributes {
  // Live (changing) fields — updated on every heartbeat.
  public struct ContentState: Codable, Hashable {
    public var timeText: String      // "12:34"
    public var pickups: Int          // running count
    public var distanceText: String  // "0.42 mi"
    public var progressText: String  // "Carroll Gardens · 18%" (may be empty)

    public init(timeText: String, pickups: Int, distanceText: String, progressText: String) {
      self.timeText = timeText
      self.pickups = pickups
      self.distanceText = distanceText
      self.progressText = progressText
    }
  }

  // Static (fixed for the life of the activity).
  public var title: String

  public init(title: String) {
    self.title = title
  }
}
