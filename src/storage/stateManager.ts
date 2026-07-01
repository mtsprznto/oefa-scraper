import * as fs from "fs";
import * as path from "path";
import { DocumentRecord } from "../parsers/documentParser";
import { env } from "../config/env";

// Helpers de ruta: con sessionId → data/sessions/{id}/, sin sessionId → data/
export function getSessionDir(sessionId?: string): string {
  if (sessionId) return path.join(env.dataDir, "sessions", sessionId);
  return env.dataDir;
}

const recordsFile = (sessionId?: string) => path.join(getSessionDir(sessionId), "records.json");
const failedFile = (sessionId?: string) => path.join(getSessionDir(sessionId), "failed_downloads.json");
const progressFile = (sessionId?: string) => path.join(getSessionDir(sessionId), "progress.json");

export interface ScraperProgress {
  site: string;
  lastCompletedPage: number;
  totalPages: number;
  totalRecords: number;
  startedAt: string;
  updatedAt: string;
}

export interface FailedDownload {
  record: DocumentRecord;
  error: string;
  failedAt: string;
}

export function ensureDataDir(sessionId?: string): void {
  fs.mkdirSync(getSessionDir(sessionId), { recursive: true });
}

export function loadProgress(siteKey: string, sessionId?: string): ScraperProgress | null {
  try {
    const pf = progressFile(sessionId);
    if (!fs.existsSync(pf)) return null;
    const p = JSON.parse(fs.readFileSync(pf, "utf-8")) as ScraperProgress;
    return p.site === siteKey ? p : null;
  } catch {
    return null;
  }
}

export function saveProgress(progress: ScraperProgress, sessionId?: string): void {
  progress.updatedAt = new Date().toISOString();
  const pf = progressFile(sessionId);
  fs.mkdirSync(path.dirname(pf), { recursive: true });
  writeAtomic(pf, JSON.stringify(progress, null, 2));
}

export function loadRecords(sessionId?: string): DocumentRecord[] {
  try {
    const rf = recordsFile(sessionId);
    if (!fs.existsSync(rf)) return [];
    return JSON.parse(fs.readFileSync(rf, "utf-8")) as DocumentRecord[];
  } catch {
    return [];
  }
}

// Append deduplicado y ordenado por nro.
// Escritura atómica: escribe en .tmp y renombra para evitar corrupción por kill/crash.
export function appendRecords(newRecords: DocumentRecord[], sessionId?: string): void {
  const existing = loadRecords(sessionId);
  const seen = new Set(existing.map(recordKey));
  const deduped = newRecords.filter((r) => !seen.has(recordKey(r)));
  if (deduped.length === 0) return;
  const merged = [...existing, ...deduped].sort(
    (a, b) => parseInt(a.nro, 10) - parseInt(b.nro, 10)
  );
  const rf = recordsFile(sessionId);
  fs.mkdirSync(path.dirname(rf), { recursive: true });
  writeAtomic(rf, JSON.stringify(merged, null, 2));
}

export function recordFailedDownload(record: DocumentRecord, error: string, sessionId?: string): void {
  const existing = loadFailedDownloads(sessionId);
  // Evitar duplicados por nroResolucion
  const alreadyFailed = existing.some((f) => recordKey(f.record) === recordKey(record));
  if (alreadyFailed) return;
  existing.push({ record, error, failedAt: new Date().toISOString() });
  const ff = failedFile(sessionId);
  fs.mkdirSync(path.dirname(ff), { recursive: true });
  writeAtomic(ff, JSON.stringify(existing, null, 2));
}

export function loadFailedDownloads(sessionId?: string): FailedDownload[] {
  try {
    const ff = failedFile(sessionId);
    if (!fs.existsSync(ff)) return [];
    return JSON.parse(fs.readFileSync(ff, "utf-8")) as FailedDownload[];
  } catch {
    return [];
  }
}

export function printSummary(progress: ScraperProgress, sessionId?: string): void {
  const records = loadRecords(sessionId);
  const failed = loadFailedDownloads(sessionId);
  const pct = Math.round((progress.lastCompletedPage / progress.totalPages) * 100);
  const W = 42;
  const line = "═".repeat(W);
  const row = (label: string, value: string) =>
    `║  ${(label + ": " + value).padEnd(W - 2)}║`;

  console.log(`\n╔${line}╗`);
  console.log(`║  ${"CHECKPOINT — " + progress.site.toUpperCase()}${" ".repeat(W - 16 - progress.site.length)}║`);
  console.log(`╠${line}╣`);
  console.log(row("Páginas", `${progress.lastCompletedPage}/${progress.totalPages} (${pct}%)`));
  console.log(row("Registros", `${records.length}/${progress.totalRecords}`));
  console.log(row("PDFs fallidos", String(failed.length)));
  console.log(row("Inicio", progress.startedAt.substring(0, 19)));
  console.log(row("Último", progress.updatedAt.substring(0, 19)));
  console.log(`╚${line}╝`);
}

// Escritura atómica: .tmp → rename, evita JSON corrupto si el proceso muere a mitad
function writeAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

function recordKey(r: DocumentRecord): string {
  return `${r.numeroExpediente}|${r.nroResolucion}`;
}
