import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import type { AiClient } from "../ai/client.js";

/**
 * Serialise a number[] to the pgvector literal format: '[0.1,0.2,...]'
 */
function toVectorLiteral(embedding: number[]): string {
  return "[" + embedding.join(",") + "]";
}

/**
 * Insert a new memory for a user. The embedding is stored as a pgvector column.
 */
export async function addMemory(
  ai: AiClient,
  userId: string,
  content: string
): Promise<void> {
  const embedding = await ai.embed(content);
  const vectorLiteral = toVectorLiteral(embedding);
  const id = randomUUID();

  // Skip exact (userId, content) duplicates at the statement level so durable
  // facts re-extracted every turn don't accumulate unbounded duplicate rows.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Memory" (id, "userId", content, embedding, "createdAt")
     SELECT $1, $2, $3, $4::vector, now()
     WHERE NOT EXISTS (
       SELECT 1 FROM "Memory" WHERE "userId" = $2 AND content = $3
     )`,
    id,
    userId,
    content,
    vectorLiteral
  );
}

interface MemoryRow {
  content: string;
}

/**
 * Return the top-k most similar memories for a user, ordered by cosine distance.
 */
export async function searchMemories(
  ai: AiClient,
  userId: string,
  query: string,
  k = 5
): Promise<string[]> {
  const embedding = await ai.embed(query);
  const vectorLiteral = toVectorLiteral(embedding);

  const rows = await prisma.$queryRawUnsafe<MemoryRow[]>(
    `SELECT content FROM "Memory"
     WHERE "userId" = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    userId,
    vectorLiteral,
    k
  );

  return rows.map((r) => r.content);
}
