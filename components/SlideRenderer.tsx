"use client";

import type { SlideData, DeckTheme, StatItem, ColumnContent } from "@/types";

// Rendered at this fixed canvas size; the parent scales it down via CSS transform
const W = 640;
const H = 360;

const font =
  "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";

// ── helpers ──────────────────────────────────────────────────────────────────

function hex(color: string, alpha = 1) {
  if (alpha === 1) return color;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function Footer({ theme }: { theme: DeckTheme }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: theme.accent,
      }}
    />
  );
}

function Eyebrow({
  text,
  color,
  style,
}: {
  text: string;
  color: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color,
        marginBottom: 8,
        fontFamily: font,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

// ── layouts ──────────────────────────────────────────────────────────────────

function TitleLayout({ d }: { d: SlideData }) {
  const { theme } = d;
  return (
    <div
      style={{
        width: W,
        height: H,
        backgroundColor: theme.primary,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 64px",
        position: "relative",
        overflow: "hidden",
        fontFamily: font,
      }}
    >
      {/* Decorative circles */}
      <div
        style={{
          position: "absolute",
          top: -60,
          right: -60,
          width: 200,
          height: 200,
          borderRadius: "50%",
          backgroundColor: hex(theme.accent, 0.15),
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -40,
          right: 80,
          width: 120,
          height: 120,
          borderRadius: "50%",
          backgroundColor: hex(theme.accent, 0.1),
        }}
      />
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 40,
          bottom: 40,
          width: 4,
          backgroundColor: theme.accent,
          borderRadius: 2,
        }}
      />

      {d.eyebrow && (
        <Eyebrow text={d.eyebrow} color={theme.accent} style={{ marginBottom: 12 }} />
      )}
      {d.title && (
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: theme.primaryText,
            lineHeight: 1.15,
            marginBottom: 12,
            maxWidth: 440,
          }}
        >
          {d.title}
        </div>
      )}
      {d.subtitle && (
        <div
          style={{
            fontSize: 13,
            color: hex(theme.primaryText, 0.65),
            lineHeight: 1.5,
            maxWidth: 400,
          }}
        >
          {d.subtitle}
        </div>
      )}

      {/* Apexon wordmark */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 64,
          fontSize: 10,
          fontWeight: 700,
          color: hex(theme.primaryText, 0.35),
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        APEXON
      </div>
    </div>
  );
}

function SectionLayout({ d }: { d: SlideData }) {
  const { theme } = d;
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        fontFamily: font,
        position: "relative",
      }}
    >
      {/* Left accent panel */}
      <div
        style={{
          width: "38%",
          backgroundColor: theme.primary,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          padding: "0 28px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {d.eyebrow && (
          <div
            style={{
              fontSize: 52,
              fontWeight: 900,
              color: hex(theme.accent, 0.25),
              lineHeight: 1,
              position: "absolute",
              top: 20,
              right: 20,
            }}
          >
            {d.eyebrow}
          </div>
        )}
        <div
          style={{
            width: 40,
            height: 3,
            backgroundColor: theme.accent,
            marginBottom: 10,
            alignSelf: "flex-start",
          }}
        />
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: hex(theme.primaryText, 0.45),
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            alignSelf: "flex-start",
          }}
        >
          SECTION
        </div>
      </div>

      {/* Right content */}
      <div
        style={{
          flex: 1,
          backgroundColor: theme.surface,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "40px 36px",
        }}
      >
        {d.title && (
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#1e293b",
              lineHeight: 1.2,
              marginBottom: 12,
            }}
          >
            {d.title}
          </div>
        )}
        {d.body && (
          <div
            style={{
              fontSize: 13,
              color: "#64748b",
              lineHeight: 1.6,
              maxWidth: 320,
            }}
          >
            {d.body}
          </div>
        )}
      </div>

      <Footer theme={theme} />
    </div>
  );
}

function BulletsLayout({ d }: { d: SlideData }) {
  const { theme } = d;
  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        fontFamily: font,
        position: "relative",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          backgroundColor: theme.primary,
          padding: "14px 32px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 3,
            height: 20,
            backgroundColor: theme.accent,
            borderRadius: 2,
          }}
        />
        {d.title && (
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: theme.primaryText,
            }}
          >
            {d.title}
          </div>
        )}
      </div>

      {/* Bullets */}
      <div
        style={{
          flex: 1,
          padding: "22px 36px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          justifyContent: "center",
        }}
      >
        {(d.bullets ?? []).map((b, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "7px 0",
              borderBottom: i < (d.bullets?.length ?? 0) - 1 ? "1px solid #f1f5f9" : "none",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: theme.accent,
                marginTop: 5,
                flexShrink: 0,
              }}
            />
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
              {b}
            </div>
          </div>
        ))}
      </div>

      <Footer theme={theme} />
    </div>
  );
}

