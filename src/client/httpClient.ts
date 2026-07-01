import axios, { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { env } from "../config/env";
import { log } from "../logger";

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000]; // backoff exponencial

export function createHttpClient(): AxiosInstance {
  const jar = new CookieJar();
  const instance = axios.create({
    baseURL: env.baseUrl,
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
    },
    maxRedirects: 5,
  });

  // wrapper augmenta axios para que lea 'jar' del config
  const client = wrapper(instance);
  (client.defaults as unknown as { jar: CookieJar }).jar = jar;
  return client;
}

export async function randomDelay(): Promise<void> {
  const ms =
    env.delayMinMs +
    Math.floor(Math.random() * (env.delayMaxMs - env.delayMinMs));
  await sleep(ms);
}

// Reintentos con backoff exponencial + jitter (±25%) para evitar thundering herd.
// Retorna null si se agotan los intentos — el caller decide cómo manejarlo.
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = getHttpStatus(err);
      const isRetryable = status === 429 || status === 503 || status === 502;

      if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`${context} falló`, { status: status ?? "?", error: msg });
        return null;
      }

      const baseDelay = RETRY_DELAYS_MS[attempt];
      const jitter = Math.floor(baseDelay * 0.25 * (Math.random() * 2 - 1));
      const delay = baseDelay + jitter;
      log.warn("Reintento por error HTTP", {
        context,
        status,
        attempt: attempt + 1,
        maxAttempts: RETRY_DELAYS_MS.length,
        delayMs: delay,
      });
      await sleep(delay);
    }
  }
  return null;
}

function getHttpStatus(err: unknown): number | undefined {
  if (axios.isAxiosError(err)) return err.response?.status;
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
