import { loadProgress, loadRecords, loadFailedDownloads, printSummary } from "./storage/stateManager";
import { env } from "./config/env";
import * as fs from "fs";
import * as path from "path";

const progress = loadProgress(env.targetSite);

if (!progress) {
  console.log("[INFO] Sin checkpoint guardado. Correr `pnpm start` para comenzar.");
  process.exit(0);
}

printSummary(progress);

// Mostrar PDFs descargados
const downloads = fs.existsSync(env.downloadDir)
  ? fs.readdirSync(env.downloadDir).filter((f) => f.endsWith(".pdf"))
  : [];
console.log(`\nPDFs en disco: ${downloads.length}`);

// Mostrar últimos 5 registros
const records = loadRecords();
if (records.length > 0) {
  console.log(`\nÚltimos 3 registros:`);
  records.slice(-3).forEach((r) => {
    console.log(`  [${r.nro}] ${r.nroResolucion} — ${r.administrado.substring(0, 40)}`);
  });
}

// Mostrar fallidos si hay
const failed = loadFailedDownloads();
if (failed.length > 0) {
  console.log(`\nPDFs fallidos (${failed.length}):`);
  failed.slice(0, 5).forEach((f) => {
    console.log(`  - ${f.record.nroResolucion}: ${f.error}`);
  });
}
