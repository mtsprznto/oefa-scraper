import { AxiosInstance } from "axios";
import * as fs from "fs";
import * as path from "path";
import { withRetry, randomDelay } from "../client/httpClient";
import { JsfSession } from "../scrapers/jsfSession";
import { SiteConfig } from "../config/sites";
import { env } from "../config/env";

const FORM_ID = "listarDetalleInfraccionRAAForm";

export interface ExcelDownloadResult {
  success: boolean;
  filePath: string | null;
  error: string | null;
}

// Descarga el Excel con todos los registros del resultado actual.
// Payload verificado en HAR: POST no-AJAX con dt:j_idt38 (ícono verde de la tabla).
// El servidor devuelve application/vnd.ms-excel con filename RESOLUCIONES_APELACION.xls
export async function downloadExcel(
  client: AxiosInstance,
  session: JsfSession,
  site: SiteConfig,
  filename = "RESOLUCIONES_APELACION.xls"
): Promise<ExcelDownloadResult> {
  const filePath = path.join(env.excelDir, filename);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    console.log(`[SKIP] Excel ya existe: ${filename}`);
    return { success: true, filePath, error: null };
  }

  await randomDelay();

  const result = await withRetry(async () => {
    const response = await client.post(
      site.path,
      buildExcelPayload(session.viewState),
      {
        responseType: "stream",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: session.siteUrl,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Upgrade-Insecure-Requests": "1",
        },
        maxRedirects: 5,
      }
    );

    const contentType = (response.headers["content-type"] as string) ?? "";
    if (!contentType.includes("excel") && !contentType.includes("spreadsheet") && !contentType.includes("octet-stream")) {
      throw new Error(`Respuesta no es Excel: Content-Type=${contentType}`);
    }

    await saveStream(response.data as NodeJS.ReadableStream, filePath);
    return filePath;
  }, "downloadExcel");

  if (!result) {
    return { success: false, filePath: null, error: "Falló tras todos los reintentos" };
  }

  console.log(`[EXCEL] Descargado: ${filename}`);
  return { success: true, filePath: result, error: null };
}

// Payload verificado en HAR: mismos campos del form base + dt:j_idt38 (botón Excel)
function buildExcelPayload(viewState: string): URLSearchParams {
  const p = new URLSearchParams();
  p.append(FORM_ID, FORM_ID);
  p.append(`${FORM_ID}:txtNroexp`, "");
  p.append(`${FORM_ID}:j_idt21`, "");
  p.append(`${FORM_ID}:j_idt25`, "");
  p.append(`${FORM_ID}:idsector`, "");
  p.append(`${FORM_ID}:j_idt34`, "");
  p.append(`${FORM_ID}:dt_scrollState`, "0,0");
  p.append("javax.faces.ViewState", viewState);
  p.append(`${FORM_ID}:dt:j_idt38`, `${FORM_ID}:dt:j_idt38`);
  return p;
}

function saveStream(stream: NodeJS.ReadableStream, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    stream.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", (err) => {
      fs.unlink(filePath, () => undefined);
      reject(err);
    });
  });
}
