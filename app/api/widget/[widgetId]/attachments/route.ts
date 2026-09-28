import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { attachmentMimeTypes, storeUpload } from "@/src/lib/uploads";

type WidgetAttachmentRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

export async function POST(request: Request, context: WidgetAttachmentRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!access.chatbot.isActive) {
    return NextResponse.json({ error: "This chat is paused right now." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  }

  try {
    const attachment = await storeUpload({
      file,
      folder: "attachments",
      allowedMimeTypes: attachmentMimeTypes,
      maxBytes: 5 * 1024 * 1024,
    });

    return NextResponse.json({ attachment });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `${error.message} You can attach images, PDF, TXT or DOCX files up to 5 MB.`
            : "Unable to upload this file.",
      },
      { status: 400 },
    );
  }
}
