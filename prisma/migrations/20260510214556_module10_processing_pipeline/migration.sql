-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "chunkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "storagePath" TEXT,
ADD COLUMN     "vectorIndexedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_workspaceId_idx" ON "KnowledgeChunk"("workspaceId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_sourceId_chunkIndex_key" ON "KnowledgeChunk"("sourceId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
