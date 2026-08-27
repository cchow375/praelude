import type { Verdict } from "../useRep";

export interface RepReplayMeta {
  id: number;
  rep_block_id: number;
  attempt_id: number | null;
  mime_type: string;
  duration_ms: number;
  byte_len: number;
  verdict: Verdict | null;
  created_at: string;
}

export interface RepReplayApi {
  list(repBlockId: number): Promise<RepReplayMeta[]>;
  save(input: {
    rep_block_id: number;
    attempt_id: number;
    mime_type: string;
    duration_ms: number;
    /** Base64 avoids expanding each byte into a multi-character JSON number. */
    bytes_base64: string;
  }): Promise<RepReplayMeta>;
  /** Base64 avoids the very large JSON-number expansion of binary audio. */
  read(id: number): Promise<string>;
  delete(id: number): Promise<void>;
}

export type ReplayPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "review"
  | "saving";

export interface CapturedPianoTake {
  blob: Blob;
  durationMs: number;
}

export interface PianoCapture {
  stop(): void;
  cancel(): void;
  /** Resolves only after every MediaStream track has been stopped. */
  released: Promise<void>;
}

export type PianoCaptureFactory = (
  onFinished: (take: CapturedPianoTake) => void,
  onError: (message: string) => void,
) => Promise<PianoCapture>;

/** Native STT capture ownership supplied by the shell's authoritative voice hook. */
export interface RepReplayCaptureOwnership {
  suspend(requestId: string): Promise<number>;
  resume(requestId: string): Promise<boolean>;
}
