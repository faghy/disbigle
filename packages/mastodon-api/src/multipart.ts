// The type import also loads @fastify/multipart's request augmentation (`isMultipart`, `parts`).
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { body, type FormObject, MastodonError, parseBracketPairs } from './http.ts';

export interface UploadedFile {
  field: string;
  data: Buffer;
  mimetype: string;
  filename: string;
}

async function readFile(part: MultipartFile): Promise<UploadedFile> {
  let data: Buffer;
  try {
    data = await part.toBuffer();
  } catch {
    throw new MastodonError(422, 'Validation failed: File is too large');
  }
  if (part.file.truncated) throw new MastodonError(422, 'Validation failed: File is too large');
  return { field: part.fieldname, data, mimetype: part.mimetype, filename: part.filename };
}

/**
 * Reads a request body that may be multipart (apps upload media and avatars this way, and some
 * send every form as multipart), form-encoded or JSON. Text fields use bracket notation.
 */
export async function readInput(
  request: FastifyRequest,
  limits: { fileSize: number; files: number } = { fileSize: 1, files: 0 },
): Promise<{ fields: FormObject; files: UploadedFile[] }> {
  if (!request.isMultipart()) return { fields: body(request), files: [] };
  const pairs: [string, string][] = [];
  const files: UploadedFile[] = [];
  for await (const part of request.parts({ limits })) {
    if (part.type === 'file') {
      files.push(await readFile(part));
    } else {
      pairs.push([
        part.fieldname,
        typeof part.value === 'string' ? part.value : String(part.value),
      ]);
    }
  }
  return { fields: parseBracketPairs(pairs), files };
}
