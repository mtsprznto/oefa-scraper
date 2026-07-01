export interface SiteConfig {
  readonly key: string;
  readonly path: string;   // path relativo al baseUrl
  readonly label: string;  // nombre legible para logs
}

export const SITES = {
  dfsai: {
    key: "dfsai",
    path: "/repdig/consulta/consultaDfsai.xhtml",
    label: "Resoluciones DFSAI (sin VPN)",
  },
  tfa: {
    key: "tfa",
    path: "/repdig/consulta/consultaTfa.xhtml",
    label: "Resoluciones TFA — OEFA",
  },
} as const satisfies Record<string, SiteConfig>;

export type SiteKey = keyof typeof SITES;

// Configuración inmutable de una ejecución del scraper.
// Agrupa los flags de ejecución junto al sitio para evitar prop-drilling.
export interface ScraperConfig {
  readonly site: SiteConfig;
  readonly maxPages: number | null;       // null = sin límite
  readonly skipPdfs: boolean;
  readonly sessionId?: string;            // aísla logs y checkpoint en data/sessions/{sessionId}/
  readonly startPage?: number;            // fuerza inicio desde página N (override del checkpoint)
  readonly delayMultiplier: number;       // escala los delays — 1.0=normal, 2.0=doble, 0.5=mitad
}

export function resolveSite(key: string): SiteConfig {
  if (!(key in SITES)) {
    const valid = Object.keys(SITES).join(", ");
    throw new Error(`Sitio desconocido: "${key}". Opciones válidas: ${valid}`);
  }
  return SITES[key as SiteKey];
}
