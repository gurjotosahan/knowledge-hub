import type JSZip from "jszip";

function attrValue(tag: string, attr: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${attr}=(["'])(.*?)\\1`));
  return match?.[2];
}

function numericSlidePaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((key) => /^ppt\/slides\/slide\d+\.xml$/.test(key))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
}

function normalizePresentationTarget(target: string): string {
  const cleaned = target.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.startsWith("ppt/")) return cleaned;
  if (cleaned.startsWith("../")) return cleaned.replace(/^(\.\.\/)+/, "ppt/");
  return `ppt/${cleaned}`;
}

export async function getOrderedPptxSlidePaths(zip: JSZip): Promise<string[]> {
  const fallback = numericSlidePaths(zip);
  const presentationXml = await zip.files["ppt/presentation.xml"]?.async("text");
  const relsXml = await zip.files["ppt/_rels/presentation.xml.rels"]?.async("text");

  if (!presentationXml || !relsXml) return fallback;

  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = attrValue(tag, "Id");
    const target = attrValue(tag, "Target");
    const type = attrValue(tag, "Type") ?? "";
    if (!id || !target || !/\/slide$/i.test(type)) continue;
    rels.set(id, normalizePresentationTarget(target));
  }

  const ordered = Array.from(presentationXml.matchAll(/<p:sldId\b[^>]*>/g))
    .map((match) => attrValue(match[0], "r:id"))
    .map((id) => (id ? rels.get(id) : undefined))
    .filter((path): path is string => Boolean(path && zip.files[path]));

  if (ordered.length === 0) return fallback;

  const seen = new Set(ordered);
  const leftovers = fallback.filter((path) => !seen.has(path));
  return [...ordered, ...leftovers];
}

export function slideXmlNumberFromPath(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}
