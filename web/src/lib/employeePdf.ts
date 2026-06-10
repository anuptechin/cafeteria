import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { RangeState } from "./api";
import { count, dateOf, timeOf, rangeLabel } from "./format";

// Brand tokens (mirrors tailwind.config.js)
const INK = "#000000";
const INK_SECONDARY = "#5C5A52";
const BEGE = "#F7F5F2";
const BORDER = "#D9D5CC";
const MEAL_TONES: Record<string, string> = {
  Lunch: "#B93E19",
  Dinner: "#000000",
  Tea: "#19B924",
  Biscuit: "#B99919",
};

const PAGE_W = 595.28; // A4 portrait, pt
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

// The logo ships as .webp, which jsPDF can't embed — rasterize to PNG via canvas.
// Downscaled to ~4× its rendered height (it draws at 46pt): embedding the
// full-resolution PNG made jsPDF spend seconds re-encoding it. Cached so
// repeat exports skip the fetch + rasterize entirely.
let logoCache: Promise<{ data: string; ratio: number } | null> | null = null;
function loadLogoPng(): Promise<{ data: string; ratio: number } | null> {
  return (logoCache ??= (async () => {
    try {
      const img = new Image();
      img.src = "/ddecor-logo.webp";
      await img.decode();
      const h = Math.min(240, img.naturalHeight);
      const w = Math.round(img.naturalWidth * (h / img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      return { data: canvas.toDataURL("image/png"), ratio: w / h };
    } catch {
      logoCache = null; // allow a retry next export
      return null; // never block the export on the logo
    }
  })());
}

export type EmployeePdfInput = {
  emp: { emp_id: string; name: string };
  range: RangeState;
  cafeteriaName: string | null; // null = all cafeterias
  meal: string | null; // null = all meals
  kpi: Record<string, number>;
  totalMeals: number;
  punches: { id: number; punched_at: string; meal: string | null; cafeteria_name: string | null; device_id: string | null }[];
};

export async function exportEmployeePdf(input: EmployeePdfInput) {
  const { emp, range, cafeteriaName, meal, kpi, totalMeals, punches } = input;
  const logo = await loadLogoPng();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const generatedAt = new Date().toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Kolkata",
  });

  // ── Masthead: full-bleed brand panel, logo left, report label right ──────
  const headH = 124;
  doc.setFillColor(BEGE);
  doc.rect(0, 0, PAGE_W, headH, "F");

  // Logo — drawn large, vertically centered in the panel.
  const logoH = 46;
  const logoY = 32;
  if (logo) {
    doc.addImage(logo.data, "PNG", MARGIN, logoY, logoH * logo.ratio, logoH, undefined, "FAST");
  } else {
    doc.setFont("helvetica", "bold").setFontSize(24).setTextColor(INK);
    doc.text("D'DECOR", MARGIN, logoY + 30);
  }
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(INK_SECONDARY);
  doc.text("CAFETERIA INTELLIGENCE", MARGIN, logoY + logoH + 14, { charSpace: 1.6 });

  // Right column: report title with a brand-red accent tick above it.
  doc.setFillColor("#B93E19");
  doc.rect(PAGE_W - MARGIN - 30, logoY + 4, 30, 3, "F");
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(INK);
  doc.text("EMPLOYEE MEAL REPORT", PAGE_W - MARGIN, logoY + 26, { align: "right", charSpace: 1.2 });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(INK_SECONDARY);
  doc.text(`Generated ${generatedAt} IST`, PAGE_W - MARGIN, logoY + 40, { align: "right" });

  // Editorial double rule closing the masthead — full bleed.
  doc.setDrawColor(INK).setLineWidth(2);
  doc.line(0, headH - 3, PAGE_W, headH - 3);
  doc.setLineWidth(0.5);
  doc.line(0, headH, PAGE_W, headH);

  let y = headH + 34;

  // ── Employee identity + scope ────────────────────────────────────────────
  doc.setFont("helvetica", "bold").setFontSize(19).setTextColor(INK);
  doc.text(emp.name, MARGIN, y);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(INK_SECONDARY);
  doc.text(`Employee ID  ${emp.emp_id}`, MARGIN, y + 16);

  const scope = [
    ["Period", rangeLabel(range)],
    ["Cafeteria", cafeteriaName ?? "All cafeterias"],
    ["Meal filter", meal ?? "All meals"],
  ];
  let sy = y - 8;
  for (const [k, v] of scope) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(INK_SECONDARY);
    doc.text(k.toUpperCase(), PAGE_W - MARGIN - 150, sy);
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK);
    doc.text(String(v), PAGE_W - MARGIN, sy, { align: "right" });
    sy += 13;
  }
  y += 38;

  // ── KPI tiles: one per meal type, brand-toned accent bar ─────────────────
  const meals = Object.keys(MEAL_TONES);
  const gap = 10;
  const tileW = (CONTENT_W - gap * (meals.length - 1)) / meals.length;
  const tileH = 52;
  meals.forEach((m, i) => {
    const x = MARGIN + i * (tileW + gap);
    const active = meal === m;
    doc.setFillColor(active ? INK : BEGE);
    doc.setDrawColor(BORDER).setLineWidth(0.6);
    doc.roundedRect(x, y, tileW, tileH, 6, 6, "FD");
    doc.setFillColor(MEAL_TONES[m]);
    doc.rect(x, y + 6, 3, tileH - 12, "F");
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(active ? "#BBBBBB" : INK_SECONDARY);
    doc.text(m, x + 12, y + 17);
    doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(active ? "#FFFFFF" : INK);
    doc.text(count(kpi?.[m] ?? 0), x + 12, y + 39);
  });
  y += tileH + 12;

  // Total strip
  doc.setFillColor(INK);
  doc.roundedRect(MARGIN, y, CONTENT_W, 30, 6, 6, "F");
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor("#CCCCCC");
  doc.text(meal ? `${meal} meals in view` : "Total meals in period", MARGIN + 12, y + 19);
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor("#FFFFFF");
  doc.text(count(totalMeals), PAGE_W - MARGIN - 12, y + 20, { align: "right" });
  y += 50;

  // ── Punch history table ──────────────────────────────────────────────────
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(INK);
  doc.text("Punch History", MARGIN, y);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(INK_SECONDARY);
  doc.text(`${count(punches.length)} punches`, PAGE_W - MARGIN, y, { align: "right" });
  y += 10;

  if (punches.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: 56 },
      head: [["#", "Date", "Time", "Meal", "Cafeteria", "Device"]],
      body: punches.map((p, i) => [
        String(i + 1),
        dateOf(p.punched_at),
        timeOf(p.punched_at),
        p.meal ?? "—",
        p.cafeteria_name ?? "—",
        p.device_id ?? "—",
      ]),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8.5, textColor: INK, cellPadding: { top: 5, bottom: 5, left: 8, right: 8 } },
      headStyles: { fillColor: INK, textColor: "#FFFFFF", fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: BEGE },
      columnStyles: {
        0: { cellWidth: 28, textColor: INK_SECONDARY },
        3: { fontStyle: "bold" },
        4: { textColor: INK_SECONDARY },
        5: { textColor: INK_SECONDARY },
      },
      didParseCell: (h) => {
        // Tint the meal cell with its brand tone.
        if (h.section === "body" && h.column.index === 3) {
          const tone = MEAL_TONES[String(h.cell.raw)];
          if (tone) h.cell.styles.textColor = tone;
        }
      },
    });
  } else {
    doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(INK_SECONDARY);
    doc.text("No meals in this period.", MARGIN, y + 20);
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fy = doc.internal.pageSize.getHeight() - 32;
    doc.setDrawColor(BORDER).setLineWidth(0.6);
    doc.line(MARGIN, fy - 10, PAGE_W - MARGIN, fy - 10);
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(INK);
    doc.text("D'DECOR  ·  Cafeteria Intelligence", MARGIN, fy);
    doc.setFont("helvetica", "normal").setTextColor(INK_SECONDARY);
    doc.text(`${emp.name}  ·  ${emp.emp_id}`, PAGE_W / 2, fy, { align: "center" });
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, fy, { align: "right" });
  }

  const safe = (s: string) => s.replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  doc.save(`DDecor_Meal_Report_${safe(emp.emp_id)}_${safe(rangeLabel(range))}.pdf`);
}
