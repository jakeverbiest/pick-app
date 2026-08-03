import WidgetKit
import SwiftUI
import ActivityKit

// The Live Activity UI. Compiled into the PICKCleanupWidget extension target
// only — the app side lives in modules/live-activity.

@available(iOS 16.1, *)
struct PickCleanupWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CleanupActivityAttributes.self) { context in
      // Lock-screen / banner presentation.
      LockScreenCleanupView(state: context.state)
        .padding(14)
        .activityBackgroundTint(Color(red: 0.0588, green: 0.1843, blue: 0.4)) // Civic Blueprint navy #0F2F66
        .activitySystemActionForegroundColor(pickCream)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label("\(context.state.pickups)", systemImage: "leaf.fill")
            .foregroundColor(.green)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.timeText).monospacedDigit()
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.progressText.isEmpty ? context.state.distanceText : context.state.progressText)
            .font(.caption)
            .foregroundColor(.secondary)
        }
      } compactLeading: {
        Image(systemName: "leaf.fill").foregroundColor(.green)
      } compactTrailing: {
        Text("\(context.state.pickups)").monospacedDigit()
      } minimal: {
        Image(systemName: "leaf.fill").foregroundColor(.green)
      }
    }
  }
}

// Civic Blueprint cream — #FEFCDD, used for text/icons on navy surfaces
// (matches C.creamText in the phone app's theme.ts).
private let pickCream = Color(red: 0.996, green: 0.988, blue: 0.867)

@available(iOS 16.1, *)
struct LockScreenCleanupView: View {
  let state: CleanupActivityAttributes.ContentState
  var body: some View {
    HStack(spacing: 14) {
      Image(systemName: "leaf.fill")
        .font(.title2)
        .foregroundColor(pickCream)
      VStack(alignment: .leading, spacing: 2) {
        Text("Cleanup in progress").font(.headline).foregroundColor(pickCream)
        Text(state.progressText.isEmpty ? state.distanceText : state.progressText)
          .font(.caption).foregroundColor(pickCream.opacity(0.85))
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 2) {
        Text("\(state.pickups)").font(.title2).bold().foregroundColor(pickCream)
        Text(state.timeText).font(.caption).monospacedDigit().foregroundColor(pickCream.opacity(0.85))
      }
    }
  }
}
