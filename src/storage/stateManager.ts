import * as fs from "fs";
import * as path from "path";
import { DocumentRecord } from "../parsers/documentParser";
import { env } from "../config/env";

const recordsFile = () => path.join(env.dataDir, "records.json");
const failedFile = () => path.join(env.dataDir, "failed_downloads.json");
const progressFile = () => path.join(env.dataDir, "progress.json");

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

export function ensureDataDir(): void {
  fs.mkdirSync(env.dataDir, { recursive: true });
}

export function loadProgress(siteKey: string): ScraperProgress | null {
  try {
    if (!fs.existsSync(progressFile())) return null;
    const p = JSON.parse(fs.readFileSync(progressFile(), "utf-8")) as ScraperProgress;
    return p.site === siteKey ? p : null;
  } catch {
    return null;
  }
}

export function saveProgress(progress: ScraperProgress): void {
  progress.updatedAt = new Date().toISOString();
  writeAtomic(progressFile(), JSON.stringify(progress, null, 2));
}

export function loadRecords(): DocumentRecord[] {
  try {
    if (!fs.existsSync(recordsFile())) return [];
    return JSON.parse(fs.readFileSync(recordsFile(), "utf-8")) as DocumentRecord[];
  } catch {
    return [];
  }
}

// Append deduplicado y ordenado por nro.
// Escritura atómica: escribe en .tmp y renombra para evitar corrupción por kill/crash.
export function appendRecords(newRecords: DocumentRecord[]): void {
  const existing = loadRecords();
  const seen = new Set(existing.map(recordKey));
  const deduped = newRecords.filter((r) => !seen.has(recordKey(r)));
  if (deduped.length === 0) return;
  const merged = [...existing, ...deduped].sort(
    (a, b) => parseInt(a.nro, 10) - parseInt(b.nro, 10)
  );
  writeAtomic(recordsFile(), JSON.stringify(merged, null, 2));
}

export function recordFailedDownload(record: DocumentRecord, error: string): void {
  const existing = loadFailedDownloads();
  // Evitar duplicados por nroResolucion
  const alreadyFailed = existing.some((f) => recordKey(f.record) === recordKey(record));
  if (alreadyFailed) return;
  existing.push({ record, error, failedAt: new Date().toISOString() });
  writeAtomic(failedFile(), JSON.stringify(existing, null, 2));
}

export function loadFailedDownloads(): FailedDownload[] {
  try {
    if (!fs.existsSync(failedFile())) return [];
    return JSON.parse(fs.readFileSync(failedFile(), "utf-8")) as FailedDownload[];
  } catch {
    return [];
  }
}

export function printSummary(progress: ScraperProgress): void {
  const records = loadRecords();
  const failed = loadFailedDownloads();
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
