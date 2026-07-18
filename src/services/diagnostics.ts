export type DiagnosticLevel = "off" | "error" | "info" | "debug";

export type DiagnosticConfig = {
  level: DiagnosticLevel;
  maxEntries: 100 | 500 | 2000;
};

export type DiagnosticEntry = {
  id: string;
  timestamp: string;
  level: Exclude<DiagnosticLevel, "off">;
  event: string;
  details: Record<string, string | number | boolean | null>;
};

const configKey = "ai4h.diagnostics.config.v1";
const entriesKey = "ai4h.diagnostics.entries.v1";
const changedEvent = "ai4h:diagnostics-changed";
const defaultConfig: DiagnosticConfig = { level: "info", maxEntries: 500 };

const priorities: Record<DiagnosticLevel, number> = {
  off: 0,
  error: 1,
  info: 2,
  debug: 3
};

function read<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Diagnostics must never interfere with evaluations.
  }
}

function announceChange(): void {
  window.dispatchEvent(new CustomEvent(changedEvent));
}

export function redactDiagnosticUrl(input: string): string {
  try {
    const url = new URL(input);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return input.split("?")[0].slice(0, 300);
  }
}

export function redactDiagnosticText(input: string): string {
  return input
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,})\b/g, "[redacted-key]")
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 600);
}

export function getDiagnosticConfig(): DiagnosticConfig {
  const stored = read<Partial<DiagnosticConfig>>(configKey, defaultConfig);
  const level = stored.level && stored.level in priorities ? stored.level : defaultConfig.level;
  const maxEntries = stored.maxEntries === 100 || stored.maxEntries === 2000 ? stored.maxEntries : 500;
  return { level, maxEntries };
}

export function setDiagnosticConfig(config: DiagnosticConfig): void {
  write(configKey, config);
  const entries = getDiagnosticEntries();
  if (entries.length > config.maxEntries) write(entriesKey, entries.slice(-config.maxEntries));
  announceChange();
}

export function getDiagnosticEntries(): DiagnosticEntry[] {
  return read<DiagnosticEntry[]>(entriesKey, []);
}

export function clearDiagnosticEntries(): void {
  write(entriesKey, []);
  announceChange();
}

export function diagnosticLog(
  level: Exclude<DiagnosticLevel, "off">,
  event: string,
  details: Record<string, string | number | boolean | null | undefined> = {}
): void {
  const config = getDiagnosticConfig();
  if (priorities[level] > priorities[config.level]) return;

  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === "string" ? redactDiagnosticText(value) : value ?? null])
  ) as DiagnosticEntry["details"];
  const entries = getDiagnosticEntries();
  entries.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    event,
    details: safeDetails
  });
  write(entriesKey, entries.slice(-config.maxEntries));
  announceChange();
}

export function subscribeToDiagnostics(callback: () => void): () => void {
  window.addEventListener(changedEvent, callback);
  return () => window.removeEventListener(changedEvent, callback);
}

