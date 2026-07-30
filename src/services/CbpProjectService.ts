import * as fs from "fs";

export interface CbpProjectMetadata {
  targets: string[];
  units: string[];
}

/** Read the small subset of CBP metadata needed by the manager UI. */
export class CbpProjectService {
  private readonly cache = new Map<string, CbpProjectMetadata>();

  read(fsPath: string): CbpProjectMetadata {
    const cached = this.cache.get(fsPath);
    if (cached) {
      return cached;
    }

    const content = fs.readFileSync(fsPath, "utf-8");
    const targets = Array.from(
      content.matchAll(/<Target\b[^>]*\btitle\s*=\s*["']([^"']+)["'][^>]*>/gi),
      (match) => match[1],
    );
    const units = Array.from(
      content.matchAll(/<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>/gi),
      (match) => match[1],
    );
    const metadata = { targets, units };
    this.cache.set(fsPath, metadata);
    return metadata;
  }

  invalidate(fsPath?: string): void {
    if (fsPath) {
      this.cache.delete(fsPath);
    } else {
      this.cache.clear();
    }
  }
}
