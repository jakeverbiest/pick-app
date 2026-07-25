import Foundation
import WatchConnectivity
import WatchKit

/// Watch-side WatchConnectivity link.
///
/// The phone is the source of truth: this object only sends start/end
/// commands and mirrors whatever stats the phone pushes.
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = PhoneLink()

  enum WalkState: String {
    case idle
    case active
  }

  @Published var state: WalkState = .idle
  @Published var pickups: Int = 0
  @Published var elapsedSeconds: Int = 0
  @Published var phoneReachable: Bool = false
  /// Set briefly when a command fails so the UI can say "Open PICK on your phone."
  @Published var lastError: String?

  private var previousPickups: Int = 0

  private override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  // MARK: - Commands

  func startWalk() { send(command: "startWalk") }
  func endWalk() { send(command: "endWalk") }

  private func send(command: String) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      DispatchQueue.main.async {
        self.lastError = "Open PICK on your phone"
      }
      return
    }
    lastError = nil
    session.sendMessage(["cmd": command], replyHandler: nil) { [weak self] _ in
      DispatchQueue.main.async {
        self?.lastError = "Open PICK on your phone"
      }
    }
  }

  // MARK: - Incoming stats

  private func apply(_ payload: [String: Any]) {
    DispatchQueue.main.async {
      if let p = payload["pickups"] as? Int {
        // Subtle haptic when the count goes up mid-walk.
        if self.state == .active && p > self.previousPickups {
          WKInterfaceDevice.current().play(.click)
        }
        self.previousPickups = p
        self.pickups = p
      }
      if let t = payload["elapsedSeconds"] as? Int {
        self.elapsedSeconds = t
      }
      if let s = payload["state"] as? String, let ws = WalkState(rawValue: s) {
        if ws == .active { self.lastError = nil }
        self.state = ws
      }
    }
  }

  // MARK: - WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async {
      self.phoneReachable = session.isReachable
    }
    // Pick up the latest snapshot the phone pushed while we were closed.
    apply(session.receivedApplicationContext)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async {
      self.phoneReachable = session.isReachable
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    apply(message)
  }

  func session(
    _ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    apply(applicationContext)
  }
}
