import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredUpload = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");
export const LOCAL_UPLOAD_URL_PREFIX = "/api/uploads/";

const extensionByMime: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export const imageMimeTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const attachmentMimeTypes = Object.keys(extensionByMime);

export function mimeTypeForStoredFile(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const match = Object.entries(extensionByMime).find(([, value]) => value === extension);
  return match?.[0] ?? "application/octet-stream";
}

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

async function uploadToCloudinary(
  file: File,
  folder: string,
  config: NonNullable<ReturnType<typeof cloudinaryConfig>>,
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const cloudFolder = `assistdesk/${folder}`;
  const signature = createHash("sha1")
    .update(`folder=${cloudFolder}&timestamp=${timestamp}${config.apiSecret}`)
    .digest("hex");
  const form = new FormData();
  form.set("file", file);
  form.set("api_key", config.apiKey);
  form.set("timestamp", timestamp);
  form.set("folder", cloudFolder);
  form.set("signature", signature);

  const resourceType = file.type.startsWith("image/") ? "image" : "raw";
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`,
    { method: "POST", body: form, signal: AbortSignal.timeout(30_000) },
  );
  const data = (await response.json()) as { secure_url?: string; error?: { message?: string } };

  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Cloudinary upload failed.");
  }

  return data.secure_url;
}

/**
 * Stores an uploaded image or attachment. Uses Cloudinary (SRS CON-7) when configured,
 * otherwise saves to local storage and serves it through /api/uploads.
 */
export async function storeUpload({
  file,
  folder,
  allowedMimeTypes,
  maxBytes,
}: {
  file: File;
  folder: "avatars" | "attachments";
  allowedMimeTypes: string[];
  maxBytes: number;
}): Promise<StoredUpload> {
  if (!allowedMimeTypes.includes(file.type)) {
    throw new Error("This file type is not allowed.");
  }

  if (file.size > maxBytes) {
    throw new Error(`Files must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
  }

  const cloudinary = cloudinaryConfig();
  const name = file.name.slice(0, 120) || "file";

  if (cloudinary) {
    return {
      url: await uploadToCloudinary(file, folder, cloudinary),
      name,
      mimeType: file.type,
      size: file.size,
    };
  }

  const fileName = `${randomBytes(16).toString("hex")}.${extensionByMime[file.type]}`;
  const directory = path.join(LOCAL_UPLOAD_ROOT, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, fileName), Buffer.from(await file.arrayBuffer()));

  return {
    url: `${LOCAL_UPLOAD_URL_PREFIX}${folder}/${fileName}`,
    name,
    mimeType: file.type,
    size: file.size,
  };
}

export async function readLocalUpload(folder: string, fileName: string) {
  if (!["avatars", "attachments"].includes(folder) || !/^[a-f0-9]{32}\.[a-z]{3,4}$/.test(fileName)) {
    return null;
  }

  try {
    return await readFile(path.join(LOCAL_UPLOAD_ROOT, folder, fileName));
  } catch {
    return null;
  }
}

/** Only URLs produced by storeUpload are accepted on messages and chatbot avatars. */
export function isTrustedUploadUrl(url: string) {
  if (url.startsWith(LOCAL_UPLOAD_URL_PREFIX)) {
    return /^\/api\/uploads\/(avatars|attachments)\/[a-f0-9]{32}\.[a-z]{3,4}$/.test(url);
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  return Boolean(cloudName && url.startsWith(`https://res.cloudinary.com/${cloudName}/`));
}
