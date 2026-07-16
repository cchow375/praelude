import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createVoiceDeliveryLedger,
  registerVoiceDelivery,
  type VoiceDeliveryDisposition,
  type VoiceTranscriptDelivery,
  type VoiceTranscriptSource,
} from "./domain/delivery";
import {
  parseTierAIntent,
  type TierAContext,
  type TierAParseResult,
} from "./domain/tierAIntent";

// ---------------------------------------------------------------------------
// Voice-status hook.
//
// The Rust voice loop is the single source of truth. It emits three events:
//   voice://status     — { state, reason?, guidance? } authoritative lifecycle
//   voice://transcript — a legacy { text, is_final } payload or a delivery
//                         carrying stable identity + recognizer metadata
//   voice://intent     — { kind, text, bpm } a recognised command
// and exposes two commands: `voice_mute(muted)` and `voice_state()` (a one-shot
// snapshot used only on mount).
//
// This hook subscribes to the three events FIRST, then does the single
// `voice_state()` fetch — same ordering as useMetronome: if the fetch went
// first, a status event emitted while it was in flight would land with no
// listener and be dropped. `statusEventArrived` guards the fetch's result so a
// live event always wins over the (possibly stale) snapshot. Every invoke can
// reject when there is no backend (plain `vite` browser dev, or the App smoke
// test that mocks invoke to REJECT) — those rejections are swallowed quietly;
// the voice UI is purely reflective, so a missing backend just means "live".
//
// Invoke arguments are camelCase (Tauri maps `muted` -> the Rust parameter).
// Event PAYLOADs are serde snake_case, so the transcript's `is_final` is
// snake_case to match.
// ---------------------------------------------------------------------------

export type VoiceStatus = "live" | "muted" | "down";

/** Payload of the one-shot `voice_state()` command. */
export interface VoiceStateSnapshot {
  muted: boolean;
  /** Non-null when the pipeline is down; the string is a short reason. */
  down: string | null;
}

/** Payload of a `voice://status` event. */
export interface VoiceStatusEvent {
  state: VoiceStatus;
  reason?: string;
  guidance?: string;
}

/**
 * Payload of a `voice://transcript` event during the native cutover.
 *
 * New emitters may send either the flat source/confidence fields described by
 * the event contract or the domain-native `recognition` object. The installed
 * v1 backend still sends only text + finality, so identity remains optional at
 * this boundary and is normalized below.
 */
export interface VoiceTranscriptEvent {
  text: string;
  is_final: boolean;
  /** The backend's authoritative routing outcome for a final (see delivery). */
  handled?: boolean;
  delivery_id?: string;
  revision?: number;
  source?: VoiceTranscriptSource;
  confidence?: number | null;
  recognition?: {
    source?: VoiceTranscriptSource;
    confidence?: number | null;
  };
}

/** Payload of a `voice://intent` event. */
export interface VoiceIntent {
  kind: string;
  text: string;
  bpm: number | null;
}

/**
 * Collapse the two independent flags into a single display status. `down` beats
 * `muted` beats `live`: a downed pipeline is the most important thing to show,
 * and a muted-but-otherwise-live mic reads as "muted".
 */
export function deriveStatus(muted: boolean, down: boolean): VoiceStatus {
  if (down) return "down";
  if (muted) return "muted";
  return "live";
}

export interface UseVoice {
  /** Derived display status (down beats muted beats live). */
  status: VoiceStatus;
  /** User-facing guidance for a down pipeline (e.g. how to re-enable dictation). */
  downGuidance: string | null;
  /** The most recent recognised intent, or null before any has arrived. */
  lastIntent: VoiceIntent | null;
  /** Latest accepted final transcript. Duplicate/stale deliveries never replace it. */
  acceptedFinalDelivery: VoiceTranscriptDelivery | null;
  /** Deterministic Tier-A parse result for the latest accepted delivery. */
  tierAResult: TierAParseResult | null;
  /** Transport disposition for concise duplicate/stale/invalid feedback. */
  deliveryDisposition: VoiceDeliveryDisposition | null;
  /** Mute/unmute the mic. Optimistically updates local status, then invokes. */
  mute: (muted: boolean) => void;
}

const DEFAULT_TIER_A_CONTEXT: TierAContext = {
  practice_state: "idle",
  metronome_running: false,
  last_attempt_available: false,
  pending_duplicate_attempt: false,
  retention_due: false,
};

function recognitionSource(
  value: VoiceTranscriptSource | undefined,
): VoiceTranscriptSource {
  if (
    value === "typed_input"
    || value === "narrated_replay"
    || value === "macos_speech"
  ) return value;
  return "macos_speech";
}

