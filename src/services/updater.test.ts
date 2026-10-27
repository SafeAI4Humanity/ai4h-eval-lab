import { describe, expect, it } from "vitest";
import { checkInAppUpdate, normalizeUpdateNotes } from "./updater";

describe("in-app updater", () => {
  it("does not attempt an update check outside the Tauri runtime", async () => {
    expect(await checkInAppUpdate()).toBeNull();
  });

  it("returns the update the checker reports", async () => {
    const calls: string[] = [];
    const update = await checkInAppUpdate(async () => {
      calls.push("checked");
      return {
        version: "0.15.0",
        notes: "Reasoning effort is now a connection setting.",
        downloadAndInstall: async () => {
          calls.push("installed");
        }
      };
    });

    expect(update?.version).toBe("0.15.0");
    expect(calls).toEqual(["checked"]);

    await update?.downloadAndInstall();
    expect(calls).toEqual(["checked", "installed"]);
  });

  it("reports no update when the checker finds none", async () => {
    expect(await checkInAppUpdate(async () => null)).toBeNull();
  });

  it("normalizes missing or padded release notes", () => {
    expect(normalizeUpdateNotes("  notes here \n")).toBe("notes here");
    expect(normalizeUpdateNotes(undefined)).toBe("");
  });
});
