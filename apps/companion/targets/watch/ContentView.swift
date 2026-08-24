import SwiftUI

/// Fitness-tracker layout, modeled on the Apple Workout app:
/// - Idle: one big navy Start button.
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

// Civic Blueprint brand navy — #0F2F66 (matches C.primary/C.dark in the phone
// app's theme.ts). The accent green (#4B7A54) that used to live here is still
// correct on the phone for "positive/success" states — the watch just reads
// as more on-brand carrying the same navy the rest of the rebrand uses.
//
// Only used as a FILL (button .tint) — never as text color directly on the
// watch's black background. On the phone, navy text sits on a white/cream
// surface; here the surface is black, and dark navy on black is close to
// unreadable. Text that sits straight on black uses creamText instead,
// matching the phone's own "text on a navy surface" convention.
private let pickNavy = Color(red: 0.059, green: 0.184, blue: 0.400) // #0F2F66
private let creamText = Color(red: 0.996, green: 0.988, blue: 0.867) // #FEFCDD, matches C.creamText

// Small on-screen build stamp so "which build is my watch actually running"
// is answerable by looking at the wrist instead of plugging into Xcode.
private var buildStamp: String {
  let info = Bundle.main.infoDictionary
  let version = info?["CFBundleShortVersionString"] as? String ?? "?"
  let build = info?["CFBundleVersion"] as? String ?? "?"
  return "v\(version) (\(build))"
}

struct IdleView: View {
  @EnvironmentObject var link: PhoneLink

  var body: some View {
    VStack(spacing: 12) {
      Text("PICK")
        .font(.system(.headline, design: .rounded).weight(.heavy))
        .foregroundStyle(creamText)

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
      .tint(pickNavy)

      if let err = link.lastError {
        Text(err)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }

      Text(buildStamp)
        .font(.system(size: 9))
        .foregroundStyle(.tertiary)
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
          .foregroundStyle(creamText)
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
        // Tester-only: log a real pick for ground truth. Hidden unless the
        // phone sets `groundTruth`, so a normal user's screen is byte-for-byte
        // what it was and there is no new target to catch a stray palm.
        //
        // On the wrist ON PURPOSE. The equivalent button on the phone would
        // mean taking it out of your pocket to tap, which flips the carry-mode
        // classifier from pocket to hand for the whole walk and adds a
        // raise-and-tap motion 1-2s after every pick — the exact signature of
        // the double-count being measured. The instrument would manufacture
        // the artifact. Wrist motion never reaches a pocketed phone.
        if link.groundTruthMode && link.state == .active {
          Button(action: { link.logPick() }) {
            Text("LOG PICK")
              .font(.system(size: 15, weight: .bold, design: .rounded))
              .frame(maxWidth: .infinity)
              .padding(.vertical, 6)
          }
          .buttonStyle(.borderedProminent)
          .tint(.orange)
          .padding(.top, 4)
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
            .foregroundStyle(creamText)
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
        // "Keep Going" is deliberately FIRST and prominent; "End Walk" sits
        // below and unstyled. On a watch face the top button is the easy
        // target, and the easy target should not be the destructive one.
        Button(action: { confirmingEnd = false }) {
          Text("Keep Going")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(pickNavy)
        Button(role: .destructive, action: { link.endWalk() }) {
          Text("End Walk")
            .frame(maxWidth: .infinity)
        }
      } else {
        // Arming the confirm DISARMS ITSELF after a few seconds.
        //
        // WHY (19 Aug 2026): three walks ended by themselves in a pocket while
        // a paired watch was worn. `confirmingEnd` was @State with no timeout,
        // so one stray tap on this full-width button armed the confirm for the
        // ENTIRE REST OF THE WALK — and any later stray tap on the (then
        // top-positioned, prominent) "End Walk" button finished the job. The
        // two taps did not have to be anywhere near each other in time, which
        // is what made this so easy to hit on a moving wrist.
        Button(action: {
          confirmingEnd = true
          DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            confirmingEnd = false
          }
        }) {
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
