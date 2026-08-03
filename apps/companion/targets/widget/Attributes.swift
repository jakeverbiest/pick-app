import Foundation
import ActivityKit

// ⚠️ DUPLICATE BY DESIGN — keep in sync with
// `modules/live-activity/ios/CleanupActivityAttributes.swift`.
//
// The widget extension and the Expo native module are separate compilation
// units (the module lives in a CocoaPods dev pod), and there's no supported way
// to share one file across a pod and a target. Duplicating the struct is the
// documented, working pattern for Live Activities in Expo apps — ActivityKit
// matches the activity on the struct's name and its Codable shape, not on the
// Swift module it was compiled into.
//
// If you change a field here, change it in the module copy too, or the card
// will silently stop updating.
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
