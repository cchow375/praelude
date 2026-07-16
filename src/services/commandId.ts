import type { VoiceDeliveryIdentity } from "../features/voice/domain/delivery";

export const MAX_NATIVE_COMMAND_ID_LENGTH = 200;

let fallbackSequence = 0;

function entropy(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}

/** A fresh identity for a single UI-originated mutation and all of its retries. */
export function createCommandId(operation: string): string {
  const normalized = operation
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  if (normalized === "") throw new Error("operation must contain a command-id-safe character");
  return `ui:${normalized}:${entropy()}`;
}

/** The voice transport identity is the native idempotency identity. */
export function commandIdForVoice(identity: VoiceDeliveryIdentity): string {
  const commandId = `voice:${identity.delivery_id}:r${identity.revision}`;
  if (commandId.length > MAX_NATIVE_COMMAND_ID_LENGTH) {
    throw new Error("voice delivery identity is too long for a native command id");
  }
  return commandId;
}
