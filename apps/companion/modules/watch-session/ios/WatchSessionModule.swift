import ExpoModulesCore
import WatchConnectivity

/// Phone-side WatchConnectivity link.
///
/// - Receives `startWalk` / `endWalk` commands from the watch and forwards
///   them to JS as `onWatchCommand` events (map.tsx listens and calls the
///   existing startCleanup/stopCleanup — no session logic lives here).
/// - Pushes live stats to the watch via `updateApplicationContext` (coalescing,
///   battery-cheap; the watch always gets the latest snapshot on wake).
final class PhoneWatchLink: NSObject, WCSessionDelegate {
  static let shared = PhoneWatchLink()

  /// Set by the module; called on the main queue with the command string.
  /// (command, atMs). atMs is the WATCH's own capture time for ground-truth
  /// taps, 0 for plain commands — see PhoneLink.logPick() for why it cannot be
  /// stamped on arrival here.
  var onCommand: ((String, Double) -> Void)?

  private override init() {
    super.init()
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated {
      session.activate()
    }
  }

  func sendStats(pickups: Int, elapsedSeconds: Int, state: String, extras: [String: String]) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    var payload: [String: Any] = [
      "pickups": pickups,
      "elapsedSeconds": elapsedSeconds,
      "state": state,
      "sentAt": Date().timeIntervalSince1970,
    ]
    for (k, v) in extras { payload[k] = v }
    // applicationContext = "latest wins" snapshot; ideal for a stats mirror.
    try? session.updateApplicationContext(payload)
    // If the watch app is frontmost, also push instantly for a live feel.
    if session.isReachable {
      session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
    }
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}

  // Required on iOS for watch switching.
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message: message)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    handle(message: message)
    replyHandler(["ok": true])
  }

  /// `transferUserInfo` lands here. Ground-truth taps use that path rather than
  /// sendMessage because it is queued and guaranteed: sendMessage needs
  /// `isReachable` and drops the payload otherwise, and a dropped tap would read
  /// downstream as a pick the detector missed.
  func session(
    _ session: WCSession,
    didReceiveUserInfo userInfo: [String: Any] = [:]
  ) {
    handle(message: userInfo)
  }

  private func handle(message: [String: Any]) {
    guard let cmd = message["cmd"] as? String else { return }
    let atMs = message["atMs"] as? Double ?? 0
    DispatchQueue.main.async { [weak self] in
      self?.onCommand?(cmd, atMs)
    }
  }
}

public class WatchSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchSession")

    Events("onWatchCommand")

    OnCreate {
      PhoneWatchLink.shared.onCommand = { [weak self] cmd, atMs in
        self?.sendEvent("onWatchCommand", ["command": cmd, "atMs": atMs])
      }
      PhoneWatchLink.shared.activate()
    }

    OnDestroy {
      PhoneWatchLink.shared.onCommand = nil
    }

    /// Mirror the current walk to the watch.
    /// state: "idle" | "active"; extras: preformatted display strings
    /// (distance, bags, progress).
    Function("sendStats") { (pickups: Int, elapsedSeconds: Int, state: String, extras: [String: String]) in
      PhoneWatchLink.shared.sendStats(
        pickups: pickups, elapsedSeconds: elapsedSeconds, state: state, extras: extras)
    }

    Function("isPaired") { () -> Bool in
      guard WCSession.isSupported() else { return false }
      return WCSession.default.isPaired
    }
  }
}
