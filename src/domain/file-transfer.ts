import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { MAX_ATTACHMENTS_PER_MESSAGE } from "../schemas/limits.js";
import type { FileAttachment } from "../schemas/wire.js";

/** Staged and uploaded file names use 8-char id prefixes, mirroring the reference paths. */
const ID_PREFIX_CHARS = 8;
/** Reference spool sweep scans at most 200 entries per pass. */
const SWEEP_BATCH = 200;
/** Receiver-side caps: 30 MiB per file, 16 per message, 1-day spool GC. */
export const MAX_FILE_BYTES = 31_457_280;
export const SPOOL_GC_DAYS = 1;
const MS_PER_DAY = 86_400_000;

export function spoolDir(homeDir: string): string {
  return join(homeDir, ".claude", "file-transfers");
}

export function uploadsDir(homeDir: string, sessionId: string): string {
  return join(homeDir, ".claude", "uploads", sessionId);
}

/** Sanitise a file name the way the reference staging path does. A real basename is never empty, so no empty fallback is needed. */
function safeName(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

/** Stage a file into the spool, returning the wire descriptor. */
export async function stageFile(
  homeDir: string,
  sourcePath: string,
): Promise<FileAttachment> {
  const bytes = await readFile(sourcePath);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `attachment exceeds ${MAX_FILE_BYTES.toString()} bytes: ${sourcePath}`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = spoolDir(homeDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const staged = join(
    dir,
    `${sha256.slice(0, ID_PREFIX_CHARS)}-${randomUUID().slice(0, ID_PREFIX_CHARS)}-${safeName(basename(sourcePath))}`,
  );
  await writeFile(staged, bytes, { mode: 0o600 });
  return {
    path: staged,
    file_name: basename(sourcePath),
    file_size: bytes.byteLength,
    sha256,
  };
}

export interface MaterialisedAttachment {
  uploadPath: string;
  mention: string;
}

/**
 * Receive-side validation and materialisation, mirroring the reference receiver: absolute path, parent must be the spool, regular file, size cap, sha256 integrity, then copy into the receiving session's uploads directory and emit an at-mention for the delivered body prefix.
 */
export async function materialiseAttachment(
  homeDir: string,
  sessionId: string,
  attachment: Readonly<FileAttachment>,
): Promise<MaterialisedAttachment | string> {
  const failure = (reason: string): string =>
    `[SendFile: "${attachment.file_name}" was not delivered — ${reason}]`;
  if (!attachment.path.startsWith("/")) return failure("invalid transfer path");
  const absolute = resolve(attachment.path);
  if (dirname(absolute) !== resolve(spoolDir(homeDir))) {
    return failure("transfer path is outside the file-transfer spool");
  }
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return failure("the transfer copy could not be read (it may have expired)");
  }
  if (!info.isFile()) return failure("the transfer copy is not a regular file");
  const bytes = await readFile(absolute).catch(() => undefined);
  if (bytes === undefined)
    return failure("the transfer copy could not be read (it may have expired)");
  if (
    bytes.byteLength !== attachment.file_size ||
    createHash("sha256").update(bytes).digest("hex") !== attachment.sha256
  ) {
    return failure("it failed integrity verification");
  }
  const dest = join(
    uploadsDir(homeDir, sessionId),
    `${attachment.sha256.slice(0, ID_PREFIX_CHARS)}-${randomUUID().slice(0, ID_PREFIX_CHARS)}-${safeName(attachment.file_name)}`,
  );
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  await copyFile(absolute, dest);
  await unlink(absolute);
  return { uploadPath: dest, mention: `@"${dest}"` };
}

/** Trailing part of buildAttachmentMentions: cap at 16 per message. */
export function capAttachments(attachments: readonly FileAttachment[]): {
  kept: FileAttachment[];
  droppedNote: string | undefined;
} {
  if (attachments.length <= MAX_ATTACHMENTS_PER_MESSAGE) {
    return { kept: [...attachments], droppedNote: undefined };
  }
  const dropped = attachments.length - MAX_ATTACHMENTS_PER_MESSAGE;
  return {
    kept: attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE),
    droppedNote: `[SendFile: ${dropped.toString()} additional attachment(s) were dropped — max ${MAX_ATTACHMENTS_PER_MESSAGE.toString()} per message]`,
  };
}

/** Spool GC: remove staged files older than the retention window. */
export async function sweepSpool(
  homeDir: string,
  nowMs: number,
): Promise<void> {
  const dir = spoolDir(homeDir);
  let names: string[];
  try {
    names = await (await import("node:fs/promises")).readdir(dir);
  } catch {
    return;
  }
  const cutoff = nowMs - SPOOL_GC_DAYS * MS_PER_DAY;
  for (const name of names.slice(0, SWEEP_BATCH)) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile() === true && info.mtimeMs < cutoff) {
      await unlink(path);
    }
  }
}
