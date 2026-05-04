import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import type { LocalSourceEntry } from "@/types";

const GRAPH = "https://graph.microsoft.com/v1.0";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const token   = (session as Record<string, unknown> | null)?.accessToken as string | undefined;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const itemId = req.nextUrl.searchParams.get("itemId");
  const path   = itemId
    ? `/me/drive/items/${itemId}/children`
    : "/me/drive/root/children";

  try {
    const res  = await fetch(`${GRAPH}${path}?$select=id,name,size,lastModifiedDateTime,folder,file,webUrl`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({ error: err.error?.message ?? `Graph ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    const items: LocalSourceEntry[] = (data.value ?? []).map((item: {
      id: string; name: string; size?: number; lastModifiedDateTime: string;
      folder?: { childCount: number }; file?: { mimeType: string }; webUrl?: string;
    }) => {
      const isFolder = Boolean(item.folder);
      const ext      = item.name.split(".").pop()?.toLowerCase();
      const fileType = ext === "pdf" ? "pdf" : ext === "pptx" ? "pptx" : undefined;
      return {
        name: item.name,
        path: `onedrive:${item.id}`,
        kind: isFolder ? "directory" : "file",
        type: fileType,
        sizeBytes:  item.size,
        modifiedAt: item.lastModifiedDateTime,
        webUrl:     item.webUrl,
      } satisfies LocalSourceEntry;
    });
    return NextResponse.json({ entries: items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
