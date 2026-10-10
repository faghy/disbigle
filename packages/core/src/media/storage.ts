import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Where uploaded files live. Local disk today; an S3-compatible store can implement the same interface. */
export interface MediaStorage {
  put(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
}

export class LocalMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private safePath(path: string): string {
    const full = resolve(join(this.root, path));
    if (!full.startsWith(`${this.root}/`))
      throw new Error(`Refusing path outside media root: ${path}`);
    return full;
  }

  async put(path: string, data: Buffer): Promise<void> {
    const full = this.safePath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async delete(path: string): Promise<void> {
    await rm(this.safePath(path), { force: true });
  }
}
