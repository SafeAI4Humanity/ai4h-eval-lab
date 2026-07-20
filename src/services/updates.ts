import packageMetadata from "../../package.json";
import { appFetch, readJson } from "./http";
import { isTauri } from "./storage";

const latestReleaseUrl = "https://api.github.com/repos/SafeAI4Humanity/ai4h-eval-lab/releases/latest";

export const currentAppVersion = packageMetadata.version;

export type AppRelease = {
  tagName: string;
  version: string;
  name: string;
  url: string;
  publishedAt: string;
};

export type AppUpdateState =
  | { status: "idle" | "checking"; currentVersion: string }
  | { status: "current" | "available"; currentVersion: string; release: AppRelease }
  | { status: "error"; currentVersion: string; error: string };

type ParsedVersion = { core: [number, number, number]; prerelease: string[] };

function parseVersion(value: string): ParsedVersion {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Invalid application version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? []
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) > Number(bPart) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

export function parseGitHubRelease(payload: unknown): AppRelease {
  if (!payload || typeof payload !== "object") throw new Error("GitHub returned an invalid release record.");
  const release = payload as Record<string, unknown>;
  const tagName = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
  const name = typeof release.name === "string" && release.name.trim() ? release.name.trim() : tagName;
  const url = typeof release.html_url === "string" ? release.html_url : "";
  const publishedAt = typeof release.published_at === "string" ? release.published_at : "";
  if (!tagName || !url || !publishedAt || release.draft === true || release.prerelease === true) {
    throw new Error("GitHub returned an incomplete or unpublished release record.");
  }
  const version = tagName.replace(/^v/i, "");
  parseVersion(version);
  return { tagName, version, name, url, publishedAt };
}

export async function checkForAppUpdate(installedVersion = currentAppVersion): Promise<{ release: AppRelease; updateAvailable: boolean }> {
  try {
    const response = await appFetch(latestReleaseUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    const release = parseGitHubRelease(await readJson(response));
    return { release, updateAvailable: compareVersions(release.version, installedVersion) > 0 };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not check GitHub Releases. ${detail}`);
  }
}

export async function openReleasePage(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
