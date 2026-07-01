import { AxiosInstance } from "axios";
import * as fs from "fs";
import * as path from "path";
import { DocumentRecord, sanitizeFilename } from "../parsers/documentParser";
import { withRetry, randomDelay } from "../client/httpClient";
import { JsfSession } from "../scrapers/jsfSession";
import { SiteConfig } from "../config/sites";
import { env } from "../config/env";

const FORM_ID = "listarDetalleInfraccionRAAForm";

export interface DownloadResult {
  record: DocumentRecord;
  success: boolean;
  filePath: string | null;
  error: string | null;
}

export function ensureDownloadDir(): void {
  fs.mkdirSync(env.pdfDir, { recursive: true });
  fs.mkdirSync(env.excelDir, { recursive: true });
}

export async function downloadPdf(
  client: AxiosInstance,
  session: JsfSession,
  site: SiteConfig,
  record: DocumentRecord
): Promise<DownloadResult> {
  if (record.pdfParamUuid === null || record.pdfRowIndex === null) {
    return { record, success: false, filePath: null, error: "Sin params de descarga PDF" };
  }

  const filename = `${sanitizeFilename(record.nroResolucion || record.nro)}.pdf`;
  const filePath = path.join(env.pdfDir, filename);

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    console.log(`  [SKIP] Ya existe: ${filename}`);
    return { record, success: true, filePath, error: null };
  }

  await randomDelay();

  const result = await withRetry(async () => {
    const response = await client.post(
      site.path,
      buildPdfPayload(session.viewState, record),
      {
        responseType: "stream",
        headers: {
          // POST no-AJAX: sin Faces-Request ni X-Requested-With — verificado en HAR
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: session.siteUrl,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Upgrade-Insecure-Requests": "1",
        },
        maxRedirects: 5,
      }
    );

    const contentType = (response.headers["content-type"] as string) ?? "";
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      throw new Error(`Respuesta no es PDF: Content-Type=${contentType}`);
    }

    await saveStream(response.data as NodeJS.ReadableStream, filePath);
    return filePath;
  }, `downloadPdf(${record.nroResolucion})`);

  if (!result) {
    return { record, success: false, filePath: null, error: "Falló tras todos los reintentos" };
  }

  console.log(`  [PDF] ${filename}`);
  return { record, success: true, filePath: result, error: null };
}

// Payload POST para descarga de PDF — verificado en HAR real:
// Incluye el form base + {dt:{rowIndex}:j_idt63} + param_uuid del onclick
function buildPdfPayload(viewState: string, record: DocumentRecord): URLSearchParams {
  const p = new URLSearchParams();
  p.append(FORM_ID, FORM_ID);
  p.append(`${FORM_ID}:txtNroexp`, "");
  p.append(`${FORM_ID}:j_idt21`, "");
  p.append(`${FORM_ID}:j_idt25`, "");
  p.append(`${FORM_ID}:idsector`, "");
  p.append(`${FORM_ID}:j_idt34`, "");
  p.append(`${FORM_ID}:dt_scrollState`, "0,0");
  p.append("javax.faces.ViewState", viewState);
  // Identificador del botón de descarga con índice de fila — del onclick de mojarra
  p.append(`${FORM_ID}:dt:${record.pdfRowIndex}:j_idt63`, `${FORM_ID}:dt:${record.pdfRowIndex}:j_idt63`);
  p.append("param_uuid", record.pdfParamUuid!);
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
