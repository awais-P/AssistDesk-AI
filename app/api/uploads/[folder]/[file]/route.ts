import { mimeTypeForStoredFile, readLocalUpload } from "@/src/lib/uploads";

type UploadRouteContext = {
  params: Promise<{
    folder: string;
    file: string;
  }>;
};

export async function GET(_request: Request, context: UploadRouteContext) {
  const { folder, file } = await context.params;
  const content = await readLocalUpload(folder, file);

  if (!content) {
    return new Response("Not found", { status: 404 });
  }

  const mimeType = mimeTypeForStoredFile(file);
  const isImage = mimeType.startsWith("image/");

  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": isImage ? "inline" : `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
