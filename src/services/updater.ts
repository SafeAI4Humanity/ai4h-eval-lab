import { isTauri } from "./storage";

export type InAppUpdate = {
  version: string;
  notes: string;
  downloadAndInstall: () => Promise<void>;
};

export type InAppUpdateChecker = () => Promise<InAppUpdate | null>;

export function normalizeUpdateNotes(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function checkInAppUpdate(
  checker: InAppUpdateChecker | null = null
): Promise<InAppUpdate | null> {
  if (checker) return checker();
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: normalizeUpdateNotes(update.body),
    downloadAndInstall: () => update.downloadAndInstall()
  };
}
