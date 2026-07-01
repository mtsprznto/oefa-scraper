export interface SiteConfig {
  readonly key: string;
  readonly path: string;       // path relativo al baseUrl
  readonly label: string;      // nombre legible para logs
  readonly col6Label: string;  // header de la columna 6 (varía entre sitios)
}

export const SITES = {
  dfsai: {
    key: "dfsai",
    path: "/repdig/consulta/consultaDfsai.xhtml",
    label: "Resoluciones DFSAI (sin VPN)",
    col6Label: "Nro. Resolución de Sanción",
  },
  tfa: {
    key: "tfa",
    path: "/repdig/consulta/consultaTfa.xhtml",
    label: "Resoluciones TFA — OEFA",
    col6Label: "Nro. Resolución de Apelación",
  },
} as const satisfies Record<string, SiteConfig>;

export type SiteKey = keyof typeof SITES;

// Configuración inmutable de una ejecución del scraper.
// Agrupa los flags de ejecución junto al sitio para evitar prop-drilling.
export interface ScraperConfig {
  readonly site: SiteConfig;
  readonly maxPages: number | null;  // null = sin límite
  readonly skipPdfs: boolean;
  readonly sessionId?: string;       // aísla logs y checkpoint en data/sessions/{sessionId}/
  readonly startPage?: number;       // fuerza inicio desde página N (override del checkpoint)
}

export function resolveSite(key: string): SiteConfig {
  if (!(key in SITES)) {
    const valid = Object.keys(SITES).join(", ");
    throw new Error(`Sitio desconocido: "${key}". Opciones válidas: ${valid}`);
  }
  return SITES[key as SiteKey];
}
