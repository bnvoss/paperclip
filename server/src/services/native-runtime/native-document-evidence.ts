import { and, eq } from "drizzle-orm";
import { documents, documentRevisions, issueDocuments, type Db } from "@paperclipai/db";

export function nativeDocumentEvidenceRef(document: { id: string; latestRevisionId: string | null }): string | null {
  return document.latestRevisionId ? `document:${document.id}:${document.latestRevisionId}` : null;
}

/** A persisted revision proves saved output, not acceptance of its content. */
export async function readNativeDocumentEvidence(db: Db, input: { companyId: string; issueId: string; ref: string }) {
  const uuid = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
  const match = new RegExp(`^document:(${uuid}):(${uuid})$`, "i").exec(input.ref);
  if (!match) return null;
  const [row] = await db.select({ id: documentRevisions.id, currentRevisionId: documents.latestRevisionId })
    .from(issueDocuments)
    .innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, input.companyId)))
    .innerJoin(documentRevisions, and(eq(documentRevisions.documentId, documents.id), eq(documentRevisions.companyId, input.companyId)))
    .where(and(eq(issueDocuments.companyId, input.companyId), eq(issueDocuments.issueId, input.issueId),
      eq(documents.id, match[1]!), eq(documentRevisions.id, match[2]!))).limit(1);
  return { revisionId: match[2]!, exists: Boolean(row), current: row?.currentRevisionId === match[2] };
}
