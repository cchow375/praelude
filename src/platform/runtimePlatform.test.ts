import { describe, expect, it } from "vitest";
import { runtimePlatformFromUserAgent } from "./runtimePlatform";

describe("runtimePlatformFromUserAgent", () => {
  it.each([
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Mozilla/5.0 (Windows NT 10.0; ARM64)",
  ])("recognizes a Windows 10/11 webview user agent", (userAgent) => {
    expect(runtimePlatformFromUserAgent(userAgent)).toBe("windows");
  });

  it.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6)",
    "Mozilla/5.0 (X11; Linux x86_64)",
    "",
  ])("leaves non-Windows and missing user agents generic", (userAgent) => {
    expect(runtimePlatformFromUserAgent(userAgent)).toBe("other");
  });
});