/** Normalize rich and installed-v1 event shapes without text-based deduping. */
export function normalizeVoiceTranscriptEvent(
  event: VoiceTranscriptEvent,
  legacyDeliveryId: string,
): VoiceTranscriptDelivery {
  const hasIdentityField = event.delivery_id !== undefined
    || event.revision !== undefined;
  const deliveryId = typeof event.delivery_id === "string"
    ? event.delivery_id
    : hasIdentityField
      ? ""
      : legacyDeliveryId;
  const revision = typeof event.revision === "number"
    ? event.revision
    : hasIdentityField
      ? Number.NaN
      : 0;
  const confidence = event.recognition?.confidence !== undefined
    ? event.recognition.confidence
    : event.confidence ?? null;
  return {
    delivery_id: deliveryId,
    revision,
    text: typeof event.text === "string" ? event.text : "",
    is_final: event.is_final === true,
    handled: event.handled === true,
    recognition: {
      source: recognitionSource(event.recognition?.source ?? event.source),
      confidence,
    },
  };
}

export function useVoice(tierAContext: TierAContext = DEFAULT_TIER_A_CONTEXT): UseVoice {
  // The two authoritative flags are held in refs so event/command closures read
  // them without staleness; `status` is the derived value mirrored into React
  // state so the UI re-renders.
  const mutedRef = useRef(false);
  const downRef = useRef(false);
  const deliveryLedgerRef = useRef(createVoiceDeliveryLedger());
  const legacyDeliverySequence = useRef(0);
  const tierAContextRef = useRef(tierAContext);
  tierAContextRef.current = tierAContext;

  const [status, setStatus] = useState<VoiceStatus>("live");
  const [downGuidance, setDownGuidance] = useState<string | null>(null);
  const [lastIntent, setLastIntent] = useState<VoiceIntent | null>(null);
  const [acceptedFinalDelivery, setAcceptedFinalDelivery] =
    useState<VoiceTranscriptDelivery | null>(null);
  const [tierAResult, setTierAResult] = useState<TierAParseResult | null>(null);
  const [deliveryDisposition, setDeliveryDisposition] =
    useState<VoiceDeliveryDisposition | null>(null);

  const syncStatus = useCallback(() => {
    setStatus(deriveStatus(mutedRef.current, downRef.current));
  }, []);

  const applyStatusEvent = useCallback(
    (e: VoiceStatusEvent) => {
      switch (e.state) {
        case "live":
          mutedRef.current = false;
          downRef.current = false;
          setDownGuidance(null);
          break;
        case "muted":
          mutedRef.current = true;
          downRef.current = false;
          setDownGuidance(null);
          break;
        case "down":
          downRef.current = true;
          setDownGuidance(e.guidance ?? null);
          break;
      }
      syncStatus();
    },
    [syncStatus],
  );

  const processDelivery = useCallback((delivery: VoiceTranscriptDelivery) => {
    // The delivery firewall exclusively controls parse/action-facing state.
    const transition = registerVoiceDelivery(deliveryLedgerRef.current, delivery);
    deliveryLedgerRef.current = transition.ledger;
    setDeliveryDisposition(transition.disposition);
    if (
      transition.disposition.kind !== "accepted_new"
      && transition.disposition.kind !== "accepted_revision"
    ) return;

    const parsed = parseTierAIntent(delivery, tierAContextRef.current);
    setTierAResult(parsed);
    if (delivery.is_final) setAcceptedFinalDelivery(delivery);
  }, []);

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    let statusEventArrived = false;

    const track = (un: (() => void) | undefined) => {
      if (!un) return;
      if (alive) unlisteners.push(un);
      else un();
    };

    (async () => {
      try {
        track(
          await listen<VoiceStatusEvent>("voice://status", (e) => {
            statusEventArrived = true;
            if (alive) applyStatusEvent(e.payload);
          }),
        );
        track(
          await listen<VoiceTranscriptEvent>("voice://transcript", (e) => {
            if (!alive) return;
            legacyDeliverySequence.current += 1;
            processDelivery(normalizeVoiceTranscriptEvent(
              e.payload,
              `legacy-${legacyDeliverySequence.current}`,
            ));
          }),
        );
        track(
          await listen<VoiceIntent>("voice://intent", (e) => {
            if (alive) setLastIntent(e.payload);
          }),
        );
      } catch {
        // No event bus (browser dev) — optimistic mute updates still drive the UI.
      }

      try {
        const snap = await invoke<VoiceStateSnapshot>("voice_state");
        // A live status event always wins over the one-shot snapshot.
        if (alive && snap && !statusEventArrived) {
          mutedRef.current = !!snap.muted;
          downRef.current = snap.down != null;
          syncStatus();
        }
      } catch {
        // Backend absent / command rejected — swallow quietly, keep "live".
      }
    })();

    return () => {
      alive = false;
      for (const un of unlisteners) un();
    };
  }, [applyStatusEvent, processDelivery, syncStatus]);

  const mute = useCallback(
    (muted: boolean) => {
      mutedRef.current = muted;
      syncStatus();
      // Optimistic; the authoritative voice://status event reconciles. Reject
      // (no backend) is swallowed — the reflected status is best-effort.
      void invoke("voice_mute", { muted }).catch(() => {});
    },
    [syncStatus],
  );

  return {
    status,
    downGuidance,
    lastIntent,
    acceptedFinalDelivery,
    tierAResult,
    deliveryDisposition,
    mute,
  };
}
