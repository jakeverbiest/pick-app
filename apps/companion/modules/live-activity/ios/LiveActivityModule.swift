import ExpoModulesCore
import ActivityKit
import Foundation

// Phone-side bridge for the "cleanup in progress" Live Activity.
// JS API (see ../index.ts): isSupported(), start(state), update(state), end().
public class LiveActivityModule: Module {
  private var currentActivityId: String?

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.1, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    Function("start") { (state: [String: Any]) in
      if #available(iOS 16.1, *) { self.startActivity(state) }
    }

    Function("update") { (state: [String: Any]) in
      if #available(iOS 16.1, *) { self.updateActivity(state) }
    }

    Function("end") {
      if #available(iOS 16.1, *) { self.endActivity() }
    }
  }

  @available(iOS 16.1, *)
  private func contentState(from dict: [String: Any]) -> CleanupActivityAttributes.ContentState {
    CleanupActivityAttributes.ContentState(
      timeText: dict["timeText"] as? String ?? "",
      pickups: dict["pickups"] as? Int ?? 0,
      distanceText: dict["distanceText"] as? String ?? "",
      progressText: dict["progressText"] as? String ?? ""
    )
  }

  @available(iOS 16.1, *)
  private func startActivity(_ dict: [String: Any]) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    // Never stack duplicates — if one's already running, just update it.
    if currentActivityId != nil { updateActivity(dict); return }
    let attributes = CleanupActivityAttributes(title: "Cleanup in progress")
    let state = contentState(from: dict)
    do {
      let activity: Activity<CleanupActivityAttributes>
      if #available(iOS 16.2, *) {
        activity = try Activity.request(attributes: attributes, content: .init(state: state, staleDate: nil))
      } else {
        activity = try Activity.request(attributes: attributes, contentState: state)
      }
      currentActivityId = activity.id
    } catch {
      NSLog("LiveActivity start failed: \(error.localizedDescription)")
    }
  }

  @available(iOS 16.1, *)
  private func updateActivity(_ dict: [String: Any]) {
    guard let id = currentActivityId else { return }
    let state = contentState(from: dict)
    Task {
      for activity in Activity<CleanupActivityAttributes>.activities where activity.id == id {
        if #available(iOS 16.2, *) {
          await activity.update(.init(state: state, staleDate: nil))
        } else {
          await activity.update(using: state)
        }
      }
    }
  }

  @available(iOS 16.1, *)
  private func endActivity() {
    let id = currentActivityId
    currentActivityId = nil
    Task {
      for activity in Activity<CleanupActivityAttributes>.activities where (id == nil || activity.id == id) {
        if #available(iOS 16.2, *) {
          await activity.end(nil, dismissalPolicy: .immediate)
        } else {
          await activity.end(dismissalPolicy: .immediate)
        }
      }
    }
  }
}
