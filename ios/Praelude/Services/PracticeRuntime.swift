import Observation
import UIKit

/// App-wide timing and lifecycle ownership survives closing an individual score window.
@MainActor @Observable
final class PracticeRuntime {
    @ObservationIgnored private let store: PracticeStore
    @ObservationIgnored private let metronome: MetronomeService
    @ObservationIgnored private let speech: SpeechCommandService
    @ObservationIgnored private let notifications = AudioNotificationBag()
    @ObservationIgnored private var scoreOwners: Set<UUID> = []
    @ObservationIgnored private var checkpointTimer: Timer?

    init(store: PracticeStore, metronome: MetronomeService, speech: SpeechCommandService) {
        self.store = store
        self.metronome = metronome
        self.speech = speech
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] in
            guard let self else { return }
            self.metronome.stop()
            self.speech.stop()
            // PracticeStore retains a failed durable mutation in errorMessage; never silently
            // change its in-memory ledger when writing the pause failed.
            do { try self.store.pause() } catch { /* Store already exposes the failure. */ }
            UIApplication.shared.isIdleTimerDisabled = false
        }
        observe(UIApplication.willEnterForegroundNotification) { [weak self] in self?.updateScreenAwake() }
        observe(UIApplication.didBecomeActiveNotification) { [weak self] in self?.updateScreenAwake() }
        observe(UIApplication.willResignActiveNotification) { UIApplication.shared.isIdleTimerDisabled = false }

        let timer = Timer(timeInterval: 15, repeats: true) { [weak self] timer in
            guard self != nil else { timer.invalidate(); return }
            MainActor.assumeIsolated {
                guard let self else { return }
                guard UIApplication.shared.applicationState == .active else { return }
                if self.store.activeSet?.status == .running {
                    do { try self.store.checkpoint() } catch { /* Store already exposes the failure. */ }
                }
                self.updateScreenAwake()
            }
        }
        checkpointTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func scoreAppeared(ownerID: UUID) {
        scoreOwners.insert(ownerID)
        updateScreenAwake()
    }

    func scoreDisappeared(ownerID: UUID) {
        scoreOwners.remove(ownerID)
        updateScreenAwake()
    }

    func updateScreenAwake() {
        UIApplication.shared.isIdleTimerDisabled = store.preferences.keepScreenAwake
            && !scoreOwners.isEmpty && UIApplication.shared.applicationState == .active
    }

    private func observe(_ name: Notification.Name, action: @escaping @MainActor @Sendable () -> Void) {
        notifications.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { action() }
        })
    }
}
