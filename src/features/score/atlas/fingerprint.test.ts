import { describe, expect, it } from "vitest";
import {
  buildEditionFingerprintHashInput,
  type EditionFingerprintInput,
} from "./fingerprint";

const A = "a".repeat(64);
const B = "b".repeat(64);

function input(
  overrides: Partial<EditionFingerprintInput> = {},
): EditionFingerprintInput {
  return {
    schema_version: 1,
    pdf: {
      digest: { algorithm: "sha256", hex: A.toUpperCase() },
      byte_length: 123_456,
      page_count: 18,
    },
    musicxml: {
      digest: { algorithm: "sha256", hex: B },
      measure_count: 780,
      work_identity: "Scherzo No. 2",
    },
    pdf_musicxml_association: "verified_compatible",
    ...overrides,
  };
}

describe("Score Atlas edition fingerprint input", () => {
  it("builds deterministic canonical input from content facts, not file labels", () => {
    const first = buildEditionFingerprintHashInput(input());
    const withForeignDisplayFields = buildEditionFingerprintHashInput({
      ...input(),
      // Runtime callers may carry display metadata, but it cannot enter identity.
      edition_id: "renamed-copy.pdf",
      modified_unix: 999,
    } as EditionFingerprintInput);

    expect(first).toEqual(withForeignDisplayFields);
    expect(first.ok && first.value).toContain(`"hex":"${A}"`);
    expect(first.ok && first.value).not.toContain("renamed-copy.pdf");
  });

  it("changes canonical hash input when actual content identity changes", () => {
    const first = buildEditionFingerprintHashInput(input());
    const second = buildEditionFingerprintHashInput(
      input({
        pdf: {
          digest: { algorithm: "sha256", hex: "c".repeat(64) },
          byte_length: 123_456,
          page_count: 18,
        },
      }),
    );
    expect(first.ok && second.ok && first.value).not.toBe(second.ok && second.value);
  });

  it("keeps scan/XML mismatch explicit instead of claiming compatibility", () => {
    const result = buildEditionFingerprintHashInput(
      input({ pdf_musicxml_association: "known_mismatch" }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toContain('"pdf_musicxml_association":"known_mismatch"');
  });

  it("rejects fake digests and compatibility without an XML source", () => {
    expect(
      buildEditionFingerprintHashInput(
        input({
          pdf: {
            digest: { algorithm: "sha256", hex: "not-a-digest" },
            byte_length: 3,
            page_count: 1,
          },
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid_pdf_digest" });
    expect(
      buildEditionFingerprintHashInput(
        input({ musicxml: undefined, pdf_musicxml_association: "verified_compatible" }),
      ),
    ).toMatchObject({ ok: false, code: "missing_compatible_musicxml" });
  });
});
