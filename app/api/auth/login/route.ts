import { NextResponse } from "next/server";

type LoginPayload = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginPayload;
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  const validUsernames = ["admin", "admin@assistdesk.local"];

  if (!email || !password) {
    return NextResponse.json(
      { error: "Please enter both username and password." },
      { status: 400 },
    );
  }

  if (!validUsernames.includes(email) || password !== "admin") {
    return NextResponse.json(
      { error: "Invalid credentials. Use admin / admin for now." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set("assistdesk_session", "demo-admin", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
