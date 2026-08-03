import WidgetKit
import SwiftUI

// Entry point for the widget extension. The bundle is gated on iOS 16.1 because
// ActivityConfiguration doesn't exist below it; on older systems the extension
// simply exports nothing.
@main
struct PickWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.1, *) {
      PickCleanupWidget()
    }
  }
}
