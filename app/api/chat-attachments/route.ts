import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { RATE_LIMITS, consumeRateLimit, tooManyRequests } from "@/src/lib/rate-limit";
import { attachmentMimeTypes, storeUpload } from "@/src/lib/uploads";

const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * A team member attaches a file to a reply in Chats (FR-6.6). Same rules as the widget:
 * images, PDF, TXT or DOCX up to 5 MB. The file is sent with the reply (POST
 * /api/chat-sessions/{id}/messages) as one of its attachments.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limit = await consumeRateLimit(`chat-attachment:${session.user.id}`, RATE_LIMITS.chatAttachmentPerUser);

  if (!limit.allowed) {
    return tooManyRequests(limit, "You're uploading files too quickly.");
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
      maxBytes: MAX_CHAT_ATTACHMENT_BYTES,
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
