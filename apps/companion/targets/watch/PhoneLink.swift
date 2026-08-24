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
  /// Tester-only ground-truth logging. Driven entirely by the phone (`groundTruth`
  /// in the stats payload), so the button below is invisible to normal users even
  /// though every build contains it — and the gate itself stays in phone-side JS,
  /// which means it can be turned on for a tester over the air without a rebuild.
  @Published var groundTruthMode: Bool = false
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
    groundTruthMode = false
  }

  /// Log a real pick, for measuring the detector against ground truth.
  ///
  /// Two things here are deliberate and both were failure modes waiting to
  /// happen (24 Aug 2026):
  ///
  /// 1. The timestamp is taken HERE, on the wrist, at the moment of the tap —
  ///    not when the phone receives it. WatchConnectivity delivery is delayed
  ///    and interleaved (the whole staleness guard above exists because of
  ///    that), and a two-second delivery delay would become a two-second
  ///    alignment error — the same magnitude as the double-counting this is
  ///    meant to measure. A ground truth that drifts is worse than none.
  ///
  /// 2. `transferUserInfo`, not `sendMessage`. sendMessage requires
  ///    `isReachable` and drops the payload otherwise — and a silently dropped
  ///    tap reads downstream as a pick the detector missed, i.e. it would
  ///    manufacture a recall failure out of a connectivity blip.
  ///    transferUserInfo is queued, ordered and guaranteed.
  func logPick() {
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    session.transferUserInfo([
      "cmd": "logPick",
      "atMs": Date().timeIntervalSince1970 * 1000,
    ])
    WKInterfaceDevice.current().play(.click)
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
  ///   It selects the RESPONSE to a stale payload, not whether we check.
  private func apply(_ payload: [String: Any], cached: Bool = false) {
    guard !payload.isEmpty else { return }
    DispatchQueue.main.async {
      let sentAt = payload["sentAt"] as? TimeInterval ?? 0

      // Out-of-order delivery: applicationContext and sendMessage race.
      // Runs FIRST (it used to sit below the staleness check): anything older
      // than what we've already applied is not evidence about now, whatever
      // its age says. Deciding that up front keeps a late payload from a
      // FINISHED walk out of the staleness branch while a newer walk is
      // running. Inert at activation, where lastAppliedAt is still 0.
      if sentAt > 0, sentAt < self.lastAppliedAt { return }

      // A payload much older than staleContextSeconds isn't live truth —
      // whether it's the one-time cached snapshot read at session activation,
      // or a late delivery on the ONGOING didReceiveApplicationContext path
      // (watchOS queues and can deliver application-context updates after a
      // delay when the watch app was suspended, e.g. under memory pressure or
      // while backgrounded).
      //
      // The CHECK covers both paths. The RESPONSE differs, because age means
      // different things on each and the cost of being wrong isn't symmetric:
      //
      //   cached (activation) — we may already be SHOWING a leftover from a
      //   previous launch, so idle has to be asserted. resetToIdle().
      //
      //   explicit idle — the phone reports no walk. Stale or not, it is the
      //   newest thing we have and nothing contradicts it. Honour it, or the
      //   watch strands on a walk that already ended. resetToIdle().
      //
      //   ongoing + claims ACTIVE — ambiguous, and this is the dangerous one.
      //   The phone may simply have gone quiet: the push is driven by a JS
      //   effect and iOS throttles timers in the background, which is every
      //   real walk. Our own state was built from live payloads and is the
      //   better estimate, so drop the payload and keep it. Do NOT
      //   resetToIdle() here — that ends the WorkoutSession keeping this app
      //   alive, making suspension (and the next delayed delivery) MORE
      //   likely, and puts the watch back on the Start screen mid-walk: the
      //   exact symptom the phone-side walkIntent fix removed.
      //
      // The phone still asserts the end of a walk explicitly — walkIntent
      // false pushes state 'idle' with zeroed counters and an empty sessionId.
      // That is the primary signal; this is only the backstop for when that
      // push is itself what arrives late.
      if sentAt > 0, Date().timeIntervalSince1970 - sentAt > self.staleContextSeconds {
        let saysIdle = (payload["state"] as? String) == "idle"
        if cached || saysIdle { self.resetToIdle() }
        // Record how new the payload we just REJECTED was, so the out-of-order
        // check above can reject a re-delivery of the same context on the other
        // path without re-deriving staleness from wall-clock age.
        //
        // WHY (24 Aug 2026): resetToIdle() deliberately does not touch
        // lastAppliedAt — it clears walk state, and lastAppliedAt is delivery
        // bookkeeping, not walk state. That left a real window: at activation
        // lastAppliedAt is 0, the cached guard fires and paints 0, and then
        // watchOS re-delivers the SAME queued context on the ongoing
        // didReceiveApplicationContext path. Against a zeroed lastAppliedAt the
        // out-of-order check passed, and the old count painted back over the 0
        // — the intermittent "flashing an old count" symptom. The staleness
        // check now covers both paths, so this is belt-and-braces: after it,
        // either check alone is enough to reject the re-delivery.
        //
        // Safe by construction: we only get here when the payload is already
        // older than staleContextSeconds, so anything older still is more
        // stale, and any genuinely live payload carries a newer sentAt.
        self.lastAppliedAt = max(self.lastAppliedAt, sentAt)
        return
      }

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
      if let g = payload["groundTruth"] as? String { self.groundTruthMode = (g == "1") }

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
