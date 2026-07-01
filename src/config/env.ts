import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

function requireEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

const downloadDir = path.resolve(requireEnv("DOWNLOAD_DIR", "./downloads"));

export const env = {
  baseUrl: requireEnv("BASE_URL", "https://publico.oefa.gob.pe"),
  targetSite: requireEnv("TARGET_SITE", "dfsai") as "dfsai" | "tfa",
  delayMinMs: parseInt(requireEnv("DELAY_MIN_MS", "1500"), 10),
  delayMaxMs: parseInt(requireEnv("DELAY_MAX_MS", "3500"), 10),
  downloadDir,
  pdfDir: path.join(downloadDir, "pdf"),
  excelDir: path.join(downloadDir, "excel"),
  dataDir: path.resolve(requireEnv("DATA_DIR", "./data")),
} as const;
