import type { MutationReceipt } from "../receipts/ReceiptCenter";

/** Display-only recursive value; native retention command boundaries are typed. */
export type RetentionJson =
  | null
  | boolean
  | number
  | string
  | readonly RetentionJson[]
  | { readonly [key: string]: RetentionJson };

export interface RetentionCondition {
  readonly bpm?: number | null;
  readonly m_start?: number | null;
  readonly m_end?: number | null;
  readonly hands?: string | null;
  readonly method?: string | null;
  readonly judging_axis?: string | null;
  readonly required_clean_streak?: number | null;
  readonly cold?: boolean | null;
}

export interface RetentionCheckView {
  readonly id: number;
  readonly region_id: number;
  readonly source_set_id: number | null;
  readonly due_date: string;
  readonly original_due_date: string;
  readonly condition: RetentionCondition;
  readonly state: string;
  readonly result: RetentionResult | null;
  readonly completed_ts: string | null;
  readonly created_ts: string;
  readonly updated_ts: string;
}

export type RetentionDecision =
  | "confirm_retained"
  | "lower_working_condition"
  | "reopen_target";

export interface RetentionResult {
  readonly decision: RetentionDecision;
  readonly note: string;
  readonly checked_as_of: string;
  readonly observed_condition?: RetentionCondition | null;
  readonly next_condition?: RetentionCondition | null;
}

export interface RetentionApi {
  due: (asOfDate: string) => Promise<RetentionCheckView[]>;
  snooze: (
    commandId: string,
    checkId: number,
    dueDate: string,
  ) => Promise<MutationReceipt<RetentionCheckView>>;
  confirm: (
    commandId: string,
    checkId: number,
    result: RetentionResult,
  ) => Promise<MutationReceipt<RetentionCheckView>>;
  lower: (
    commandId: string,
    checkId: number,
    result: RetentionResult,
  ) => Promise<MutationReceipt<RetentionCheckView>>;
  reopen: (
    commandId: string,
    checkId: number,
    result: RetentionResult,
  ) => Promise<MutationReceipt<RetentionCheckView>>;
}

export type RetentionMutation = "snooze" | "confirm" | "lower" | "reopen";
