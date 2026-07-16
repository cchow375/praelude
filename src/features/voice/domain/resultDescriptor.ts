import type {
  SelfReportedVerdict,
  TierARejectionReason,
} from "./tierAIntent";

export type VoiceResultTone = "success" | "neutral" | "warning" | "error";

/** Pure rendering/speech contract. Calling TTS is deliberately out of scope. */
export interface VoiceResultDescriptor {
  readonly visible_text: string;
  readonly spoken_text: string;
  readonly aria_label: string;
  readonly aria_live: "polite" | "assertive";
  readonly tone: VoiceResultTone;
}

export type TierAExecutionErrorCode =
  | TierARejectionReason
  | "duplicate_delivery"
  | "stale_revision"
  | "persistence_failed"
  | "command_not_available";

export type TierAExecutionResult =
  | {
      readonly kind: "attempt_recorded";
      readonly attempt_number: number;
      readonly verdict: SelfReportedVerdict;
      readonly streak: number;
      readonly target_streak: number;
    }
  | {
      readonly kind: "attempt_count_reported";
      readonly count: number;
    }
  | {
      readonly kind: "attempt_corrected";
      readonly attempt_number: number;
      readonly from: SelfReportedVerdict;
      readonly to: SelfReportedVerdict;
      readonly streak: number;
      readonly target_streak: number;
    }
  | {
      readonly kind: "attempt_undone";
      readonly attempt_number: number;
      readonly streak: number;
      readonly target_streak: number;
    }
  | {
      readonly kind: "set_restarted";
      readonly preserved_attempts: number;
      readonly target_streak: number;
    }
  | {
      readonly kind: "streak_reset";
      readonly preserved_attempts: number;
      readonly target_streak: number;
    }
  | {
      readonly kind: "set_closed";
      readonly attempts: number;
      readonly mastery_satisfied: boolean;
    }
  | {
      readonly kind: "practice_status";
      readonly attempts: number;
      readonly streak: number;
      readonly target_streak: number;
      readonly bpm: number | null;
    }
  | { readonly kind: "practice_paused"; readonly active_seconds: number }
  | { readonly kind: "practice_resumed"; readonly active_seconds: number }
  | { readonly kind: "safety_stopped" }
  | {
      readonly kind: "metronome_changed";
      readonly running: boolean;
      readonly bpm: number;
    }
  | {
      readonly kind: "tempo_changed";
      readonly bpm: number;
    }
  | {
      readonly kind: "tempo_corrected";
      readonly from_bpm: number;
      readonly to_bpm: number;
    }
  | {
      readonly kind: "last_attempt_reported";
      readonly attempt_number: number;
      readonly verdict: SelfReportedVerdict;
      readonly streak: number;
      readonly target_streak: number;
    }
  | { readonly kind: "possible_duplicate" }
  | {
      readonly kind: "retention_updated";
      readonly action: "confirm" | "lower" | "reopen" | "snooze";
    }
  | { readonly kind: "help" }
  | {
      readonly kind: "rejected";
      readonly code: TierAExecutionErrorCode;
    };

function descriptor(
  text: string,
  tone: VoiceResultTone = "success",
  ariaLive: "polite" | "assertive" = "polite",
): VoiceResultDescriptor {
  return {
    visible_text: text,
    spoken_text: text,
    aria_label: text,
    aria_live: ariaLive,
    tone,
  };
}

function attemptText(
  attempt: number,
  verdict: SelfReportedVerdict,
  streak: number,
  target: number,
): string {
  if (verdict === "clean") {
    return `Attempt ${attempt}: clean. Streak ${streak} of ${target}.`;
  }
  return `Attempt ${attempt}: ${verdict}. Streak reset to ${streak} of ${target}.`;
}

