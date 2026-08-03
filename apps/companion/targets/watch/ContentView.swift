import SwiftUI

/// Fitness-tracker layout, modeled on the Apple Workout app:
/// - Idle: one big green Start button.
/// - Active: Pickups as the hero number, Time below; swipe left for End.
struct ContentView: View {
  @EnvironmentObject var link: PhoneLink

  var body: some View {
    // `.starting` counts as active: the workout screen appears the instant you
    // tap Start, rather than after the phone finishes acquiring GPS.
    if link.state == .idle {
      IdleView()
    } else {
      ActiveView()
    }
  }
}

// Civic Blueprint brand green — #4B7A54 (matches C.accent in the phone app's theme.ts).
private let pickGreen = Color(red: 0.294, green: 0.478, blue: 0.329) // #4B7A54

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

  private var hasEvent: Bool { !link.eventName.isEmpty }

  var body: some View {
    HStack(spacing: 8) {
      // Main column: pickups centered, time + distance pinned to the bottom.
      VStack(spacing: 0) {
        Spacer(minLength: 0)

        // Hero — pickups, centered and big
        Text("\(link.pickups)")
          .font(.system(size: 84, weight: .semibold, design: .rounded))
          .foregroundStyle(pickGreen)
          .contentTransition(.numericText())
          .minimumScaleFactor(0.4)
          .lineLimit(1)
        Text(link.state == .starting ? "STARTING…" : "PICKUPS")
          .font(.system(.caption2, design: .rounded).weight(.semibold))
          .foregroundStyle(.secondary)

        Spacer(minLength: 0)

        // Bottom row: time + distance
        HStack(spacing: 10) {
          VStack(spacing: 0) {
            Text(timeString(link.elapsedSeconds))
              .font(.system(size: 20, weight: .medium, design: .rounded))
              .monospacedDigit()
              .foregroundStyle(.yellow)
            Text("TIME")
              .font(.system(size: 9, weight: .semibold, design: .rounded))
              .foregroundStyle(.secondary)
          }
          if !link.distance.isEmpty {
            VStack(spacing: 0) {
              Text(link.distance)
                .font(.system(size: 20, weight: .medium, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.cyan)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
              Text("DISTANCE")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            }
          }
        }
      }
      .frame(maxWidth: .infinity)

    }
    .padding(.horizontal, 6)
    .overlay(alignment: .topTrailing) {
      // Competition mode: the event area's % cleaned, top-right corner.
      // Only sent by the phone during specific competitions.
      if hasEvent && !link.eventPct.isEmpty {
        VStack(alignment: .trailing, spacing: 0) {
          Text(link.eventPct)
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .foregroundStyle(pickGreen)
          Text("CLEANED")
            .font(.system(size: 8, weight: .bold, design: .rounded))
            .foregroundStyle(.secondary)
        }
        .padding(.trailing, 4)
      }
    }
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
