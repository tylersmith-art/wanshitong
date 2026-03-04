import { Paths, File, Directory } from "expo-file-system/next";

const DOWNLOAD_DIR = new Directory(Paths.document, "downloads");

export function ensureDownloadDir(): void {
  if (!DOWNLOAD_DIR.exists) {
    DOWNLOAD_DIR.create();
  }
}

export async function downloadFile(
  url: string,
  filename: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  ensureDownloadDir();
  const file = new File(DOWNLOAD_DIR, filename);

  const response = await fetch(url);
  if (!response.ok) throw new Error("Download failed");

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();

  file.write(new Uint8Array(buffer));

  return file.uri;
}

export function listDownloadedFiles(): string[] {
  ensureDownloadDir();
  const entries = DOWNLOAD_DIR.list();
  return entries.map((entry) => entry.name);
}

export function deleteDownloadedFile(filename: string): void {
  const file = new File(DOWNLOAD_DIR, filename);
  file.delete();
}

export function getFileUri(filename: string): string {
  return new File(DOWNLOAD_DIR, filename).uri;
}
