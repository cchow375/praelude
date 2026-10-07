import Foundation

/// A nonblocking admission gate for expensive work fed by realtime callbacks. Busy callers drop
/// their obsolete window instead of building a backlog; the next window can enter after finish.
public final class InFlightWorkGate: @unchecked Sendable {
    private let lock = NSLock()
    private var busy = false

    public init() {}

    public func tryBegin() -> Bool {
        guard lock.try() else { return false }
        defer { lock.unlock() }
        guard !busy else { return false }
        busy = true
        return true
    }

    public func finish() {
        lock.lock()
        busy = false
        lock.unlock()
    }
}
