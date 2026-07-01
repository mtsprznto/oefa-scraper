import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSite, SITES } from "../../src/config/sites";

describe("config/sites", () => {
  describe("resolveSite()", () => {
    it("retorna config de dfsai", () => {
      const site = resolveSite("dfsai");
      expect(site.key).toBe("dfsai");
      expect(site.path).toBe("/repdig/consulta/consultaDfsai.xhtml");
      expect(site.label).toBeTruthy();
    });

    it("retorna config de tfa", () => {
      const site = resolveSite("tfa");
      expect(site.key).toBe("tfa");
      expect(site.path).toBe("/repdig/consulta/consultaTfa.xhtml");
      expect(site.label).toBeTruthy();
    });

    it("lanza error para sitio desconocido", () => {
      expect(() => resolveSite("invalido")).toThrowError(
        /Sitio desconocido: "invalido"/
      );
    });

    it("mensaje de error incluye opciones válidas", () => {
      expect(() => resolveSite("xyz")).toThrowError(/dfsai.*tfa|tfa.*dfsai/);
    });
  });

  describe("SITES constant", () => {
    it("tiene exactamente dos sitios", () => {
      expect(Object.keys(SITES)).toHaveLength(2);
    });

    it("todos los sitios tienen path con /repdig/consulta/", () => {
      for (const site of Object.values(SITES)) {
        expect(site.path).toMatch(/^\/repdig\/consulta\//);
      }
    });
  });

  describe("config/env", () => {
    // Guardar y restaurar para no contaminar otros tests
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
      originalEnv = {
        BASE_URL: process.env["BASE_URL"],
        TARGET_SITE: process.env["TARGET_SITE"],
        DELAY_MIN_MS: process.env["DELAY_MIN_MS"],
        DELAY_MAX_MS: process.env["DELAY_MAX_MS"],
      };
      // Resetear caché de módulos para que env.ts re-evalúe process.env
      vi.resetModules();
    });

    afterEach(() => {
      for (const [k, v] of Object.entries(originalEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.resetModules();
    });

    it("env tiene baseUrl por defecto", async () => {
      delete process.env["BASE_URL"]; // forzar default
      const { env } = await import("../../src/config/env");
      expect(env.baseUrl).toMatch(/^https?:\/\//);
    });

    it("env tiene directorios definidos", async () => {
      const { env } = await import("../../src/config/env");
      expect(env.downloadDir).toBeTruthy();
      expect(env.pdfDir).toBeTruthy();
      expect(env.dataDir).toBeTruthy();
    });
  });
});
