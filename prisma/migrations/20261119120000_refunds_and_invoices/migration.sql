-- Module 2 FE-1: refund requests decided by the team, printable order invoices, refund window.
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'REFUNDED', 'APPROVED', 'DECLINED', 'FAILED');

ALTER TABLE "WorkspaceSetting" ADD COLUMN "refundWindowDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "contactId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "reason" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "externalRefundId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefundRequest_workspaceId_status_createdAt_idx" ON "RefundRequest"("workspaceId", "status", "createdAt");
CREATE INDEX "RefundRequest_workspaceId_orderNumber_idx" ON "RefundRequest"("workspaceId", "orderNumber");
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrderInvoice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderInvoice_token_key" ON "OrderInvoice"("token");
CREATE INDEX "OrderInvoice_workspaceId_orderNumber_idx" ON "OrderInvoice"("workspaceId", "orderNumber");
ALTER TABLE "OrderInvoice" ADD CONSTRAINT "OrderInvoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
