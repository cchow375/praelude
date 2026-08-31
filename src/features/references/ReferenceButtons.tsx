import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./ReferenceButtons.css";

export type ReferenceProvider = "spotify" | "youtube";

export interface ReferenceResult {
  provider: ReferenceProvider;
  url: string;
  opened: boolean;
}

export interface ReferenceApi {
  open: (pieceId: number, provider: ReferenceProvider) => Promise<ReferenceResult>;
}

const defaultApi: ReferenceApi = {
  open: (pieceId, provider) => invoke("reference_open", { pieceId, provider }),
};

export function ReferenceButtons({ pieceId, api = defaultApi }: { pieceId: number; api?: ReferenceApi }) {
  const [opening, setOpening] = useState<ReferenceProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (provider: ReferenceProvider) => {
    if (opening) return;
    setOpening(provider);
    setError(null);
    setMessage(null);
    try {
      const result = await api.open(pieceId, provider);
      if (!result.opened) throw new Error("The search could not be opened.");
      setMessage(`${provider === "spotify" ? "Spotify" : "YouTube"} search opened.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className="reference-buttons" aria-label="Reference recordings">
      <div>
        <span className="ck-label">Reference recordings</span>
        <p>Open an explicit search in the matching app or browser. CodaKiller never downloads or autoplays it.</p>
      </div>
      <div className="reference-actions">
        <button type="button" disabled={opening != null} onClick={() => void open("spotify")}>
          {opening === "spotify" ? "Opening…" : "Search Spotify"}
        </button>
        <button type="button" disabled={opening != null} onClick={() => void open("youtube")}>
          {opening === "youtube" ? "Opening…" : "Search YouTube"}
        </button>
      </div>
      {message && <p className="reference-message" role="status">{message}</p>}
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
    </section>
  );
}

function errorMessage(cause: unknown) {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return "Could not open the reference search.";
}
