import { request } from "../bridge";
interface BackupTransfer { transferId: string; size: number; chunkBytes: number; manifest?: unknown }
const abortIfNeeded = (signal?: AbortSignal) => signal?.throwIfAborted();
function bytesFromBase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function base64FromBytes(value: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 8192) binary += String.fromCharCode(...value.subarray(offset, offset + 8192));
  return btoa(binary);
}
/** Shared by chat and Preferences: original documents and durable work use the same export. */
export async function downloadWorkspaceBackup(signal?: AbortSignal) {
  const transfer = await request<BackupTransfer>({ type: "backup.export" }, signal);
  if (!transfer?.transferId || !Number.isSafeInteger(transfer.size) || transfer.size <= 0 || transfer.size > 128 * 1024 * 1024 || !Number.isSafeInteger(transfer.chunkBytes) || transfer.chunkBytes < 1) throw new Error("Invalid backup transfer.");
  try {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < transfer.size;) {
    abortIfNeeded(signal);
    const chunk = await request<{ data: string; offset: number; total: number }>({ type: "backup.read", transferId: transfer.transferId, offset, length: transfer.chunkBytes }, signal);
    const bytes = bytesFromBase64(chunk.data);
    if (chunk.offset !== offset || chunk.total !== transfer.size || !bytes.length || offset + bytes.length > transfer.size) throw new Error("Incomplete backup transfer. Try again.");
    chunks.push(bytes); offset += bytes.length;
  }
  abortIfNeeded(signal);
  const url = URL.createObjectURL(new Blob(chunks, { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `hypeman-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return transfer.manifest;
  } finally { await request({ type: "backup.cancel", transferId: transfer.transferId }).catch(() => {}); }
}
async function chooseBackup(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true }); input.click();
  });
}
export async function restoreWorkspaceBackup(file?: File, signal?: AbortSignal) {
  const selected = file || await chooseBackup();
  if (!selected) return null;
  if (!selected.size || selected.size > 128 * 1024 * 1024) throw new Error("Choose a HypeMan backup smaller than 128 MB.");
  const transfer = await request<{ transferId: string; chunkBytes: number }>({ type: "backup.restore.begin", size: selected.size }, signal);
  if (!transfer.transferId || !Number.isSafeInteger(transfer.chunkBytes) || transfer.chunkBytes < 1) throw new Error("Invalid restore transfer.");
  try {
  let index = 0;
  for (let offset = 0; offset < selected.size; offset += transfer.chunkBytes) {
    abortIfNeeded(signal);
    const bytes = new Uint8Array(await selected.slice(offset, offset + transfer.chunkBytes).arrayBuffer());
    await request({ type: "backup.restore.chunk", transferId: transfer.transferId, index: index++, data: base64FromBytes(bytes) }, signal);
  }
  abortIfNeeded(signal);
  return await request<{ restored: Record<string, number>; skipped: number }>({ type: "backup.restore.complete", transferId: transfer.transferId }, signal);
  } finally { await request({ type: "backup.cancel", transferId: transfer.transferId }).catch(() => {}); }
}
