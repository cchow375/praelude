import type { DomainResult } from "./result";
import { failure, success } from "./result";

export type PdfMusicXmlAssociation =
  | "verified_compatible"
  | "unverified"
  | "known_mismatch";

export interface Sha256Digest {
  algorithm: "sha256";
  /** Lower- or upper-case external digest; canonicalization emits lower-case. */
  hex: string;
}

export interface EditionFingerprintInput {
  schema_version: 1;
  pdf: {
    digest: Sha256Digest;
    byte_length: number;
    page_count: number;
  };
  musicxml?: {
    digest: Sha256Digest;
    measure_count: number;
    work_identity?: string;
  };
  pdf_musicxml_association: PdfMusicXmlAssociation;
}

export type FingerprintInputError =
  | "invalid_schema"
  | "invalid_association"
  | "invalid_pdf_digest"
  | "invalid_pdf_metadata"
  | "invalid_musicxml_digest"
  | "invalid_musicxml_metadata"
  | "missing_compatible_musicxml";

const SHA256_HEX = /^[0-9a-f]{64}$/i;

function validCount(value: number, allowZero: boolean): boolean {
  return (
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value >= 1)
  );
}

function canonicalDigest(digest: Sha256Digest): { algorithm: "sha256"; hex: string } {
  return { algorithm: "sha256", hex: digest.hex.toLowerCase() };
}

/**
 * Builds the exact deterministic byte-hash input for a score edition.
 *
 * This function intentionally does not pretend to hash bytes. The caller must
 * compute real SHA-256 content digests in the trusted file boundary, then hash
 * the returned UTF-8 string if a compact fingerprint is wanted. Paths, mtimes,
 * and display labels are excluded so renaming a byte-identical edition cannot
 * change its content identity.
 */
export function buildEditionFingerprintHashInput(
  input: EditionFingerprintInput,
): DomainResult<string, FingerprintInputError> {
  if (input.schema_version !== 1) {
    return failure("invalid_schema", "Only score-edition fingerprint input version 1 is supported.");
  }
  if (
    !(["verified_compatible", "unverified", "known_mismatch"] as const).includes(
      input.pdf_musicxml_association,
    )
  ) {
    return failure("invalid_association", "The PDF/MusicXML association state is not recognized.");
  }
  if (input.pdf.digest.algorithm !== "sha256" || !SHA256_HEX.test(input.pdf.digest.hex)) {
    return failure("invalid_pdf_digest", "The PDF needs a real 64-character SHA-256 digest.");
  }
  if (!validCount(input.pdf.byte_length, true) || !validCount(input.pdf.page_count, false)) {
    return failure("invalid_pdf_metadata", "PDF byte length and page count must be safe integers.");
  }
  if (input.musicxml) {
    if (
      input.musicxml.digest.algorithm !== "sha256" ||
      !SHA256_HEX.test(input.musicxml.digest.hex)
    ) {
      return failure(
        "invalid_musicxml_digest",
        "MusicXML needs a real 64-character SHA-256 digest.",
      );
    }
    if (!validCount(input.musicxml.measure_count, false)) {
      return failure(
        "invalid_musicxml_metadata",
        "MusicXML measure count must be a positive safe integer.",
      );
    }
  }
  if (input.pdf_musicxml_association === "verified_compatible" && !input.musicxml) {
    return failure(
      "missing_compatible_musicxml",
      "A verified-compatible edition must include the MusicXML content identity.",
    );
  }

  // Property insertion order is deliberately fixed. This is a hash-input
  // contract, not a generic JSON serializer.
  const canonical = {
    schema_version: 1,
    pdf: {
      digest: canonicalDigest(input.pdf.digest),
      byte_length: input.pdf.byte_length,
      page_count: input.pdf.page_count,
    },
    musicxml: input.musicxml
      ? {
          digest: canonicalDigest(input.musicxml.digest),
          measure_count: input.musicxml.measure_count,
          ...(input.musicxml.work_identity?.trim()
            ? { work_identity: input.musicxml.work_identity.trim().normalize("NFC") }
            : {}),
        }
      : null,
    pdf_musicxml_association: input.pdf_musicxml_association,
  };

  return success(`codakiller-score-edition-content-v1\n${JSON.stringify(canonical)}`);
}
