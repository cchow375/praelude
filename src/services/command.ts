import { invoke } from "@tauri-apps/api/core";

/**
 * Typed description of one native command. Feature modules own the request and
 * response types; this boundary owns invocation and one normalized failure
 * shape.
 */
export interface CommandDefinition<Args, Result> {
  readonly name: string;
  readonly fallbackMessage: string;
  readonly __types?: (args: Args) => Result;
}

export type CommandInvoker = (
  command: string,
  args?: unknown,
) => Promise<unknown>;

export class CommandError extends Error {
  readonly command: string;
  readonly code: string;
  readonly original: unknown;

  constructor({
    command,
    code,
    message,
    original,
  }: {
    command: string;
    code: string;
    message: string;
    original: unknown;
  }) {
    super(message);
    this.name = "CommandError";
    this.command = command;
    this.code = code;
    this.original = original;
  }
}

export function defineCommand<Args, Result>(
  name: string,
  fallbackMessage: string,
): CommandDefinition<Args, Result> {
  return { name, fallbackMessage };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function errorRecord(cause: unknown): Record<string, unknown> | null {
  return cause != null && typeof cause === "object"
    ? (cause as Record<string, unknown>)
    : null;
}

/** Return a safe, non-empty message without ever exposing "[object Object]". */
export function commandErrorMessage(
  cause: unknown,
  fallbackMessage = "The action could not be completed.",
): string {
  if (cause instanceof CommandError) return cause.message;
  if (cause instanceof Error) {
    return nonEmptyString(cause.message) ?? fallbackMessage;
  }
  const direct = nonEmptyString(cause);
  if (direct) return direct;
  const record = errorRecord(cause);
  return (
    nonEmptyString(record?.message) ??
    nonEmptyString(record?.error) ??
    fallbackMessage
  );
}

export function normalizeCommandError(
  command: string,
  fallbackMessage: string,
  cause: unknown,
): CommandError {
  if (cause instanceof CommandError) return cause;
  const record = errorRecord(cause);
  return new CommandError({
    command,
    code:
      nonEmptyString(record?.code) ??
      nonEmptyString(record?.kind) ??
      "native_command_failed",
    message: commandErrorMessage(cause, fallbackMessage),
    original: cause,
  });
}

const nativeInvoker: CommandInvoker = async (command, args) =>
  args === undefined
    ? invoke(command)
    : invoke(command, args as Record<string, unknown>);

export async function executeCommand<Args, Result>(
  definition: CommandDefinition<Args, Result>,
  args: Args,
  invoker: CommandInvoker = nativeInvoker,
): Promise<Result> {
  try {
    return (await invoker(definition.name, args)) as Result;
  } catch (cause) {
    throw normalizeCommandError(
      definition.name,
      definition.fallbackMessage,
      cause,
    );
  }
}

// ---------------------------------------------------------------------------
// Brain + API-key command contracts.
//
// Field shapes mirror the frozen Rust backend exactly (src-tauri/src/brain/
// mod.rs `BrainStatus`/`BrainTestResult`, src-tauri/src/keys `ApiKeyStatus`).
// `brain_status`/`brain_test_connection` shipped in Phase 1. No secret ever
// crosses this boundary in a response.
// ---------------------------------------------------------------------------

export type ApiKeyProvider = "claude" | "gemini";

export interface ApiKeyStatus {
  readonly provider: ApiKeyProvider;
  readonly configured: boolean;
  readonly source: "keychain" | "environment" | "none";
}

/** Truthful, no-network status: `online` = a provider is configured. */
export interface BrainStatus {
  readonly online: boolean;
  readonly provider: string | null;
  readonly reason: string | null;
}

/** Result of a real Brain round-trip (Test connection). */
export interface BrainTestResult {
  readonly ok: boolean;
  readonly provider: string | null;
  readonly model: string | null;
  readonly latency_ms: number | null;
  readonly error: string | null;
}

export const brainStatus = defineCommand<undefined, BrainStatus>(
  "brain_status",
  "Brain status could not be read.",
);

export const brainTestConnection = defineCommand<undefined, BrainTestResult>(
  "brain_test_connection",
  "The connection test could not be completed.",
);

export const apiKeySave = defineCommand<
  { provider: ApiKeyProvider; key: string },
  ApiKeyStatus
>("api_key_save", "The API key could not be saved.");

export const apiKeyClear = defineCommand<
  { provider: ApiKeyProvider },
  ApiKeyStatus
>("api_key_clear", "The API key could not be cleared.");
