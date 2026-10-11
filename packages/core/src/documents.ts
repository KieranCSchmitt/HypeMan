/** Uploaded PDFs stay local; only requested page text or page images reach analysis. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_CHUNK_BYTES = 256 * 1024;
export const MAX_DOCUMENT_PAGE_TEXT = 40_000;
export const MAX_DOCUMENT_CONTEXT_TEXT = 80_000;
export interface DocumentMetadata {
  id: string;
  conversationId: string;
  name: string;
  size: number;
  createdAt: number;
  status: "stored" | "ready" | "locked" | "error";
  pageCount?: number;
  error?: string;
}
export interface DocumentPage {
  documentId: string;
  page: number;
  text: string;
  truncated: boolean;
  method: "embedded" | "vision";
}
export interface DocumentCitation {
  artifactId: string;
  page: number;
  quote?: string;
}
export interface DocumentAnalysisRequest {
  artifactId: string;
  title: string;
  pageCount: number;
  question: string;
  pages: { page: number; text: string; truncated?: boolean }[];
  selection?: { page: number; quote: string };
  /** A single requested page, never the original PDF or an arbitrary remote URL. */
  image?: string;
  imagePage?: number;
}
export interface DocumentAnalysisReply {
  text: string;
  citations: DocumentCitation[];
  coveredPages: number[];
  partial: boolean;
  provider: string;
  /** At least one supplied physical page was cut at the extraction/context boundary. */
  truncated?: boolean;
  basis?: "page summaries";
  documents?: { artifactId: string; title: string; pageCount: number; coveredPages: number[]; partial: boolean }[];
}
