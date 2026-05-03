import type { GraphConfig, GraphDrive, GraphDriveItem } from "./types";
import {
  MOCK_DRIVES,
  MOCK_ROOT_CHILDREN,
  MOCK_FOLDER_CHILDREN,
  ALL_MOCK_FILES,
} from "./mock";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function getAccessToken(config: GraphConfig): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

// ── Drives ────────────────────────────────────────────────────────────────────

export async function listDrives(
  config: GraphConfig,
  siteId: string
): Promise<GraphDrive[]> {
  if (config.mockMode) return MOCK_DRIVES;
  const token = await getAccessToken(config);
  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/drives`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`listDrives: ${res.status}`);
  const data = await res.json();
  return data.value ?? [];
}

// ── File listing ──────────────────────────────────────────────────────────────

export async function listChildren(
  config: GraphConfig,
  driveId: string,
  itemId?: string
): Promise<GraphDriveItem[]> {
  if (config.mockMode) {
    if (!itemId) return MOCK_ROOT_CHILDREN;
    return MOCK_FOLDER_CHILDREN[itemId] ?? [];
  }

  const token = await getAccessToken(config);
  const path = itemId
    ? `/drives/${driveId}/items/${itemId}/children`
    : `/drives/${driveId}/root/children`;
  const res = await fetch(
    `${GRAPH_BASE}${path}?$select=id,name,size,lastModifiedDateTime,folder,file,webUrl,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`listChildren: ${res.status}`);
  const data = await res.json();
  return data.value ?? [];
}

// ── File download ─────────────────────────────────────────────────────────────

export async function downloadItem(
  config: GraphConfig,
  driveId: string,
  itemId: string
): Promise<Buffer> {
  if (config.mockMode) {
    // Mock returns empty buffer — caller must check mockSlides instead
    return Buffer.alloc(0);
  }
  const token = await getAccessToken(config);
  const res = await fetch(
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    }
  );
  if (!res.ok) throw new Error(`download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── All files (flat, for indexing) ───────────────────────────────────────────

export async function getAllFiles(
  config: GraphConfig,
  driveId: string
): Promise<GraphDriveItem[]> {
  if (config.mockMode) return ALL_MOCK_FILES;

  const token = await getAccessToken(config);
  const files: GraphDriveItem[] = [];

  async function walk(itemId?: string) {
    const children = await listChildrenWithToken(token, driveId, itemId);
    for (const item of children) {
      if (item.folder) {
        await walk(item.id);
      } else if (item.file && /\.(pdf|pptx)$/i.test(item.name)) {
        files.push(item);
      }
    }
  }

  await walk();
  return files;
}

async function listChildrenWithToken(
  token: string,
  driveId: string,
  itemId?: string
): Promise<GraphDriveItem[]> {
  const path = itemId
    ? `/drives/${driveId}/items/${itemId}/children`
    : `/drives/${driveId}/root/children`;
  const res = await fetch(
    `${GRAPH_BASE}${path}?$select=id,name,size,lastModifiedDateTime,folder,file,webUrl,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`listChildren: ${res.status}`);
  const data = await res.json();
  return data.value ?? [];
}
