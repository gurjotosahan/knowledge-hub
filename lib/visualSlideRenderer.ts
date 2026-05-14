import type { PptSlideDraft, PptSlideStyle } from "@/types/ppt-intelligence";

type SlideStyle = PptSlideStyle;
export type VisualSlideInput = PptSlideDraft;

const W = 1600;
const H = 900;
const FONT = "Arial, Aptos, Helvetica, sans-serif";

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrap(text: unknown, maxChars: number, maxLines: number): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
    if (out.length >= maxLines) break;
  }
  if (line && out.length < maxLines) out.push(line);
  return out;
}

function textBlock(
  value: unknown,
  x: number,
  y: number,
  opts: { size: number; weight?: number; fill?: string; maxChars: number; maxLines: number; lh?: number; anchor?: "start" | "middle" }
): string {
  const lh = opts.lh ?? opts.size * 1.18;
  return wrap(value, opts.maxChars, opts.maxLines)
    .map((line, i) => `<text x="${x}" y="${y + i * lh}" font-size="${opts.size}" font-weight="${opts.weight ?? 500}" fill="${opts.fill ?? "#ffffff"}" text-anchor="${opts.anchor ?? "start"}">${esc(line)}</text>`)
    .join("");
}

function pill(x: number, y: number, w: number, h: number, fill: string, label: unknown, color = "#fff", size = 22): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}"/><text x="${x + w / 2}" y="${y + h * 0.66}" font-size="${size}" font-weight="800" fill="${color}" text-anchor="middle">${esc(label)}</text>`;
}