function TwoColLayout({ d }: { d: SlideData }) {
  const { theme } = d;

  function Col({ col }: { col: ColumnContent }) {
    return (
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: theme.accent,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          {col.heading}
        </div>
        {col.items.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                backgroundColor: theme.accent,
                marginTop: 5,
                flexShrink: 0,
                opacity: 0.7,
              }}
            />
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
              {item}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        fontFamily: font,
        position: "relative",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          backgroundColor: theme.primary,
          padding: "12px 32px",
          flexShrink: 0,
        }}
      >
        {d.title && (
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.primaryText }}>
            {d.title}
          </div>
        )}
      </div>

      {/* Two columns */}
      <div
        style={{
          flex: 1,
          display: "flex",
          padding: "24px 32px",
          gap: 0,
        }}
      >
        {d.leftCol && <Col col={d.leftCol} />}

        {/* Divider */}
        <div
          style={{
            width: 1,
            backgroundColor: "#e2e8f0",
            margin: "0 24px",
            flexShrink: 0,
          }}
        />

        {d.rightCol && <Col col={d.rightCol} />}
      </div>

      <Footer theme={theme} />
    </div>
  );
}

function StatsLayout({ d }: { d: SlideData }) {
  const { theme } = d;
  const stats = d.stats ?? [];

  return (
    <div
      style={{
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.surface,
        fontFamily: font,
        position: "relative",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          backgroundColor: theme.primary,
          padding: "12px 32px",
          flexShrink: 0,
        }}
      >
        {d.title && (
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.primaryText }}>
            {d.title}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 12,
          padding: "20px 32px",
        }}
      >
        {stats.map((s: StatItem, i) => (
          <div
            key={i}
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px 16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: theme.accent,
                lineHeight: 1,
                marginBottom: 4,
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#94a3b8",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                textAlign: "center",
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <Footer theme={theme} />
    </div>
  );
}

function QuoteLayout({ d }: { d: SlideData }) {
  const { theme } = d;
  return (
    <div
      style={{
        width: W,
        height: H,
        backgroundColor: theme.primary,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 64px",
        position: "relative",
        overflow: "hidden",
        fontFamily: font,
      }}
    >
      {/* Decorative quote mark */}
      <div
        style={{
          fontSize: 80,
          fontWeight: 900,
          color: hex(theme.accent, 0.2),
          lineHeight: 0.8,
          alignSelf: "flex-start",
          marginBottom: 8,
          fontFamily: "Georgia, serif",
        }}
      >
        &ldquo;
      </div>

      {d.quote && (
        <div
          style={{
            fontSize: 17,
            fontStyle: "italic",
            color: theme.primaryText,
            lineHeight: 1.65,
            textAlign: "center",
            marginBottom: 20,
          }}
        >
          {d.quote}
        </div>
      )}

      {d.attribution && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: theme.accent,
            textAlign: "center",
            letterSpacing: "0.05em",
          }}
        >
          — {d.attribution}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: theme.accent,
        }}
      />
    </div>
  );
}

function ClosingLayout({ d }: { d: SlideData }) {
  const { theme } = d;
  return (
    <div
      style={{
        width: W,
        height: H,
        backgroundColor: theme.primary,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 64px",
        position: "relative",
        overflow: "hidden",
        fontFamily: font,
      }}
    >
      {/* Decorative background circles */}
      <div
        style={{
          position: "absolute",
          top: -80,
          left: -80,
          width: 240,
          height: 240,
          borderRadius: "50%",
          border: `2px solid ${hex(theme.accent, 0.15)}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          right: -60,
          width: 180,
          height: 180,
          borderRadius: "50%",
          border: `2px solid ${hex(theme.accent, 0.2)}`,
        }}
      />

      {/* Accent line */}
      <div
        style={{
          width: 40,
          height: 3,
          backgroundColor: theme.accent,
          marginBottom: 16,
          borderRadius: 2,
        }}
      />

      {d.eyebrow && (
        <Eyebrow
          text={d.eyebrow}
          color={theme.accent}
          style={{ marginBottom: 10, textAlign: "center" }}
        />
      )}

      {d.title && (
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: theme.primaryText,
            textAlign: "center",
            lineHeight: 1.2,
            marginBottom: 12,
          }}
        >
          {d.title}
        </div>
      )}

      {d.subtitle && (
        <div
          style={{
            fontSize: 12,
            color: hex(theme.primaryText, 0.55),
            textAlign: "center",
          }}
        >
          {d.subtitle}
        </div>
      )}

      {/* Wordmark */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          fontSize: 10,
          fontWeight: 700,
          color: hex(theme.primaryText, 0.3),
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        APEXON
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: theme.accent,
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  data: SlideData;
  slideNumber: number;
}

export default function SlideRenderer({ data, slideNumber }: Props) {
  return (
    <div
      style={{
        width: W,
        height: H,
        position: "relative",
        overflow: "hidden",
        fontFamily: font,
      }}
    >
      {data.layout === "title"   && <TitleLayout   d={data} />}
      {data.layout === "section" && <SectionLayout d={data} />}
      {data.layout === "bullets" && <BulletsLayout d={data} />}
      {data.layout === "two-col" && <TwoColLayout  d={data} />}
      {data.layout === "stats"   && <StatsLayout   d={data} />}
      {data.layout === "quote"   && <QuoteLayout   d={data} />}
      {data.layout === "closing" && <ClosingLayout d={data} />}

      {/* Slide number stamp */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          right: 14,
          fontSize: 9,
          fontWeight: 600,
          color:
            ["title", "closing", "quote"].includes(data.layout)
              ? "rgba(255,255,255,0.25)"
              : "rgba(0,0,0,0.18)",
          fontFamily: font,
        }}
      >
        {slideNumber}
      </div>
    </div>
  );
}
