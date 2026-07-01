import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Setup: tmp dir aislado por test ─────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scraper-test-"));
  // Override env.dataDir para apuntar al tmp
  vi.resetModules();
  process.env["DATA_DIR"] = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["DATA_DIR"];
  vi.resetModules();
});

// ─── loadProgress / saveProgress ─────────────────────────────────────────────

describe("loadProgress() / saveProgress()", () => {
  it("retorna null si no existe el archivo", async () => {
    const { loadProgress } = await import("../../src/storage/stateManager");
    expect(loadProgress("dfsai")).toBeNull();
  });

  it("guarda y recarga progreso correctamente", async () => {
    const { saveProgress, loadProgress } = await import("../../src/storage/stateManager");
    const progress = {
      site: "dfsai",
      lastCompletedPage: 5,
      totalPages: 176,
      totalRecords: 1753,
      startedAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    saveProgress(progress);
    const loaded = loadProgress("dfsai");

    expect(loaded).not.toBeNull();
    expect(loaded!.site).toBe("dfsai");
    expect(loaded!.lastCompletedPage).toBe(5);
    expect(loaded!.totalPages).toBe(176);
    expect(loaded!.totalRecords).toBe(1753);
  });

  it("retorna null si el siteKey no coincide", async () => {
    const { saveProgress, loadProgress } = await import("../../src/storage/stateManager");
    const progress = {
      site: "dfsai",
      lastCompletedPage: 5,
      totalPages: 10,
      totalRecords: 100,
      startedAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    saveProgress(progress);
    expect(loadProgress("tfa")).toBeNull();
  });

  it("saveProgress actualiza updatedAt automáticamente", async () => {
    const { saveProgress, loadProgress } = await import("../../src/storage/stateManager");
    const progress = {
      site: "dfsai",
      lastCompletedPage: 1,
      totalPages: 10,
      totalRecords: 100,
      startedAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };

    saveProgress(progress);
    const loaded = loadProgress("dfsai");
    // updatedAt debe ser más reciente que la fecha pasada
    expect(new Date(loaded!.updatedAt).getTime()).toBeGreaterThan(
      new Date("2020-01-01").getTime()
    );
  });

  it("escritura atómica: archivo .tmp no queda después de guardar", async () => {
    const { saveProgress } = await import("../../src/storage/stateManager");
    const progress = {
      site: "dfsai",
      lastCompletedPage: 1,
      totalPages: 10,
      totalRecords: 100,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    saveProgress(progress);
    const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ─── appendRecords ────────────────────────────────────────────────────────────

describe("appendRecords()", () => {
  const makeRecord = (nro: string, expediente: string, resolucion: string) => ({
    nro,
    numeroExpediente: expediente,
    administrado: "Test S.A.",
    unidadFiscalizable: "Planta Test",
    sector: "Pesquería",
    nroResolucion: resolucion,
    pdfRowIndex: null,
    pdfParamUuid: null,
    archivoNombre: null,
  });

  it("guarda registros nuevos", async () => {
    const { appendRecords, loadRecords } = await import("../../src/storage/stateManager");
    const records = [makeRecord("1", "EXP-001", "RES-001")];

    appendRecords(records);
    const loaded = loadRecords();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].nro).toBe("1");
  });

  it("deduplica por expediente|resolución (no agrega el mismo registro dos veces)", async () => {
    const { appendRecords, loadRecords } = await import("../../src/storage/stateManager");
    const record = makeRecord("1", "EXP-001", "RES-001");

    appendRecords([record]);
    appendRecords([record]); // segundo append
    const loaded = loadRecords();
    expect(loaded).toHaveLength(1);
  });

  it("merge: agrega nuevos registros a los existentes", async () => {
    const { appendRecords, loadRecords } = await import("../../src/storage/stateManager");

    appendRecords([makeRecord("1", "EXP-001", "RES-001")]);
    appendRecords([makeRecord("2", "EXP-002", "RES-002")]);
    const loaded = loadRecords();
    expect(loaded).toHaveLength(2);
  });

  it("ordena registros por nro numéricamente", async () => {
    const { appendRecords, loadRecords } = await import("../../src/storage/stateManager");

    appendRecords([
      makeRecord("10", "EXP-010", "RES-010"),
      makeRecord("2", "EXP-002", "RES-002"),
      makeRecord("1", "EXP-001", "RES-001"),
    ]);
    const loaded = loadRecords();
    expect(loaded.map((r) => r.nro)).toEqual(["1", "2", "10"]);
  });

  it("no crashea si no hay registros que agregar (todos duplicados)", async () => {
    const { appendRecords, loadRecords } = await import("../../src/storage/stateManager");
    const record = makeRecord("1", "EXP-001", "RES-001");
    appendRecords([record]);
    appendRecords([]); // vacío
    const loaded = loadRecords();
    expect(loaded).toHaveLength(1);
  });
});

// ─── recordFailedDownload ─────────────────────────────────────────────────────

describe("recordFailedDownload()", () => {
  const makeRecord = (expediente: string, resolucion: string) => ({
    nro: "1",
    numeroExpediente: expediente,
    administrado: "Test",
    unidadFiscalizable: "Test",
    sector: "Test",
    nroResolucion: resolucion,
    pdfRowIndex: 0,
    pdfParamUuid: "uuid-test",
    archivoNombre: "test",
  });

  it("registra un fallo", async () => {
    const { recordFailedDownload, loadFailedDownloads } = await import(
      "../../src/storage/stateManager"
    );
    const record = makeRecord("EXP-001", "RES-001");
    recordFailedDownload(record, "HTTP 404");

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("HTTP 404");
    expect(failed[0].record.nroResolucion).toBe("RES-001");
  });

  it("no duplica fallos por el mismo registro", async () => {
    const { recordFailedDownload, loadFailedDownloads } = await import(
      "../../src/storage/stateManager"
    );
    const record = makeRecord("EXP-001", "RES-001");
    recordFailedDownload(record, "Error 1");
    recordFailedDownload(record, "Error 2"); // mismo registro

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("Error 1"); // guarda el primero
  });

  it("registra múltiples fallos distintos", async () => {
    const { recordFailedDownload, loadFailedDownloads } = await import(
      "../../src/storage/stateManager"
    );
    recordFailedDownload(makeRecord("EXP-001", "RES-001"), "Error A");
    recordFailedDownload(makeRecord("EXP-002", "RES-002"), "Error B");

    const failed = loadFailedDownloads();
    expect(failed).toHaveLength(2);
  });

  it("loadFailedDownloads retorna [] si no existe el archivo", async () => {
    const { loadFailedDownloads } = await import("../../src/storage/stateManager");
    expect(loadFailedDownloads()).toEqual([]);
  });
});

// ─── ensureDataDir ────────────────────────────────────────────────────────────

describe("ensureDataDir()", () => {
  it("crea el dataDir si no existe", async () => {
    const { ensureDataDir } = await import("../../src/storage/stateManager");
    const nestedDir = path.join(tmpDir, "nested", "deep");
    process.env["DATA_DIR"] = nestedDir;
    vi.resetModules();

    const { ensureDataDir: ensureDataDir2 } = await import(
      "../../src/storage/stateManager"
    );
    ensureDataDir2();
    expect(fs.existsSync(nestedDir)).toBe(true);

    // Cleanup
    process.env["DATA_DIR"] = tmpDir;
  });

  it("no lanza si el directorio ya existe", async () => {
    const { ensureDataDir } = await import("../../src/storage/stateManager");
    expect(() => ensureDataDir()).not.toThrow();
    expect(() => ensureDataDir()).not.toThrow(); // segunda llamada
  });
});
