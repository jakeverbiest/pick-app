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
    /// Local, optimistic: you tapped Start and we're waiting on the phone to
    /// confirm. The active screen shows immediately at 0 instead of sitting on
    /// the Start button (and instead of flashing the previous walk's count).
    case starting
    case active
  }

  /// A cached `applicationContext` older than this is a leftover from a previous
  /// session, not live truth — ignore it and show idle/0.
  private let staleContextSeconds: TimeInterval = 120
  /// How long we hold the optimistic "starting" screen before giving up. The
  /// phone needs a GPS fix + motion listener before it flips to active.
  private let startGraceSeconds: TimeInterval = 25

  @Published var state: WalkState = .idle
  @Published var pickups: Int = 0
  @Published var elapsedSeconds: Int = 0
  @Published var distance: String = ""
  @Published var progress: String = ""
  // Competition mode — the event area's % cleaned (top-right corner)
  @Published var eventName: String = ""
  @Published var eventPct: String = "" // e.g. "64%"
  @Published var phoneReachable: Bool = false
  /// Set briefly when a command fails so the UI can say "Open PICK on your phone."
  @Published var lastError: String?

  private var previousPickups: Int = 0
  private var previousSegments: Int = -1
  private var hapticsEnabled: Bool = true
  /// Timestamp of the newest snapshot we've applied — drops out-of-order
  /// payloads (`sendMessage` and `applicationContext` can arrive interleaved).
  private var lastAppliedAt: TimeInterval = 0
  /// The phone's walk id. A new id means a genuinely new walk, so counters reset.
  private var sessionId: String = ""
  private var startRequestedAt: TimeInterval = 0
  private var startTimeoutTimer: Timer?

  private override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  // MARK: - Commands

  func startWalk() {
    // Show the active screen right away. Without this the watch sat on the Start
    // button (still showing the last walk's numbers from the cached context)
    // for the several seconds the phone spends acquiring GPS.
    startRequestedAt = Date().timeIntervalSince1970
    pickups = 0
    previousPickups = 0
    previousSegments = -1
    elapsedSeconds = 0
    distance = ""
    progress = ""
    eventName = ""
    eventPct = ""
    lastError = nil
    state = .starting
    // Hold a workout session for the walk so watchOS keeps PICK frontmost and
    // running — a wrist-raise comes back to this screen instead of the clock
    // face. Started optimistically alongside the command; failCommand()/
    // resetToIdle() tear it down if the phone never picks up.
    WorkoutSession.shared.start()
    armStartTimeout()
    send(command: "startWalk")
  }

  func endWalk() {
    cancelStartTimeout()
    send(command: "endWalk")
    // Backing out of the optimistic start screen: the phone has no session to
    // end yet, so drop back to idle ourselves.
    if state == .starting { resetToIdle() }
  }

  /// If the phone never confirms, don't strand the user on a fake active screen.
  private func armStartTimeout() {
    cancelStartTimeout()
    startTimeoutTimer = Timer.scheduledTimer(
      withTimeInterval: startGraceSeconds, repeats: false
    ) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, self.state == .starting else { return }
        self.resetToIdle()
        self.lastError = "Couldn’t start — open PICK on your phone"
      }
    }
  }

  private func cancelStartTimeout() {
    startTimeoutTimer?.invalidate()
    startTimeoutTimer = nil
  }

  private func resetToIdle() {
    cancelStartTimeout()
    WorkoutSession.shared.end()
    state = .idle
    pickups = 0
    previousPickups = 0
    previousSegments = -1
    elapsedSeconds = 0
    distance = ""
    progress = ""
    eventName = ""
    eventPct = ""
    sessionId = ""
    startRequestedAt = 0
  }

  private func send(command: String) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      DispatchQueue.main.async { self.failCommand() }
      return
    }
    DispatchQueue.main.async { self.lastError = nil }
    session.sendMessage(["cmd": command], replyHandler: nil) { [weak self] _ in
      DispatchQueue.main.async { self?.failCommand() }
    }
  }

  /// The phone didn't take the command. Don't leave the watch pretending a walk
  /// is underway — drop back to the Start screen with a reason.
  private func failCommand() {
    if state == .starting { resetToIdle() }
    lastError = "Open PICK on your phone"
  }

  // MARK: - Incoming stats

  /// - Parameter cached: true when this came from `receivedApplicationContext`
  ///   at activation, i.e. it may be a snapshot from a previous launch.
  private func apply(_ payload: [String: Any], cached: Bool = false) {
    guard !payload.isEmpty else { return }
    DispatchQueue.main.async {
      let sentAt = payload["sentAt"] as? TimeInterval ?? 0

      // A snapshot the phone left behind before we were launched is history, not
      // truth. Applying it is what made the watch flash the *previous* walk's
      // pickup count before snapping back to 0.
      if cached, sentAt > 0, Date().timeIntervalSince1970 - sentAt > self.staleContextSeconds {
        self.resetToIdle()
        return
      }
      // Out-of-order delivery: applicationContext and sendMessage race.
      if sentAt > 0, sentAt < self.lastAppliedAt { return }

      let incoming = (payload["state"] as? String).flatMap(WalkState.init(rawValue:))

      // While we're optimistically "starting", ignore the idle snapshots the
      // phone keeps emitting until its GPS + motion listener are up — those are
      // what used to knock the watch straight back to the Start screen.
      if self.state == .starting, incoming == .idle {
        if sentAt == 0 || sentAt < self.startRequestedAt + self.startGraceSeconds { return }
      }

      // A different walk id means fresh counters, not a continuation.
      if let sid = payload["sessionId"] as? String, !sid.isEmpty, sid != self.sessionId {
        self.sessionId = sid
        self.previousPickups = 0
        self.previousSegments = -1
      }

      if sentAt > 0 { self.lastAppliedAt = sentAt }
      if let h = payload["haptics"] as? String { self.hapticsEnabled = (h == "1") }

      if let p = payload["pickups"] as? Int {
        // Subtle tick when the count goes up mid-walk.
        if self.state == .active && p > self.previousPickups {
          WKInterfaceDevice.current().play(.click)
        }
        self.previousPickups = p
        self.pickups = p
      }
      // Firmer confirmation when a whole street segment is finished.
      if let seg = payload["segments"] as? String, let n = Int(seg) {
        if self.hapticsEnabled, self.state == .active, self.previousSegments >= 0, n > self.previousSegments {
          WKInterfaceDevice.current().play(.success)
        }
        self.previousSegments = n
      }
      if let t = payload["elapsedSeconds"] as? Int {
        self.elapsedSeconds = t
      }
      if let d = payload["distance"] as? String { self.distance = d }
      if let pr = payload["progress"] as? String { self.progress = pr }
      if let en = payload["eventName"] as? String { self.eventName = en }
      if let ep = payload["eventPct"] as? String { self.eventPct = ep }

      if let ws = incoming {
        switch ws {
        case .active:
          self.lastError = nil
          self.cancelStartTimeout()
          // Covers walks started on the phone: the watch learns about them here,
          // and wants the same stay-frontmost behavior. No-op if already running.
          WorkoutSession.shared.start()
          self.state = .active
        case .idle:
          self.resetToIdle()
        case .starting:
          break // phone never sends this; it's watch-local
        }
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
    // Pick up the latest snapshot the phone pushed while we were closed — but
    // only if it's recent enough to still describe a live walk.
    apply(session.receivedApplicationContext, cached: true)
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
