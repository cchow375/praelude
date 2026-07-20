import { describe, expect, it } from "vitest";
import { parseAssistantDirectedQuestion } from "./assistantDirected";

describe("parseAssistantDirectedQuestion", () => {
  it.each([
    "Can you tell me what happened last session?",
    "Why does this section keep missing?",
    "How should I practice this?",
    "Tell me what I got done yesterday",
    "Help me plan the next twenty minutes",
    "I'm about to diagnose this passage",
    "I want to work on the landing today",
  ])("accepts assistant-directed speech without a wake cue: %s", (text) => {
    expect(parseAssistantDirectedQuestion(text)).toBe(text);
  });

  it.each([
    "the landing is still uneven",
    "that was pretty bad",
    "okay maybe later",
    "confirm",
    "cancel",
    "",
  ])("leaves ambient or control speech inert: %s", (text) => {
    expect(parseAssistantDirectedQuestion(text)).toBeNull();
  });
});
