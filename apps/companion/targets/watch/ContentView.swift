import SwiftUI

/// Fitness-tracker layout, modeled on the Apple Workout app:
/// - Idle: one big green Start button.
/// - Active: Pickups as the hero number, Time below; swipe left for End.
struct ContentView: View {
  @EnvironmentObject var link: PhoneLink

  var body: some View {
    if link.state == .active {
      ActiveView()
    } else {
      IdleView()
    }
  }
}

private let pickGreen = Color(red: 0.204, green: 0.780, blue: 0.349) // #34C759

struct IdleView: View {
  @EnvironmentObject var link: PhoneLink

  var body: some View {
    VStack(spacing: 12) {
      Text("PICK")
        .font(.system(.headline, design: .rounded).weight(.heavy))
        .foregroundStyle(pickGreen)

      Button(action: { link.startWalk() }) {
        VStack(spacing: 4) {
          Image(systemName: "figure.walk")
            .font(.system(size: 28, weight: .semibold))
          Text("Start Pickup")
            .font(.system(.body, design: .rounded).weight(.semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
      }
      .buttonStyle(.borderedProminent)
      .tint(pickGreen)

      if let err = link.lastError {
        Text(err)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
    .padding(.horizontal)
  }
}

struct ActiveView: View {
  @EnvironmentObject var link: PhoneLink

  var body: some View {
    TabView {
      StatsPage()
      ControlsPage()
    }
    .tabViewStyle(.verticalPage)
  }
}

struct StatsPage: View {
  @EnvironmentObject var link: PhoneLink

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Spacer(minLength: 0)

      // Hero number — pickups
      Text("\(link.pickups)")
        .font(.system(size: 64, weight: .semibold, design: .rounded))
        .foregroundStyle(pickGreen)
        .contentTransition(.numericText())
        .minimumScaleFactor(0.5)
        .lineLimit(1)
      Text("PICKUPS")
        .font(.system(.caption2, design: .rounded).weight(.semibold))
        .foregroundStyle(.secondary)

      // Time
      Text(timeString(link.elapsedSeconds))
        .font(.system(size: 28, weight: .medium, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(.yellow)
        .padding(.top, 8)
      Text("TIME")
        .font(.system(.caption2, design: .rounded).weight(.semibold))
        .foregroundStyle(.secondary)

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal)
  }

  private func timeString(_ seconds: Int) -> String {
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    let s = seconds % 60
    return h > 0
      ? String(format: "%d:%02d:%02d", h, m, s)
      : String(format: "%d:%02d", m, s)
  }
}

struct ControlsPage: View {
  @EnvironmentObject var link: PhoneLink
  @State private var confirmingEnd = false

  var body: some View {
    VStack(spacing: 12) {
      if confirmingEnd {
        Text("End this walk?")
          .font(.system(.body, design: .rounded).weight(.semibold))
        Button(role: .destructive, action: { link.endWalk() }) {
          Text("End Walk")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        Button(action: { confirmingEnd = false }) {
          Text("Keep Going")
            .frame(maxWidth: .infinity)
        }
        .tint(pickGreen)
      } else {
        Button(action: { confirmingEnd = true }) {
          VStack(spacing: 4) {
            Image(systemName: "xmark")
              .font(.system(size: 22, weight: .semibold))
            Text("End")
              .font(.system(.body, design: .rounded).weight(.semibold))
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)

        if let err = link.lastError {
          Text(err)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
      }
    }
    .padding(.horizontal)
  }
}
