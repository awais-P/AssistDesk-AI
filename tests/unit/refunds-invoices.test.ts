import { describe, expect, it } from "vitest";
import { loadOrderInvoice } from "@/src/lib/order-invoices";
import { can, roleHas } from "@/src/lib/permissions";
import { formatMoney } from "@/src/lib/refunds";
import { BUILT_IN_BY_KEY } from "@/src/lib/tools/builtin-tools";

describe("UT-71 refunds and invoices - Module 2 FE-1", () => {
  it("UT-71.01 the AI's refund action asks the customer first and is a write; the invoice action only reads", () => {
    const refund = BUILT_IN_BY_KEY.get("request_refund")!;
    const invoice = BUILT_IN_BY_KEY.get("get_invoice")!;

    expect(refund).toMatchObject({ requiresConfirmation: true, effect: "WRITE" });
    expect(refund.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name)).toEqual(["order_number", "reason"]);
    expect(refund.description).toMatch(/Never say the refund is approved/);
    expect(invoice).toMatchObject({ requiresConfirmation: false, effect: "READ" });
    expect(invoice.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name)).toEqual(["order_number"]);
  });

  it("UT-71.02 only managers and above approve refunds, and a custom role can take it away", () => {
    expect(roleHas("AGENT", "refunds.approve")).toBe(false);
    expect(roleHas("MANAGER", "refunds.approve")).toBe(true);
    expect(roleHas("ADMIN", "refunds.approve")).toBe(true);
    expect(can({ role: "AGENT", customRole: { permissions: ["refunds.approve"], deniedPermissions: [] } }, "refunds.approve")).toBe(true);
    expect(can({ role: "MANAGER", customRole: { permissions: [], deniedPermissions: ["refunds.approve"] } }, "refunds.approve")).toBe(false);
  });

  it("UT-71.03 amounts read naturally, and an unknown amount says so", () => {
    expect(formatMoney(4500, "PKR")).toBe("PKR 4,500");
    expect(formatMoney(19.5, "USD")).toBe("USD 19.5");
    expect(formatMoney(null, null)).toBe("the order amount");
  });

  it("UT-71.04 an invoice link that isn't a well-formed token is refused without a lookup", async () => {
    for (const token of ["", "short", "../../etc/passwd", "a".repeat(65), "has spaces in it 1234567890"]) {
      expect(await loadOrderInvoice(token)).toBeNull();
    }
  });
});
