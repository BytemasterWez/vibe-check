import Foundation

/// Display formatting for live sensor values. Formatting only — raw stored
/// values always keep full precision.
enum Format {

    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%02d:%02d", m, s)
    }

    static func microtesla(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.2f µT", value)
    }

    static func meters(_ value: Double?, decimals: Int = 1) -> String {
        guard let value else { return "—" }
        return String(format: "%.\(decimals)f m", value)
    }

    static func speed(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.2f m/s", value)
    }

    static func pressure(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f hPa", value)
    }

    static func coordinate(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.5f°", value)
    }

    static func score(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.0f", value)
    }

    static func confidence(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.0f%%", value * 100)
    }

    static func quality(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.2f", value)
    }
}
