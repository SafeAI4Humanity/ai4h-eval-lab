import { describe, expect, it } from "vitest";
import { compareVersions, parseGitHubRelease } from "./updates";

describe("application updates", () => {
  it("compares semantic versions rather than comparing version strings", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.3-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3-beta.10", "1.2.3-beta.2")).toBeGreaterThan(0);
  });

  it("parses a published GitHub release", () => {
    expect(parseGitHubRelease({
      tag_name: "v0.3.0",
      name: "AI4H Eval Lab v0.3.0",
      html_url: "https://github.com/SafeAI4Humanity/ai4h-eval-lab/releases/tag/v0.3.0",
      published_at: "2026-07-19T00:00:00Z",
      draft: false,
      prerelease: false
    })).toMatchObject({ version: "0.3.0", tagName: "v0.3.0" });
  });

  it("rejects draft, prerelease, and malformed release records", () => {
    const base = {
      tag_name: "v0.3.0",
      html_url: "https://example.test/release",
      published_at: "2026-07-19T00:00:00Z"
    };
    expect(() => parseGitHubRelease({ ...base, draft: true })).toThrow("unpublished");
    expect(() => parseGitHubRelease({ ...base, prerelease: true })).toThrow("unpublished");
    expect(() => parseGitHubRelease({ ...base, tag_name: "latest" })).toThrow("Invalid application version");
  });
});
