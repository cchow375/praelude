import {
  defineCommand,
  executeCommand,
  type CommandInvoker,
} from "../../services/command";
import type { MutationReceipt } from "../receipts/ReceiptCenter";
import type {
  RetentionApi,
  RetentionCheckView,
  RetentionResult,
} from "./types";

const RETENTION_DUE = defineCommand<
  { asOfDate: string },
  RetentionCheckView[]
>("retention_due", "Retention checks could not be loaded.");

const RETENTION_SNOOZE = defineCommand<
  { commandId: string; checkId: number; dueDate: string },
  MutationReceipt<RetentionCheckView>
>("retention_snooze", "The retention check could not be snoozed.");

const RETENTION_CONFIRM = defineCommand<
  { commandId: string; checkId: number; result: RetentionResult },
  MutationReceipt<RetentionCheckView>
>("retention_confirm", "The retention result could not be confirmed.");

const RETENTION_LOWER = defineCommand<
  { commandId: string; checkId: number; result: RetentionResult },
  MutationReceipt<RetentionCheckView>
>("retention_lower", "The working condition could not be lowered.");

const RETENTION_REOPEN = defineCommand<
  { commandId: string; checkId: number; result: RetentionResult },
  MutationReceipt<RetentionCheckView>
>("retention_reopen", "The target could not be reopened.");

function run<Args, Result>(
  definition: Parameters<typeof executeCommand<Args, Result>>[0],
  args: Args,
  invoker?: CommandInvoker,
): Promise<Result> {
  return invoker
    ? executeCommand(definition, args, invoker)
    : executeCommand(definition, args);
}

export function createRetentionApi(invoker?: CommandInvoker): RetentionApi {
  return {
    due: (asOfDate) => run(RETENTION_DUE, { asOfDate }, invoker),
    snooze: (commandId, checkId, dueDate) => run(
      RETENTION_SNOOZE,
      { commandId, checkId, dueDate },
      invoker,
    ),
    confirm: (commandId, checkId, result) => run(
      RETENTION_CONFIRM,
      { commandId, checkId, result },
      invoker,
    ),
    lower: (commandId, checkId, result) => run(
      RETENTION_LOWER,
      { commandId, checkId, result },
      invoker,
    ),
    reopen: (commandId, checkId, result) => run(
      RETENTION_REOPEN,
      { commandId, checkId, result },
      invoker,
    ),
  };
}

export const nativeRetentionApi = createRetentionApi();
