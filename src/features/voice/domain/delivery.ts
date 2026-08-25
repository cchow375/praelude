/**
 * Stable identity attached by the speech-delivery boundary.
 *
 * Text is deliberately absent: identical words can describe two genuine,
 * back-to-back attempts. Transport idempotency belongs to this identity, never
 * to a normalized-text timeout.
 */
export interface VoiceDeliveryIdentity {
  readonly delivery_id: string;
  readonly revision: number;
}

export type VoiceTranscriptSource =
  "macos_speech" | "typed_input" | "narrated_replay";

/** Metadata describes speech transcription only; it is never a piano grade. */
export interface VoiceRecognitionMetadata {
  readonly source: VoiceTranscriptSource;
  /** Recognizer confidence when available. Absence must stay explicit. */
  readonly confidence: number | null;
}

export interface VoiceTranscriptDelivery extends VoiceDeliveryIdentity {
  readonly text: string;
  readonly is_final: boolean;
  readonly recognition: VoiceRecognitionMetadata;
  /**
   * The backend's authoritative routing outcome for this final: `true` when a
   * deterministic intent routed and acted, so Lane B must not also draft it.
   * Absent on interim hypotheses and legacy events, which default to unhandled.
   */
  readonly handled?: boolean;
  /**
   * D1 latency instrument: milliseconds from the utterance's FIRST PARTIAL to
   * the action completing (or, for an `Ignored` final, to that decision).
   * This is NOT utterance→action — the Mac's own recognition delay happens
   * upstream of every timestamp the app can see, so it is excluded (see
   * `voice_loop.rs`'s `ActionCtx::take_app_ms`). Absent on interim hypotheses
   * and legacy events.
   */
  readonly app_ms?: number;
}

export type InvalidDeliveryReason =
  | "empty_delivery_id"
  | "delivery_id_too_long"
  | "invalid_revision"
  | "invalid_confidence";

export function validateVoiceDelivery(
  delivery: VoiceTranscriptDelivery,
): InvalidDeliveryReason | null {
  if (delivery.delivery_id.trim() === "") return "empty_delivery_id";
  if (delivery.delivery_id.length > 128) return "delivery_id_too_long";
  if (!Number.isSafeInteger(delivery.revision) || delivery.revision < 0) {
    return "invalid_revision";
  }
  const { confidence } = delivery.recognition;
  if (
    confidence !== null &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    return "invalid_confidence";
  }
  return null;
}

export interface VoiceDeliveryLedger {
  readonly latest_revision_by_delivery_id: ReadonlyMap<string, number>;
}

export function createVoiceDeliveryLedger(): VoiceDeliveryLedger {
  return { latest_revision_by_delivery_id: new Map() };
}

export type VoiceDeliveryDisposition =
  | {
      readonly kind: "accepted_new";
      readonly identity: VoiceDeliveryIdentity;
    }
  | {
      readonly kind: "accepted_revision";
      readonly identity: VoiceDeliveryIdentity;
      readonly previous_revision: number;
    }
  | {
      /** Exact delivery_id + revision replay: safe to return the prior result. */
      readonly kind: "duplicate";
      readonly identity: VoiceDeliveryIdentity;
    }
  | {
      /** Older revision for an already-seen delivery; never execute it. */
      readonly kind: "stale_revision";
      readonly identity: VoiceDeliveryIdentity;
      readonly latest_revision: number;
    }
  | {
      readonly kind: "invalid";
      readonly identity: VoiceDeliveryIdentity;
      readonly reason: InvalidDeliveryReason;
    };

export interface VoiceDeliveryTransition {
  readonly ledger: VoiceDeliveryLedger;
  readonly disposition: VoiceDeliveryDisposition;
}

/**
 * Pure delivery transition. Only an exact identity replay is idempotent.
 * Transcript text is intentionally not consulted.
 */
export function registerVoiceDelivery(
  ledger: VoiceDeliveryLedger,
  delivery: VoiceTranscriptDelivery,
): VoiceDeliveryTransition {
  const identity: VoiceDeliveryIdentity = {
    delivery_id: delivery.delivery_id,
    revision: delivery.revision,
  };
  const invalid = validateVoiceDelivery(delivery);
  if (invalid) {
    return {
      ledger,
      disposition: { kind: "invalid", identity, reason: invalid },
    };
  }

  const latest = ledger.latest_revision_by_delivery_id.get(
    delivery.delivery_id,
  );
  if (latest === delivery.revision) {
    return { ledger, disposition: { kind: "duplicate", identity } };
  }
  if (latest !== undefined && latest > delivery.revision) {
    return {
      ledger,
      disposition: {
        kind: "stale_revision",
        identity,
        latest_revision: latest,
      },
    };
  }

  const revisions = new Map(ledger.latest_revision_by_delivery_id);
  revisions.set(delivery.delivery_id, delivery.revision);
  return {
    ledger: { latest_revision_by_delivery_id: revisions },
    disposition:
      latest === undefined
        ? { kind: "accepted_new", identity }
        : {
            kind: "accepted_revision",
            identity,
            previous_revision: latest,
          },
  };
}
