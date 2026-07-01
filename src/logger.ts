import * as fs from "fs";
import * as path from "path";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx?: Record<string, unknown>;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "\x1b[90m", // gris
  INFO:  "\x1b[36m", // cyan
  WARN:  "\x1b[33m", // amarillo
  ERROR: "\x1b[31m", // rojo
};
const RESET = "\x1b[0m";

let logStream: fs.WriteStream | null = null;

// El path se resuelve en tiempo de escritura (no en importación del módulo)
// para que los tests puedan setear DATA_DIR antes del primer log.
function getLogPath(): string {
  const dataDir = process.env["DATA_DIR"] ?? "./data";
  return path.resolve(dataDir, "scraper.log");
}

function ensureStream(): fs.WriteStream | null {
  if (!logStream) {
    const logPath = getLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const stream = fs.createWriteStream(logPath, { flags: "a" });
    // Absorber errores del stream (ej. directorio borrado mid-test) sin crashear el proceso
    stream.on("error", () => { logStream = null; });
    logStream = stream;
  }
  return logStream;
}

function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx && Object.keys(ctx).length > 0 ? { ctx } : {}),
  };

  // JSONL al archivo — máquina-legible, grep-able (null = directorio aún no existe)
  ensureStream()?.write(JSON.stringify(entry) + "\n");

  // Consola — legible para humanos con color
  const color = LEVEL_COLOR[level];
  const ctxStr = ctx && Object.keys(ctx).length > 0
    ? " " + Object.entries(ctx).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
    : "";
  const prefix = `${color}[${level}]${RESET}`;
  const method = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  method(`${prefix} ${msg}${ctxStr}`);
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write("DEBUG", msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => write("INFO",  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => write("WARN",  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("ERROR", msg, ctx),

  // Cierra el stream al finalizar — evita que el proceso quede colgado
  close(): void {
    logStream?.end();
    logStream = null;
  },

  // Fuerza re-apertura del stream en el próximo write (para tests con DATA_DIR dinámico)
  reset(): void {
    logStream?.destroy();
    logStream = null;
  },
};
