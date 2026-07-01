import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, sleep } from "../../src/client/httpClient";
import axios from "axios";

// ─── sleep ────────────────────────────────────────────────────────────────────

describe("sleep()", () => {
  it("resuelve después del tiempo indicado (aproximado)", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    // Tolerancia ±30ms para entornos lentos
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });

  it("sleep(0) resuelve inmediatamente", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe("withRetry()", () => {
  beforeEach(() => {
    // Mock global de sleep para que los tests no sean lentos
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (fn: TimerHandler) => {
        if (typeof fn === "function") fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retorna el resultado si la función tiene éxito en el primer intento", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, "test");
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reintenta en HTTP 429 y retorna éxito en segundo intento", async () => {
    const error429 = createAxiosError(429);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, "test-429");
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("reintenta en HTTP 503", async () => {
    const error503 = createAxiosError(503);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error503)
      .mockResolvedValueOnce("ok-503");

    const result = await withRetry(fn, "test-503");
    expect(result).toBe("ok-503");
  });

  it("reintenta en HTTP 502", async () => {
    const error502 = createAxiosError(502);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error502)
      .mockResolvedValueOnce("ok-502");

    const result = await withRetry(fn, "test-502");
    expect(result).toBe("ok-502");
  });

  it("429 persistente: agota 4 reintentos y retorna null", async () => {
    const error429 = createAxiosError(429);
    // Falla 5 veces (1 intento + 4 reintentos = longitud de RETRY_DELAYS_MS)
    const fn = vi.fn().mockRejectedValue(error429);

    const result = await withRetry(fn, "persistent-429");
    expect(result).toBeNull();
    // 1 intento inicial + 4 reintentos = 5 llamadas
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("error no-retryable (404): falla inmediatamente sin reintentar", async () => {
    const error404 = createAxiosError(404);
    const fn = vi.fn().mockRejectedValue(error404);

    const result = await withRetry(fn, "test-404");
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1); // sin reintentos
  });

  it("error no-HTTP: falla inmediatamente sin reintentar", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Network Error"));

    const result = await withRetry(fn, "test-network");
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retorna null si la función nunca resuelve (agota todos los intentos)", async () => {
    const error429 = createAxiosError(429);
    const fn = vi.fn().mockRejectedValue(error429);

    const result = await withRetry(fn, "exhausted");
    expect(result).toBeNull();
  });

  it("retorna el resultado tipado correctamente", async () => {
    const fn = vi.fn().mockResolvedValue({ data: "test", count: 42 });
    const result = await withRetry(fn, "typed");
    expect(result).toEqual({ data: "test", count: 42 });
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function createAxiosError(status: number): ReturnType<typeof axios.isAxiosError> {
  const error = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  error.isAxiosError = true;
  error.response = { status };
  // axios.isAxiosError checks for this flag
  Object.setPrototypeOf(error, (axios.AxiosError || Error).prototype);
  return error as never;
}