function labelFromHint(hint: string): string {
  return hint
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

function darkTechnical(s: VisualSlideInput): string {
  const bullets = (s.pillars?.length ? s.pillars.map((p) => `${p.title}: ${p.body}`) : s.bullets ?? []).filter(Boolean).slice(0, 6);
  const cards = bullets.slice(0, 3);
  const side = bullets.slice(3, 6).length ? bullets.slice(3, 6) : ["Realistic user flows", "Production-like data", "Monitoring feedback"];
  const hints = (s.design?.iconHints?.length ? s.design.iconHints : ["stability", "scalability", "experience", "reliability"]).slice(0, 4).map(labelFromHint);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#070b14"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0a1020" opacity=".75"/>
    <path d="M0 732 C260 650 430 714 660 668 C920 616 1080 744 1600 648 L1600 900 L0 900 Z" fill="#10234b" opacity=".42"/>
    <path d="M0 804 C380 728 620 790 858 740 C1135 684 1320 796 1600 728 L1600 900 L0 900 Z" fill="#1a376d" opacity=".30"/>
    ${textBlock(s.title || "Slide title", 70, 116, { size: 46, weight: 900, maxChars: 49, maxLines: 2 })}
    ${pill(86, 250, 260, 54, "#f8fafc", "Key Focus Areas", "#111827", 22)}
    ${hints.map((hint, i) => {
      const x = 405 + i * 275;
      return `<circle cx="${x}" cy="276" r="34" fill="none" stroke="#f8fafc" stroke-width="5"/>
        <text x="${x}" y="288" font-size="29" font-weight="900" fill="#f8fafc" text-anchor="middle">${esc(hint.slice(0, 1).toUpperCase())}</text>
        ${textBlock(hint, x + 58, 269, { size: 25, weight: 900, maxChars: 14, maxLines: 1 })}
        <text x="${x + 58}" y="302" font-size="17" fill="#cbd5e1">${i === 0 ? "At various loads" : i === 1 ? "Growth aligned" : i === 2 ? "Seamless" : "Across times"}</text>
        ${i ? `<line x1="${x - 42}" y1="232" x2="${x - 42}" y2="322" stroke="#f8fafc" stroke-width="4"/>` : ""}`;
    }).join("")}
    <line x1="120" y1="366" x2="1480" y2="366" stroke="#dbe4f0" stroke-width="1.5" opacity=".65"/>
    <text x="800" y="412" font-size="29" font-weight="900" fill="#ffffff" text-anchor="middle">${esc((s.kicker || "Strategic capabilities").toUpperCase())}</text>
    ${cards.map((item, i) => {
      const x = 76 + i * 375;
      const [headRaw, ...rest] = item.split(":");
      const head = headRaw || item;
      const body = rest.join(":") || item;
      return `<rect x="${x}" y="468" width="330" height="128" rx="8" fill="#18243a" stroke="#334766" stroke-width="2"/>
        <rect x="${x + 16}" y="486" width="298" height="31" rx="4" fill="#f04a24"/>
        ${textBlock(head, x + 165, 510, { size: 19, weight: 900, maxChars: 24, maxLines: 1, anchor: "middle" })}
        ${textBlock(body, x + 28, 550, { size: 17, fill: "#f8fafc", maxChars: 30, maxLines: 2 })}
        ${i < cards.length - 1 ? `<text x="${x + 350}" y="554" font-size="48" font-weight="900" fill="#ffffff">+</text>` : ""}`;
    }).join("")}
    ${side.map((item, i) => pill(1218, 468 + i * 52, 310, 30, "#f04a24", item, "#fff", 18)).join("")}
    ${s.takeaway ? `<rect x="620" y="682" width="560" height="130" rx="10" fill="#18243a" stroke="#334766" stroke-width="2"/>
      <rect x="648" y="704" width="504" height="32" rx="4" fill="#88a9e8"/>
      <text x="900" y="728" font-size="21" font-weight="900" fill="#020617" text-anchor="middle">AI-enabled Performance Advantage</text>
      ${textBlock(s.takeaway, 670, 770, { size: 20, maxChars: 49, maxLines: 2 })}` : ""}
    <text x="56" y="866" font-size="13" fill="#94a3b8">Confidential Information - For intended recipients only.</text>
  </svg>`;
}

function lightConsulting(s: VisualSlideInput): string {
  const bullets = (s.bullets ?? []).slice(0, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#f8fafc"/>
    <rect x="0" y="0" width="18" height="${H}" fill="#0ea5e9"/>
    <text x="70" y="82" font-size="18" font-weight="800" fill="#0ea5e9" letter-spacing="5">${esc((s.kicker || "INSIGHT").toUpperCase())}</text>
    ${textBlock(s.title || "Slide title", 70, 140, { size: 44, weight: 900, fill: "#111827", maxChars: 50, maxLines: 2 })}
    <line x1="70" y1="252" x2="1480" y2="252" stroke="#cbd5e1" stroke-width="2"/><rect x="70" y="247" width="100" height="10" fill="#0ea5e9"/>
    ${bullets.map((b, i) => `<rect x="90" y="${325 + i * 78}" width="18" height="18" fill="#0ea5e9"/><text x="135" y="${344 + i * 78}" font-size="28" font-weight="650" fill="#1f2937">${esc(b)}</text>`).join("")}
    ${s.takeaway ? `<rect x="70" y="762" width="1410" height="72" fill="#e0f2fe"/><rect x="70" y="762" width="12" height="72" fill="#0ea5e9"/><text x="105" y="790" font-size="15" font-weight="900" fill="#0284c7" letter-spacing="4">SO WHAT</text>${textBlock(s.takeaway, 105, 818, { size: 22, fill: "#0f172a", maxChars: 85, maxLines: 1 })}` : ""}
  </svg>`;
}

function processFlow(s: VisualSlideInput): string {
  const sourceItems = s.pillars?.length
    ? s.pillars
    : (s.bullets ?? []).map((b) => ({ title: b.split(":")[0], body: b.split(":").slice(1).join(":") || b }));
  const items = sourceItems.filter((item) => item.title || item.body).slice(0, 9);
  const count = Math.max(items.length, 1);
  const cols = count <= 4 ? count : 3;
  const rows = Math.ceil(count / cols);
  const cardW = rows === 1 ? Math.min(270, (1320 - (cols - 1) * 75) / cols) : 360;
  const cardH = rows === 1 ? 150 : 106;
  const xStart = rows === 1 ? (W - (cols * cardW + (cols - 1) * 75)) / 2 : 145;
  const xGap = rows === 1 ? cardW + 75 : 475;
  const firstLineY = rows === 1 ? 420 : 298;
  const rowGap = rows === 1 ? 0 : 172;
  const titleSize = rows === 1 ? 25 : 19;
  const bodySize = rows === 1 ? 20 : 15;
  const circleR = rows === 1 ? 54 : 36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    ${textBlock(s.title || "Slide title", 70, 95, { size: 42, weight: 900, fill: "#111827", maxChars: 55, maxLines: 2 })}
    <text x="70" y="190" font-size="18" font-weight="900" fill="#ef4444" letter-spacing="5">${esc((s.kicker || "APPROACH").toUpperCase())}</text>
    ${Array.from({ length: rows }).map((_, row) => {
      const rowCount = Math.min(cols, count - row * cols);
      const rowLeft = xStart;
      const rowRight = xStart + (rowCount - 1) * xGap + cardW;
      const y = firstLineY + row * rowGap;
      return `<line x1="${rowLeft + cardW / 2}" y1="${y}" x2="${rowRight - cardW / 2}" y2="${y}" stroke="#94a3b8" stroke-width="${rows === 1 ? 5 : 4}"/>`;
    }).join("")}
    ${items.map((p, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = xStart + col * xGap;
      const lineY = firstLineY + row * rowGap;
      const cardY = lineY + (rows === 1 ? 80 : 52);
      const titleY = cardY + (rows === 1 ? 45 : 34);
      const bodyY = cardY + (rows === 1 ? 85 : 64);
      return `<circle cx="${x + cardW / 2}" cy="${lineY}" r="${circleR}" fill="#ef4444"/>
        <text x="${x + cardW / 2}" y="${lineY + (rows === 1 ? 15 : 10)}" font-size="${rows === 1 ? 32 : 23}" font-weight="900" fill="#fff" text-anchor="middle">${String(i + 1).padStart(2, "0")}</text>
        <rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
        ${textBlock(p.title, x + 24, titleY, { size: titleSize, weight: 900, fill: "#111827", maxChars: rows === 1 ? 20 : 27, maxLines: rows === 1 ? 1 : 2 })}
        ${textBlock(p.body, x + 24, bodyY, { size: bodySize, fill: "#475569", maxChars: rows === 1 ? 24 : 40, maxLines: rows === 1 ? 3 : 2 })}`;
    }).join("")}
    ${s.takeaway ? textBlock(s.takeaway, 80, 838, { size: 22, weight: 800, fill: "#111827", maxChars: 95, maxLines: 1 }) : ""}
  </svg>`;
}

function dataHeavy(s: VisualSlideInput): string {
  const stats = (s.stats?.length ? s.stats : (s.bullets ?? []).slice(0, 3).map((b, i) => ({ value: `${i + 1}`, label: b }))).slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#0f172a"/>
    <rect x="0" y="0" width="${W}" height="210" fill="#111827"/>
    <text x="75" y="76" font-size="18" font-weight="900" fill="#38bdf8" letter-spacing="5">${esc((s.kicker || "METRICS").toUpperCase())}</text>
    ${textBlock(s.title || "Slide title", 75, 132, { size: 40, weight: 900, maxChars: 60, maxLines: 2 })}
    ${stats.map((st, i) => {
      const x = 80 + i * 370;
      return `<rect x="${x}" y="300" width="300" height="255" rx="10" fill="#ffffff"/><text x="${x + 28}" y="400" font-size="68" font-weight="900" fill="#0ea5e9">${esc(st.value)}</text><rect x="${x + 30}" y="425" width="70" height="8" fill="#0ea5e9"/>${textBlock(st.label, x + 30, 475, { size: 24, fill: "#334155", maxChars: 22, maxLines: 3 })}`;
    }).join("")}
    ${s.takeaway ? `<rect x="80" y="710" width="1440" height="92" rx="8" fill="#1e293b"/><text x="115" y="766" font-size="28" font-weight="800" fill="#f8fafc">${esc(s.takeaway)}</text>` : ""}
  </svg>`;
}

function executiveSummary(s: VisualSlideInput): string {
  const items = (s.pillars?.length ? s.pillars : (s.bullets ?? []).map((b) => {
    const [title, ...body] = b.split(":");
    return { title: title || b, body: body.join(":") || b };
  })).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect x="0" y="0" width="${W}" height="116" fill="#111827"/>
    <text x="72" y="74" font-size="18" font-weight="900" fill="#38bdf8" letter-spacing="5">${esc((s.kicker || "EXECUTIVE SUMMARY").toUpperCase())}</text>
    ${textBlock(s.title || "Slide title", 72, 174, { size: 44, weight: 900, fill: "#111827", maxChars: 57, maxLines: 2 })}
    <rect x="72" y="290" width="1450" height="4" fill="#0ea5e9"/>
    ${items.map((p, i) => {
      const x = 72 + i * 493;
      return `<rect x="${x}" y="350" width="440" height="245" rx="8" fill="#f8fafc" stroke="#d8e1ec" stroke-width="2"/>
        <rect x="${x}" y="350" width="440" height="12" fill="${i === 0 ? "#0ea5e9" : i === 1 ? "#10b981" : "#f04a24"}"/>
        <text x="${x + 28}" y="420" font-size="28" font-weight="900" fill="#111827">${esc(p.title)}</text>
        ${textBlock(p.body, x + 28, 468, { size: 23, fill: "#475569", maxChars: 31, maxLines: 4 })}`;
    }).join("")}
    ${s.takeaway ? `<rect x="72" y="690" width="1450" height="94" rx="8" fill="#eef6ff"/><rect x="72" y="690" width="14" height="94" fill="#0ea5e9"/><text x="112" y="730" font-size="18" font-weight="900" fill="#0284c7" letter-spacing="4">RECOMMENDATION</text>${textBlock(s.takeaway, 112, 764, { size: 24, fill: "#0f172a", maxChars: 85, maxLines: 1 })}` : ""}
  </svg>`;
}

function comparisonMatrix(s: VisualSlideInput): string {
  const left = s.comparison?.left ?? { heading: "Current", items: (s.bullets ?? []).slice(0, 3) };
  const right = s.comparison?.right ?? { heading: "Future", items: (s.bullets ?? []).slice(3, 6) };
  const leftItems = left.items ?? [];
  const rightItems = right.items ?? [];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#f8fafc"/>
    ${textBlock(s.title || "Slide title", 72, 94, { size: 42, weight: 900, fill: "#111827", maxChars: 60, maxLines: 2 })}
    <text x="72" y="196" font-size="18" font-weight="900" fill="#64748b" letter-spacing="5">${esc((s.kicker || "COMPARISON").toUpperCase())}</text>
    <rect x="92" y="270" width="650" height="455" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="858" y="270" width="650" height="455" rx="10" fill="#eaf6ff" stroke="#93c5fd" stroke-width="2"/>
    <text x="126" y="334" font-size="30" font-weight="900" fill="#475569">${esc(left.heading)}</text>
    <text x="892" y="334" font-size="30" font-weight="900" fill="#0369a1">${esc(right.heading)}</text>
    ${leftItems.slice(0, 5).map((item, i) => `<circle cx="130" cy="${396 + i * 60}" r="7" fill="#94a3b8"/><text x="154" y="${404 + i * 60}" font-size="24" fill="#334155">${esc(item)}</text>`).join("")}
    ${rightItems.slice(0, 5).map((item, i) => `<circle cx="896" cy="${396 + i * 60}" r="7" fill="#0ea5e9"/><text x="920" y="${404 + i * 60}" font-size="24" fill="#0f172a">${esc(item)}</text>`).join("")}
    ${s.takeaway ? textBlock(s.takeaway, 92, 804, { size: 25, weight: 800, fill: "#111827", maxChars: 88, maxLines: 1 }) : ""}
  </svg>`;
}

function quoteFocus(s: VisualSlideInput): string {
  const quote = s.quote?.text || s.takeaway || (s.bullets ?? [])[0] || s.title || "Core principle";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#111827"/>
    <rect x="0" y="0" width="28" height="${H}" fill="#f04a24"/>
    <text x="100" y="120" font-size="18" font-weight="900" fill="#f97316" letter-spacing="5">${esc((s.kicker || "PRINCIPLE").toUpperCase())}</text>
    <text x="100" y="330" font-size="132" font-weight="900" fill="#f04a24">“</text>
    ${textBlock(quote, 220, 305, { size: 52, weight: 900, fill: "#ffffff", maxChars: 39, maxLines: 3 })}
    ${s.quote?.attribution ? `<text x="226" y="610" font-size="26" fill="#cbd5e1">— ${esc(s.quote.attribution)}</text>` : ""}
    ${textBlock(s.title, 100, 760, { size: 28, fill: "#e5e7eb", weight: 700, maxChars: 78, maxLines: 2 })}
  </svg>`;
}

export function renderVisualSlideSvg(slide: VisualSlideInput): string {
  const template = slide.design?.template;
  const style = slide.design?.style ?? (slide.layout === "stats" ? "data_heavy" : slide.layout === "pillars" ? "process_flow" : "light_consulting");
  const body =
    slide.kind === "cover" ? lightConsulting({ ...slide, kicker: slide.kicker || "PRESENTATION" }) :
    slide.kind === "closing" ? processFlow({ ...slide, kicker: slide.kicker || "NEXT STEPS", pillars: (slide.bullets ?? []).map((b) => ({ title: b.split(":")[0] || "Action", body: b.split(":").slice(1).join(":") || b })) }) :
    template === "executive_summary" ? executiveSummary(slide) :
    template === "dark_capability_map" ? darkTechnical(slide) :
    template === "clean_bullets" ? lightConsulting(slide) :
    template === "process_timeline" ? processFlow(slide) :
    template === "metric_dashboard" ? dataHeavy(slide) :
    template === "comparison_matrix" ? comparisonMatrix(slide) :
    template === "quote_focus" ? quoteFocus(slide) :
    style === "dark_technical" ? darkTechnical(slide) :
    style === "process_flow" ? processFlow(slide) :
    style === "data_heavy" ? dataHeavy(slide) :
    lightConsulting(slide);

  return body.replace("<svg ", `<svg font-family="${FONT}" `);
}
