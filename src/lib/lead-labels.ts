/**
 * Human-readable labels and badge styles for leads (Module 8). Client-safe: no server
 * imports, so the Leads list and lead detail client components can share them.
 */

export const leadTemperatureLabels: Record<string, string> = {
  HOT: "Hot",
  WARM: "Warm",
  COLD: "Cold",
};

export const leadEventLabels: Record<string, string> = {
  CREATED: "Lead captured",
  UPDATED: "Returned / updated",
  STATUS_CHANGED: "Status changed",
  ASSIGNED: "Owner changed",
  EDITED: "Details edited",
  NOTE: "Note",
  NOTIFIED: "Team notified",
  NOTIFY_FAILED: "Notification failed",
  WEBHOOK_DELIVERED: "Sent to webhook",
  WEBHOOK_FAILED: "Webhook failed",
  WEBHOOK_RESENT: "Sent again",
};

export const webhookDeliveryStatusLabels: Record<string, string> = {
  PENDING: "Pending",
  RETRYING: "Retrying",
  SUCCESS: "Delivered",
  FAILED: "Failed",
};

export function leadStatusBadgeClass(status: string) {
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold";

  if (status === "NEW") {
    return `${base} bg-sky-500/15 text-sky-200`;
  }

  if (status === "CONTACTED") {
    return `${base} bg-violet-500/15 text-violet-200`;
  }

  if (status === "QUALIFIED") {
    return `${base} bg-amber-500/15 text-amber-200`;
  }

  if (status === "CONVERTED") {
    return `${base} bg-emerald-500/15 text-emerald-200`;
  }

  return `${base} bg-white/10 text-slate-300`;
}

export function leadTemperatureBadgeClass(temperature: string) {
  const base =
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums";

  if (temperature === "HOT") {
    return `${base} border-orange-500/40 bg-red-500/15 text-orange-200`;
  }

  if (temperature === "WARM") {
    return `${base} border-amber-500/30 bg-amber-500/10 text-amber-200`;
  }

  return `${base} border-slate-500/30 bg-slate-500/10 text-slate-300`;
}

export function leadSourceBadgeClass() {
  return "inline-flex items-center rounded-lg border border-white/10 bg-[#111111] px-2 py-0.5 text-[11px] font-medium text-slate-200";
}

export function leadEventDotClass(type: string) {
  if (type === "NOTIFY_FAILED" || type === "WEBHOOK_FAILED") {
    return "bg-red-400";
  }

  if (type === "CREATED" || type === "WEBHOOK_DELIVERED" || type === "NOTIFIED") {
    return "bg-emerald-400";
  }

  if (type === "STATUS_CHANGED" || type === "ASSIGNED") {
    return "bg-sky-400";
  }

  if (type === "NOTE") {
    return "bg-amber-400";
  }

  if (type === "UPDATED" || type === "EDITED" || type === "WEBHOOK_RESENT") {
    return "bg-violet-400";
  }

  return "bg-slate-500";
}

export function webhookDeliveryBadgeClass(status: string) {
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold";

  if (status === "SUCCESS") {
    return `${base} bg-emerald-500/15 text-emerald-200`;
  }

  if (status === "RETRYING") {
    return `${base} bg-amber-500/15 text-amber-200`;
  }

  if (status === "FAILED") {
    return `${base} bg-red-500/15 text-red-200`;
  }

  return `${base} bg-white/10 text-slate-300`;
}

/** What to call a lead when the customer did not give a name. */
export function leadDisplayName(lead: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  return lead.name || lead.email || lead.phone || "Unnamed lead";
}
