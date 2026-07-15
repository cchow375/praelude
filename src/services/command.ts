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
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function errorRecord(cause: unknown): Record<string, unknown> | null {
  return cause != null && typeof cause === "object"
    ? cause as Record<string, unknown>
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
    nonEmptyString(record?.message)
    ?? nonEmptyString(record?.error)
    ?? fallbackMessage
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
      nonEmptyString(record?.code)
      ?? nonEmptyString(record?.kind)
      ?? "native_command_failed",
    message: commandErrorMessage(cause, fallbackMessage),
    original: cause,
  });
}

const nativeInvoker: CommandInvoker = async (command, args) => (
  args === undefined
    ? invoke(command)
    : invoke(command, args as Record<string, unknown>)
);

export async function executeCommand<Args, Result>(
  definition: CommandDefinition<Args, Result>,
  args: Args,
  invoker: CommandInvoker = nativeInvoker,
): Promise<Result> {
  try {
    return await invoker(definition.name, args) as Result;
  } catch (cause) {
    throw normalizeCommandError(
      definition.name,
      definition.fallbackMessage,
      cause,
    );
  }
}
