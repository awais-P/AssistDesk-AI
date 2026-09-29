import { requireRole } from "@/src/lib/rbac";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { imageMimeTypes, storeUpload } from "@/src/lib/uploads";

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }


  const forbidden = requireRole(session.user, "MANAGER");


  if (forbidden) {

    return forbidden;

  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
  }

  try {
    const upload = await storeUpload({
      file,
      folder: "avatars",
      allowedMimeTypes: imageMimeTypes,
      maxBytes: 1024 * 1024,
    });

    return NextResponse.json({ url: upload.url });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `${error.message} Use a PNG, JPG, GIF or WebP image up to 1 MB.`
            : "Unable to upload this image.",
      },
      { status: 400 },
    );
  }
}
