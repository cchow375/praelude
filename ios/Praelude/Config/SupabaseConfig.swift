import Foundation

/// Connection details for the Supabase backend (spec 4a). Only the publishable (client-safe) key
/// lives here — never the secret/service_role key, which must never appear in this repository or
/// app. See `supabase/(C) Backend.md` for how these values were obtained and
/// `supabase/(C) Sync Protocol.md` for the RPCs this app talks to.
public enum SupabaseConfig {
    public static let projectURL = URL(string: "https://zotswpjyvmhnxdyibnnz.supabase.co")!
    public static let publishableKey = "sb_publishable_n16K5DFayaDQNBoglQ5wfQ_asFHO22Y"
}
