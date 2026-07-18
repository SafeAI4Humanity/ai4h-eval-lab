import { describe, expect, it } from "vitest";
import { redactDiagnosticText, redactDiagnosticUrl } from "./diagnostics";

describe("diagnostic redaction", () => {
  it("removes query strings from logged URLs", () => {
    expect(redactDiagnosticUrl("https://example.test/v1/models?key=secret&mode=full"))
      .toBe("https://example.test/v1/models");
  });

  it("redacts bearer tokens and recognizable API keys", () => {
    expect(redactDiagnosticText("Authorization: Bearer sk-secretvalue123 and sk-anothersecret456"))
      .toBe("Authorization: Bearer [redacted] and [redacted-key]");
  });
});
