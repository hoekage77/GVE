import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = join(currentDir, "..", "..", ".data", "media");

if (!existsSync(MEDIA_DIR)) {
  mkdirSync(MEDIA_DIR, { recursive: true });
}

const MIME_BY_EXTENSION = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime"
};

function normalizeExtension(extension, fallback = "mp4") {
  const normalized = String(extension ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/^\./, "");

  if (/^[a-z0-9]+$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function sanitizeMediaKey(mediaKey) {
  const normalized = basename(String(mediaKey ?? "").trim());
  if (!normalized) {
    return null;
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    return null;
  }

  const extension = extname(normalized).replace(/^\./, "").toLowerCase();
  if (!extension || !MIME_BY_EXTENSION[extension]) {
    return null;
  }

  return normalized;
}

function parseByteRange(rangeHeader, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader ?? "").trim());
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  let start = startRaw ? Number.parseInt(startRaw, 10) : null;
  let end = endRaw ? Number.parseInt(endRaw, 10) : null;

  if (start === null && end === null) {
    return null;
  }

  if (start === null) {
    const suffixLength = Number.isFinite(end) ? end : 0;
    if (suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }

    if (end === null || !Number.isFinite(end) || end >= totalSize) {
      end = totalSize - 1;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalSize) {
    return null;
  }

  return {
    start,
    end
  };
}

function deriveContentType(mediaKey, explicitType = null) {
  if (explicitType && String(explicitType).trim()) {
    return String(explicitType).trim();
  }

  const extension = extname(mediaKey).replace(/^\./, "").toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function compactLabel(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || null;
}

export function buildMediaPreviewUrl(mediaKey) {
  return `/api/v1/media/${mediaKey}`;
}

export function persistMediaArtifact({
  buffer,
  extension = "mp4",
  mediaType = null,
  sessionId = null,
  sceneId = null
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Cannot persist empty media artifact.");
  }

  const normalizedExtension = normalizeExtension(extension, "mp4");
  const parts = [
    compactLabel(sessionId),
    compactLabel(sceneId),
    Date.now().toString(36),
    randomUUID().slice(0, 8)
  ].filter(Boolean);

  const mediaKey = `${parts.join("-")}.${normalizedExtension}`;
  const absolutePath = join(MEDIA_DIR, mediaKey);
  writeFileSync(absolutePath, buffer);

  const sizeBytes = statSync(absolutePath).size;

  return {
    mediaKey,
    mediaType: deriveContentType(mediaKey, mediaType),
    sizeBytes,
    previewUrl: buildMediaPreviewUrl(mediaKey)
  };
}

export function streamMediaArtifact(req, res, mediaKey) {
  const safeMediaKey = sanitizeMediaKey(mediaKey);
  if (!safeMediaKey) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid media key."
    });
    return;
  }

  const absolutePath = join(MEDIA_DIR, safeMediaKey);
  if (!existsSync(absolutePath)) {
    res.status(404).json({
      error: "NOT_FOUND",
      message: "Media artifact not found."
    });
    return;
  }

  const stats = statSync(absolutePath);
  const totalSize = stats.size;
  const contentType = deriveContentType(safeMediaKey);
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const byteRange = parseByteRange(rangeHeader, totalSize);
    if (!byteRange) {
      res.status(416).set({
        "Content-Range": `bytes */${totalSize}`,
        "Accept-Ranges": "bytes"
      }).end();
      return;
    }

    const { start, end } = byteRange;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60"
    });

    const stream = createReadStream(absolutePath, { start, end });
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Length": totalSize,
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=60"
  });

  const stream = createReadStream(absolutePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}