function rejectionText(code: TierAExecutionErrorCode): string {
  switch (code) {
    case "empty_delivery_id":
    case "delivery_id_too_long":
    case "invalid_revision":
    case "invalid_confidence":
      return "Voice delivery data was invalid. Nothing was changed.";
    case "unsafe_numeric_punctuation":
      return "The number sounded ambiguous. Nothing was changed; say the number without a colon.";
    case "invalid_count":
      return "The attempt count was not a complete number. Nothing was recorded.";
    case "count_out_of_range":
      return "Attempt count must be between 1 and 100. Nothing was recorded.";
    case "invalid_tempo":
      return "The tempo was not a complete number. The tempo was not changed.";
    case "tempo_out_of_range":
      return "Tempo must be between 20 and 300 BPM. The tempo was not changed.";
    case "no_active_set":
      return "There is no active practice set. Nothing was recorded.";
    case "practice_paused":
      return "Practice is paused. Resume practice before recording an attempt.";
    case "already_paused":
      return "Practice is already paused. Active time remains stopped.";
    case "already_active":
      return "Practice is already active. Active time is still running.";
    case "no_last_attempt":
      return "There is no last attempt to change. Nothing was changed.";
    case "no_pending_attempt":
      return "There is no pending duplicate attempt to count. Nothing was recorded.";
    case "retention_not_due":
      return "There is no due retention check. Retention was not changed.";
    case "duplicate_delivery":
      return "That exact voice delivery was already handled. Nothing new was recorded.";
    case "stale_revision":
      return "An older voice revision arrived after a newer one. Nothing was changed.";
    case "persistence_failed":
      return "The action could not be saved. Nothing was claimed as recorded.";
    case "command_not_available":
      return "That command is not available in the current practice state. Nothing was changed.";
  }
}

/** Build exact visible, spoken, and screen-reader confirmation wording. */
export function describeTierAResult(
  result: TierAExecutionResult,
): VoiceResultDescriptor {
  switch (result.kind) {
    case "attempt_recorded":
      return descriptor(attemptText(
        result.attempt_number,
        result.verdict,
        result.streak,
        result.target_streak,
      ));
    case "attempt_count_reported":
      return descriptor(
        `Recorded your report of ${result.count} attempts. Quality was not inferred.`,
        "neutral",
      );
    case "attempt_corrected":
      return descriptor(
        `Corrected attempt ${result.attempt_number} from ${result.from} to ${result.to}. Streak ${result.streak} of ${result.target_streak}.`,
      );
    case "attempt_undone":
      return descriptor(
        `Undid attempt ${result.attempt_number}. Streak is ${result.streak} of ${result.target_streak}.`,
      );
    case "set_restarted":
      return descriptor(
        `Restarted the set. ${result.preserved_attempts} prior attempts remain in history; streak is 0 of ${result.target_streak}.`,
        "neutral",
      );
    case "streak_reset":
      return descriptor(
        `Reset the clean streak to 0 of ${result.target_streak}. ${result.preserved_attempts} attempts remain in this set's history.`,
        "neutral",
      );
    case "set_closed":
      return descriptor(
        `Set closed after ${result.attempts} attempts. Mastery ${result.mastery_satisfied ? "was satisfied" : "was not yet satisfied"}.`,
        "neutral",
      );
    case "practice_status": {
      const tempo = result.bpm === null ? "Metronome is off." : `Tempo is ${result.bpm} BPM.`;
      return descriptor(
        `${result.attempts} attempts. Streak ${result.streak} of ${result.target_streak}. ${tempo}`,
        "neutral",
      );
    }
    case "practice_paused":
      return descriptor(
        `Practice paused at ${result.active_seconds} active seconds.`,
        "neutral",
      );
    case "practice_resumed":
      return descriptor(
        `Practice resumed from ${result.active_seconds} active seconds.`,
        "neutral",
      );
    case "safety_stopped":
      return descriptor(
        "Practice stopped for safety. No failed attempt was recorded.",
        "warning",
        "assertive",
      );
    case "metronome_changed":
      return descriptor(
        result.running
          ? `Metronome on at ${result.bpm} BPM.`
          : "Metronome off.",
        "neutral",
      );
    case "tempo_changed":
      return descriptor(`Tempo set to ${result.bpm} BPM.`, "neutral");
    case "tempo_corrected":
      return descriptor(
        `Corrected tempo from ${result.from_bpm} to ${result.to_bpm} BPM.`,
      );
    case "last_attempt_reported":
      return descriptor(
        attemptText(
          result.attempt_number,
          result.verdict,
          result.streak,
          result.target_streak,
        ),
        "neutral",
      );
    case "possible_duplicate":
      return descriptor(
        "Possible duplicate. Nothing new was recorded. Say count that to confirm another attempt.",
        "warning",
      );
    case "retention_updated": {
      const text = {
        confirm: "Retention confirmed. The original due date remains in history.",
        lower: "Retention lowered. The original due date remains in history.",
        reopen: "Target reopened from retention. The original due date remains in history.",
        snooze: "Retention snoozed. This is neutral; the original due date remains in history.",
      }[result.action];
      return descriptor(text, "neutral");
    }
    case "help":
      return descriptor(
        "Try done, again, sloppy, undo last rep, restart streak, restart set, pause practice, resume practice, close set, metronome on, metronome off, set tempo, practice status, or safety stop.",
        "neutral",
      );
    case "rejected":
      return descriptor(rejectionText(result.code), "error", "assertive");
  }
}
