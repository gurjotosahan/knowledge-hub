import { NextRequest, NextResponse } from "next/server";
import { listChildren } from "@/lib/graph/client";
import { resolveGraphSecret } from "@/lib/serverConfig";
import type { GraphConfig } from "@/lib/graph/types";
import type { LocalSourceEntry } from "@/types";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const driveId  = p.get("driveId");
  const itemId   = p.get("itemId") ?? undefined;
  const mockMode = p.get("mockMode") !== "false";

  if (!driveId) return NextResponse.json({ error: "Missing driveId" }, { status: 400 });

  const config: GraphConfig = {
    mockMode,
    driveId,
    tenantId:     p.get("tenantId")     ?? "",
    clientId:     p.get("clientId")     ?? "",
    clientSecret: resolveGraphSecret(),
    siteUrl:      p.get("siteUrl")      ?? "",
  };

  try {
    const items = await listChildren(config, driveId, itemId);

    const entries: LocalSourceEntry[] = items.map((item) => {
      const isFolder = Boolean(item.folder);
      const ext = item.name.split(".").pop()?.toLowerCase();
      const fileType = ext === "pdf" ? "pdf" : ext === "pptx" ? "pptx" : undefined;

      return {
        name: item.name,
        // encode Graph item ID into the path so DocumentBrowser can navigate
        path: `graph:${driveId}:${item.id}`,
        kind: isFolder ? "directory" : "file",
        type: fileType,
        sizeBytes: item.size,
        modifiedAt: item.lastModifiedDateTime,
        webUrl: item.webUrl,
      } satisfies LocalSourceEntry;
    });

    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
