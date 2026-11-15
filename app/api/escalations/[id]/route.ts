import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { ESCALATION_OUTCOMES, type EscalationOutcome, EscalationError, acceptEscalation, assignEscalation, resolveEscalation } from "@/src/lib/escalation";
import { listEscalations } from "@/src/lib/escalation-queries";
import { generateEscalationSummary } from "@/src/lib/escalation-summary";
import { prisma } from "@/src/lib/prisma";
import { hasRole, requireRole } from "@/src/lib/rbac";

type RouteContext = { params: Promise<{ id: string }> };

async function load(workspaceId: string, userId: string, id: string) {
  const [item] = await listEscalations({ workspaceId, userId, ids: [id] });
  return item ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const item = await load(session.user.workspaceId, session.user.id, id);
  return item ? NextResponse.json({ escalation: item }) : NextResponse.json({ error: "Escalation not found." }, { status: 404 });
}

type ActionBody = {
  action?: unknown;
  assigneeId?: unknown;
  outcome?: unknown;
  note?: unknown;
  keepWithTeam?: unknown;
  force?: unknown;
};

/**
 * Escalation actions: accept (take it from the queue; taking it from a colleague needs
 * Manager), assign (Manager), resolve (hand back to the AI, close the conversation, or
 * keep it with the team) and summarize (write the hand-over brief again).
 */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as ActionBody;
  const { workspaceId } = session.user;
  const actor = { id: session.user.id, fullName: session.user.fullName };

  try {
    switch (body.action) {
      case "accept": {
        const force = body.force === true;
        if (force) {
          const forbidden = requireRole(session.user, "MANAGER");
          if (forbidden) return forbidden;
        }
        await acceptEscalation({ workspaceId, escalationId: id, actor, force });
        break;
      }
      case "assign": {
        const forbidden = requireRole(session.user, "MANAGER");
        if (forbidden) return forbidden;
        if (typeof body.assigneeId !== "string" || !body.assigneeId) {
          return NextResponse.json({ error: "Choose who should handle this escalation." }, { status: 400 });
        }
        await assignEscalation({ workspaceId, escalationId: id, assigneeId: body.assigneeId, actor });
        break;
      }
      case "resolve": {
        if (typeof body.outcome !== "string" || !ESCALATION_OUTCOMES.includes(body.outcome as EscalationOutcome)) {
          return NextResponse.json({ error: "Choose how to resolve: HANDED_BACK, CLOSED or RESOLVED." }, { status: 400 });
        }
        const current = await prisma.escalation.findFirst({ where: { id, workspaceId }, select: { assigneeId: true } });
        // Agents resolve their own escalations; managers can resolve anyone's.
        if (current?.assigneeId && current.assigneeId !== actor.id && !hasRole(session.user.role, "MANAGER")) {
          return NextResponse.json({ error: "Only the team member handling this escalation or a manager can resolve it." }, { status: 403 });
        }
        await resolveEscalation({
          workspaceId,
          escalationId: id,
          actor,
          outcome: body.outcome as EscalationOutcome,
          note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null,
          keepWithTeam: body.keepWithTeam === true,
        });
        break;
      }
      case "summarize": {
        const found = await prisma.escalation.updateMany({ where: { id, workspaceId }, data: { summary: null, summaryGeneratedAt: null } });
        if (found.count === 0) {
          return NextResponse.json({ error: "Escalation not found." }, { status: 404 });
        }
        await generateEscalationSummary(id);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action. Use accept, assign, resolve or summarize." }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof EscalationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json({ escalation: await load(workspaceId, session.user.id, id) });
}
