import Foundation
import HealthKit

/// Holds an `HKWorkoutSession` for the duration of a walk.
///
/// This is what makes PICK Watch behave like the Workout app rather than an
/// ordinary watch app:
///
/// - **Wrist-raise returns to PICK.** Without a running workout session,
///   watchOS deactivates the app after a few seconds and a wrist-raise lands you
///   on the clock face. With one, the system treats PICK as the frontmost app
///   for the life of the session — which is the "stays on the active screen"
///   behavior a walk needs.
/// - **The app keeps running** while your wrist is down, so the pickup count and
///   timer stay live and WatchConnectivity stays up.
///
/// Deliberately minimal: we do NOT read heart rate, route, or any other health
/// data, and we never save the workout to HealthKit — the phone already logs the
/// cleanup as a walking workout via the existing Health sync. This session
/// exists purely for the runtime/UI behavior, so `end()` discards it.
///
/// Requires on the watch target: the HealthKit entitlement, both usage strings,
/// and `WKBackgroundModes: [workout-processing]` (see expo-target.config.js and
/// Info.plist).
final class WorkoutSession: NSObject {
  static let shared = WorkoutSession()

  private let store = HKHealthStore()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?

  private override init() { super.init() }

  var isRunning: Bool { session?.state == .running }

  /// Ask for the minimum HealthKit authorization a workout session needs.
  /// Called once when the watch app launches so the prompt isn't in the way of
  /// tapping Start.
  func requestAuthorization() {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    // `workoutType()` alone is enough to run a session. We share nothing else
    // and read nothing at all.
    let types: Set = [HKObjectType.workoutType()]
    store.requestAuthorization(toShare: types, read: []) { _, error in
      if let error {
        NSLog("PICK Watch: HealthKit authorization failed — \(error.localizedDescription)")
      }
    }
  }

  /// Start a walking workout session. Safe to call repeatedly; a no-op if one is
  /// already running, and a silent no-op if HealthKit is unavailable — a failure
  /// here must never stop the walk itself.
  func start() {
    guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }

    let config = HKWorkoutConfiguration()
    config.activityType = .walking
    config.locationType = .outdoor

    do {
      let session = try HKWorkoutSession(healthStore: store, configuration: config)
      let builder = session.associatedWorkoutBuilder()
      builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
      session.delegate = self
      builder.delegate = self

      let start = Date()
      session.startActivity(with: start)
      builder.beginCollection(withStart: start) { _, error in
        if let error {
          NSLog("PICK Watch: workout collection failed to begin — \(error.localizedDescription)")
        }
      }

      self.session = session
      self.builder = builder
    } catch {
      NSLog("PICK Watch: couldn't start workout session — \(error.localizedDescription)")
    }
  }

  /// End and **discard** the session. The phone is the system of record for the
  /// walk, so there's nothing here worth saving to HealthKit — saving would
  /// double-log the cleanup against the user's activity rings.
  func end() {
    guard let session else { return }
    let builder = self.builder
    self.session = nil
    self.builder = nil

    session.end()
    builder?.endCollection(withEnd: Date()) { _, _ in
      builder?.discardWorkout()
    }
  }
}

extension WorkoutSession: HKWorkoutSessionDelegate {
  func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState,
    date: Date
  ) {
    // The system can end a session on its own (e.g. low storage). Keep our
    // bookkeeping honest so a later start() isn't blocked by a dead session.
    if toState == .ended || toState == .stopped {
      DispatchQueue.main.async {
        if self.session === workoutSession {
          self.session = nil
          self.builder = nil
        }
      }
    }
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    NSLog("PICK Watch: workout session failed — \(error.localizedDescription)")
    DispatchQueue.main.async {
      if self.session === workoutSession {
        self.session = nil
        self.builder = nil
      }
    }
  }
}

extension WorkoutSession: HKLiveWorkoutBuilderDelegate {
  // We collect nothing, so both callbacks are intentionally empty — the
  // protocol requires them.
  func workoutBuilder(
    _ workoutBuilder: HKLiveWorkoutBuilder,
    didCollectDataOf collectedTypes: Set<HKSampleType>
  ) {}

  func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
