/**
 * Generates dummy EARIST-aligned PDF documents for the TechTalk seminar activity.
 * Also watermarks the existing 03_EARIST-QSF-SAS-006.pdf.
 *
 * Documents generated / updated in docs/dummy_docs/:
 *   01 - Request Letter to ISG President          (justified body text + watermark)
 *   02 - Request Letter to Institute President    (justified body text + watermark)
 *   03 - EARIST-QSF-SAS-006 (existing, watermark added in-place)
 *   04 - Budgetary Allocation and Venue Reservation (watermark)
 *   05 - Program / Event Flow                     (watermark)
 *   06 - Speaker / Facilitator Profile            (watermark)
 *   07 - Equipment Borrowing Form                 (new, watermark)
 *
 * Usage: node scripts/generateDummyDocs.js
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../docs/dummy_docs");
const LOGO_PATH = path.join(__dirname, "../src/assets/images/logos/earist-logo.png");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Colors ────────────────────────────────────────────────────────────────────
const MAROON = rgb(0.502, 0, 0.125);
const BLACK = rgb(0, 0, 0);
const DARK_GRAY = rgb(0.2, 0.2, 0.2);
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
const WHITE = rgb(1, 1, 1);

// ── Page constants (Letter = 612 x 792 pts) ───────────────────────────────────
const [PW, PH] = PageSizes.Letter;
const MARGIN = 72; // 1 inch
const CONTENT_W = PW - MARGIN * 2;
const WATERMARK_SIZE = 6 * 72; // 6 inches in points

// ── Load logo bytes once ──────────────────────────────────────────────────────
const LOGO_BYTES = fs.readFileSync(LOGO_PATH);

// ── Font helper ───────────────────────────────────────────────────────────────
async function getFonts(doc) {
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  return { regular, bold, italic };
}

// ── Watermark ─────────────────────────────────────────────────────────────────
async function addWatermark(pdfDoc, page) {
  const logoImage = await pdfDoc.embedPng(LOGO_BYTES);
  const { width, height } = page.getSize();
  page.drawImage(logoImage, {
    x: (width - WATERMARK_SIZE) / 2,
    y: (height - WATERMARK_SIZE) / 2,
    width: WATERMARK_SIZE,
    height: WATERMARK_SIZE,
    opacity: 0.15,
  });
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function drawHeaderBlock(page, fonts, y) {
  const { regular, bold } = fonts;
  const cx = PW / 2;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PW - MARGIN, y }, thickness: 1.5, color: MAROON });
  y -= 14;

  const l1 = "Republic of the Philippines";
  page.drawText(l1, { x: cx - regular.widthOfTextAtSize(l1, 9) / 2, y, size: 9, font: regular, color: BLACK });
  y -= 13;

  const l2 = 'EULOGIO "AMANG" RODRIGUEZ INSTITUTE OF SCIENCE AND TECHNOLOGY';
  page.drawText(l2, { x: cx - bold.widthOfTextAtSize(l2, 10) / 2, y, size: 10, font: bold, color: BLACK });
  y -= 12;

  const l3 = "Nagtahan, Sampaloc, Manila";
  page.drawText(l3, { x: cx - regular.widthOfTextAtSize(l3, 9) / 2, y, size: 9, font: regular, color: BLACK });
  y -= 14;

  const l4 = "STUDENT AFFAIRS AND SERVICES";
  page.drawText(l4, { x: cx - bold.widthOfTextAtSize(l4, 11) / 2, y, size: 11, font: bold, color: MAROON });
  y -= 8;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PW - MARGIN, y }, thickness: 1, color: MAROON });
  return y - 20;
}

function drawCentered(page, text, font, size, y, color = BLACK) {
  page.drawText(text, { x: (PW - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  return y - size - 4;
}

function drawLeft(page, text, font, size, y, x = MARGIN, color = BLACK) {
  page.drawText(text, { x, y, size, font, color });
  return y - size - 4;
}

// Word-wrap, left-aligned
function drawWrapped(page, text, font, size, y, maxW = CONTENT_W, x = MARGIN, color = BLACK, leading = 6) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      page.drawText(line, { x, y, size, font, color });
      y -= size + leading;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) { page.drawText(line, { x, y, size, font, color }); y -= size + leading; }
  return y;
}

// Justified text — last line of each call is left-aligned (paragraph break)
function drawJustified(page, text, font, size, y, maxW = CONTENT_W, x = MARGIN, color = BLACK, leading = 6) {
  const words = text.split(" ");
  const lines = [];
  let cur = [];

  for (const word of words) {
    const test = [...cur, word];
    if (font.widthOfTextAtSize(test.join(" "), size) > maxW && cur.length > 0) {
      lines.push(cur);
      cur = [word];
    } else {
      cur.push(word);
    }
  }
  if (cur.length) lines.push(cur);

  for (let i = 0; i < lines.length; i++) {
    const lineWords = lines[i];
    const isLast = i === lines.length - 1;

    if (isLast || lineWords.length === 1) {
      page.drawText(lineWords.join(" "), { x, y, size, font, color });
    } else {
      const wordsW = lineWords.reduce((s, w) => s + font.widthOfTextAtSize(w, size), 0);
      const gap = (maxW - wordsW) / (lineWords.length - 1);
      let cx = x;
      for (let j = 0; j < lineWords.length; j++) {
        page.drawText(lineWords[j], { x: cx, y, size, font, color });
        cx += font.widthOfTextAtSize(lineWords[j], size) + gap;
      }
    }
    y -= size + leading;
  }
  return y;
}

function drawHRule(page, y, thickness = 0.5, color = DARK_GRAY) {
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PW - MARGIN, y }, thickness, color });
  return y - 8;
}

function footerNote(page, fonts) {
  page.drawText("EARIST-QSF-SAS-006  |  Leadership Division, Student Affairs and Services", {
    x: MARGIN, y: 30, size: 7.5, font: fonts.italic, color: DARK_GRAY,
  });
}

// ── New page helper — creates page, draws watermark immediately, returns page + starting y ──
async function newPage(pdfDoc, fonts) {
  const page = pdfDoc.addPage(PageSizes.Letter);
  await addWatermark(pdfDoc, page);
  const y = PH - MARGIN;
  return { page, y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 01 — Request Letter to ISG President
// ─────────────────────────────────────────────────────────────────────────────
async function doc01_requestLetterISG() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;
  let { page, y } = await newPage(pdfDoc, fonts);

  y = drawHeaderBlock(page, fonts, y);

  y = drawLeft(page, "July 10, 2026", regular, 11, y);
  y -= 8;
  y = drawLeft(page, "Mr. CARL JUSTINE B. DIOQUINO", bold, 11, y);
  y = drawLeft(page, "ISG President", italic, 11, y);
  y = drawLeft(page, "Institute Student Government", regular, 11, y);
  y = drawLeft(page, 'Eulogio "Amang" Rodriguez Institute of Science and Technology', regular, 11, y);
  y = drawLeft(page, "Nagtahan, Sampaloc, Manila", regular, 11, y);
  y -= 10;

  y = drawLeft(page, "Dear Mr. Dioquino,", regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "We, the College of Computing Studies Student Government (CCS-CSG), respectfully " +
    "request your esteemed office to endorse our planned activity entitled \"TechTalk: " +
    "Web Development and Career Readiness Seminar.\" This seminar is scheduled on " +
    "July 25, 2026, from 8:00 AM to 5:00 PM at the EARIST Audio-Visual Room (AVR), " +
    "4th Floor, Main Building.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "The activity aims to equip 2nd to 4th Year BS Computer Science and BS Information " +
    "Technology students with practical knowledge on current web development trends and " +
    "career readiness skills through the guidance of an industry practitioner. We expect " +
    "approximately fifty (50) participants.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "Attached herewith is our Student Activity Proposal Form (EARIST-QSF-SAS-006) along " +
    "with the supporting documents for your reference and favorable action. We humbly " +
    "request your endorsement so that we may proceed with the submission to the Student " +
    "Affairs and Services office.",
    regular, 11, y);
  y -= 8;

  y = drawLeft(page, "Thank you very much for your kind consideration and support.", regular, 11, y);
  y -= 20;

  y = drawLeft(page, "Respectfully yours,", regular, 11, y);
  y -= 50;
  y = drawLeft(page, "JOHN DOE", bold, 11, y);
  y = drawLeft(page, "President, CCS-CSG", italic, 11, y);
  y -= 20;

  y = drawHRule(page, y);
  y = drawCentered(page, "Noted by:", bold, 10, y, MAROON);
  y -= 8;

  const c1 = MARGIN, c2 = PW / 2 + 10;
  page.drawText("JOHN DOE", { x: c1, y, size: 11, font: bold, color: BLACK });
  page.drawText("Prof. ERNANIE M. CARLOS JR., MIT", { x: c2, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Adviser, CCS-CSG", { x: c1, y, size: 10, font: italic, color: BLACK });
  page.drawText("College Dean, College of Computing Studies", { x: c2, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  fs.writeFileSync(path.join(OUT_DIR, "01_Request_Letter_ISG_President.pdf"), await pdfDoc.save());
  console.log("  [OK] 01_Request_Letter_ISG_President.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 02 — Request Letter to Institute President
// ─────────────────────────────────────────────────────────────────────────────
async function doc02_requestLetterPresident() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;
  let { page, y } = await newPage(pdfDoc, fonts);

  y = drawHeaderBlock(page, fonts, y);

  y = drawLeft(page, "July 10, 2026", regular, 11, y);
  y -= 8;
  y = drawLeft(page, "DR. JOSE ANTONIO R. REYES, Ph.D.", bold, 11, y);
  y = drawLeft(page, "Institute President", italic, 11, y);
  y = drawLeft(page, 'Eulogio "Amang" Rodriguez Institute of Science and Technology', regular, 11, y);
  y = drawLeft(page, "Nagtahan, Sampaloc, Manila", regular, 11, y);
  y -= 10;

  y = drawLeft(page, "Dear Dr. Reyes,", regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "On behalf of the College of Computing Studies Student Government (CCS-CSG), we " +
    "respectfully request your approval for our planned seminar entitled \"TechTalk: " +
    "Web Development and Career Readiness Seminar.\" The event is set on July 25, 2026, " +
    "8:00 AM to 5:00 PM at the EARIST Audio-Visual Room (AVR), 4th Floor, Main Building.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "This seminar is designed to bridge the gap between academic learning and industry " +
    "practice. An experienced Full-Stack Developer from TechBridge PH Inc. will serve as " +
    "our resource person, sharing current insights on web development tools and career " +
    "pathways in the technology sector. The activity targets approximately fifty (50) " +
    "students from BS Computer Science and BS Information Technology programs.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "The total proposed budget is PHP 6,500.00, sourced from the Student Government Fund " +
    "(PHP 3,500.00), organizational funds (PHP 2,000.00), and alumni donations and " +
    "sponsorships (PHP 1,000.00). All supporting documents -- including the Activity " +
    "Proposal Form, Budgetary Allocation, Program Flow, and Speaker Profile -- are " +
    "attached herewith.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "We humbly seek your favorable approval to proceed with this activity in accordance " +
    "with EARIST's mission of providing quality technological education.",
    regular, 11, y);
  y -= 20;

  y = drawLeft(page, "Respectfully yours,", regular, 11, y);
  y -= 50;
  y = drawLeft(page, "JOHN DOE", bold, 11, y);
  y = drawLeft(page, "President, CCS-CSG", italic, 11, y);
  y -= 14;

  y = drawHRule(page, y);
  y = drawCentered(page, "Endorsed by:", bold, 10, y, MAROON);
  y -= 8;

  const c1 = MARGIN, c2 = PW / 2 + 10;
  page.drawText("JOHN DOE", { x: c1, y, size: 11, font: bold, color: BLACK });
  page.drawText("Prof. ERNANIE M. CARLOS JR., MIT", { x: c2, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Adviser, CCS-CSG", { x: c1, y, size: 10, font: italic, color: BLACK });
  page.drawText("College Dean, College of Computing Studies", { x: c2, y, size: 10, font: italic, color: BLACK });
  y -= 24;
  page.drawText("MR. CARL JUSTINE B. DIOQUINO", { x: c1, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("ISG President", { x: c1, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  fs.writeFileSync(path.join(OUT_DIR, "02_Request_Letter_Institute_President.pdf"), await pdfDoc.save());
  console.log("  [OK] 02_Request_Letter_Institute_President.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 03 — Watermark existing EARIST-QSF-SAS-006.pdf in-place
// ─────────────────────────────────────────────────────────────────────────────
async function doc03_watermarkExisting() {
  const filePath = path.join(OUT_DIR, "03_EARIST-QSF-SAS-006.pdf");
  if (!fs.existsSync(filePath)) {
    console.log("  [SKIP] 03_EARIST-QSF-SAS-006.pdf not found");
    return;
  }
  const existingBytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(existingBytes);
  const logoImage = await pdfDoc.embedPng(LOGO_BYTES);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    page.drawImage(logoImage, {
      x: (width - WATERMARK_SIZE) / 2,
      y: (height - WATERMARK_SIZE) / 2,
      width: WATERMARK_SIZE,
      height: WATERMARK_SIZE,
      opacity: 0.15,
    });
  }

  fs.writeFileSync(filePath, await pdfDoc.save());
  console.log("  [OK] 03_EARIST-QSF-SAS-006.pdf (watermark added)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 04 — Budgetary Allocation and Venue Reservation
// ─────────────────────────────────────────────────────────────────────────────
async function doc04_budgetaryAllocation() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;
  let { page, y } = await newPage(pdfDoc, fonts);

  y = drawHeaderBlock(page, fonts, y);
  y = drawCentered(page, "BUDGETARY ALLOCATION AND VENUE RESERVATION", bold, 12, y, MAROON);
  y -= 4;
  y = drawCentered(page, "TechTalk: Web Development and Career Readiness Seminar", italic, 11, y);
  y -= 16;

  const infoRows = [
    ["Proponent:", "College of Computing Studies - CSG (CCS-CSG)"],
    ["Activity Date:", "July 25, 2026"],
    ["Time:", "8:00 AM to 5:00 PM"],
    ["Venue:", "EARIST AVR, 4th Floor, Main Building"],
    ["No. of Participants:", "50"],
  ];
  const vR = MARGIN + 150;
  for (const [lbl, val] of infoRows) {
    page.drawText(lbl, { x: MARGIN, y, size: 10, font: bold, color: BLACK });
    page.drawText(val, { x: vR, y, size: 10, font: regular, color: BLACK });
    y -= 16;
  }

  y -= 8;
  y = drawHRule(page, y, 1, MAROON);

  const c0 = MARGIN, c1 = MARGIN + 250, c2 = MARGIN + 330, c3 = PW - MARGIN - 5;
  const tTop = y;
  page.drawRectangle({ x: c0, y: tTop - 4, width: CONTENT_W, height: 18, color: MAROON });
  page.drawText("Particulars", { x: c0 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Quantity",   { x: c1 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Unit Cost",  { x: c2 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Amount",     { x: c3 - bold.widthOfTextAtSize("Amount", 10) - 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  y = tTop - 8;

  const rows = [
    ["Venue Rental (Audio-Visual Room)", "1",      "PHP 0.00",     "PHP 0.00 (free for org)"],
    ["Tarpaulin / Event Banner (3x6 ft)", "2 pcs", "PHP 300.00",   "PHP 600.00"],
    ["Printing of Certificates",          "50 pcs","PHP 10.00",    "PHP 500.00"],
    ["Snacks and Light Refreshments",     "50 pax","PHP 50.00",    "PHP 2,500.00"],
    ["Speaker / Resource Person Honorarium","1",   "PHP 1,500.00", "PHP 1,500.00"],
    ["Documentation (Photography)",       "1",     "PHP 500.00",   "PHP 500.00"],
    ["Supplies and Materials (paper, pens, etc.)", "1 lot","PHP 400.00","PHP 400.00"],
    ["Miscellaneous",                     "--",    "--",           "PHP 500.00"],
  ];

  for (let i = 0; i < rows.length; i++) {
    const [part, qty, unit, amt] = rows[i];
    const bg = i % 2 === 1 ? LIGHT_GRAY : WHITE;
    page.drawRectangle({ x: c0, y: y - 4, width: CONTENT_W, height: 16, color: bg });
    page.drawText(part, { x: c0 + 4, y: y + 1, size: 10, font: regular, color: BLACK });
    page.drawText(qty,  { x: c1 + 4, y: y + 1, size: 10, font: regular, color: BLACK });
    page.drawText(unit, { x: c2 + 4, y: y + 1, size: 10, font: regular, color: BLACK });
    page.drawText(amt,  { x: c3 - regular.widthOfTextAtSize(amt, 10) - 4, y: y + 1, size: 10, font: regular, color: BLACK });
    y -= 16;
  }

  const totalStr = "PHP 6,500.00";
  page.drawRectangle({ x: c0, y: y - 4, width: CONTENT_W, height: 18, color: MAROON });
  page.drawText("TOTAL", { x: c0 + 4, y: y + 1, size: 11, font: bold, color: WHITE });
  page.drawText(totalStr, { x: c3 - bold.widthOfTextAtSize(totalStr, 11) - 4, y: y + 1, size: 11, font: bold, color: WHITE });
  y -= 24;

  y = drawHRule(page, y, 0.5, MAROON);
  y = drawLeft(page, "Proposed Source of Funds:", bold, 11, y);
  y -= 4;
  for (const s of [
    "* Student Government Fund:  PHP 3,500.00",
    "* Organization (CCS-CSG):  PHP 2,000.00",
    "* Others (Donations / Sponsorships from alumni):  PHP 1,000.00",
  ]) { y = drawLeft(page, s, regular, 10, y, MARGIN + 12); }

  y -= 16;
  y = drawHRule(page, y, 0.5, MAROON);
  y = drawLeft(page, "Venue Reservation:", bold, 11, y);
  y -= 4;
  y = drawWrapped(page,
    "The EARIST Audio-Visual Room (AVR), 4th Floor, Main Building has been reserved for " +
    "the exclusive use of CCS-CSG on July 25, 2026, from 7:00 AM to 6:00 PM (setup and " +
    "teardown included). Venue use is free of charge per the institutional policy for " +
    "accredited student organizations.",
    regular, 10, y);

  y -= 20;
  const sR = PW / 2 + 20;
  page.drawText("Prepared by:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  page.drawText("Certified by:", { x: sR, y, size: 10, font: bold, color: BLACK });
  y -= 40;
  page.drawText("CLARISSE M. SANTOS", { x: MARGIN, y, size: 11, font: bold, color: BLACK });
  page.drawText("JOHN DOE", { x: sR, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Finance Officer, CCS-CSG", { x: MARGIN, y, size: 10, font: italic, color: BLACK });
  page.drawText("President, CCS-CSG", { x: sR, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  fs.writeFileSync(path.join(OUT_DIR, "04_Budgetary_Allocation_Venue_Reservation.pdf"), await pdfDoc.save());
  console.log("  [OK] 04_Budgetary_Allocation_Venue_Reservation.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 05 — Program / Event Flow
// ─────────────────────────────────────────────────────────────────────────────
async function doc05_programFlow() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;
  let { page, y } = await newPage(pdfDoc, fonts);

  y = drawHeaderBlock(page, fonts, y);
  y = drawCentered(page, "PROGRAM OF ACTIVITIES / EVENT FLOW", bold, 12, y, MAROON);
  y -= 4;
  y = drawCentered(page, "TechTalk: Web Development and Career Readiness Seminar", italic, 11, y);
  y -= 14;

  page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 50, color: LIGHT_GRAY });
  const dX = MARGIN + 8;
  page.drawText("Date:",  { x: dX, y: y + 32, size: 10, font: bold, color: BLACK });
  page.drawText("July 25, 2026 (Saturday)",      { x: dX + 36, y: y + 32, size: 10, font: regular, color: BLACK });
  page.drawText("Time:",  { x: dX, y: y + 18, size: 10, font: bold, color: BLACK });
  page.drawText("8:00 AM to 5:00 PM",            { x: dX + 38, y: y + 18, size: 10, font: regular, color: BLACK });
  page.drawText("Venue:", { x: dX, y: y +  4, size: 10, font: bold, color: BLACK });
  page.drawText("EARIST AVR, 4th Floor, Main Building, Nagtahan, Sampaloc, Manila", { x: dX + 42, y: y + 4, size: 10, font: regular, color: BLACK });
  y -= 66;

  const tC0 = MARGIN, tC1 = MARGIN + 100, tC2 = MARGIN + 270;
  const tTop = y;
  page.drawRectangle({ x: tC0, y: tTop - 4, width: CONTENT_W, height: 18, color: MAROON });
  page.drawText("Time",             { x: tC0 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Activity",         { x: tC1 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Person-in-Charge", { x: tC2 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  y = tTop - 8;

  const sched = [
    ["7:00 - 8:00 AM",       "Venue Setup and Registration of Participants",               "Logistics Committee\n(Eva J. Reyes)"],
    ["8:00 - 8:15 AM",       "Opening Prayer and National Anthem",                          "All Participants"],
    ["8:15 - 8:30 AM",       "Welcome Remarks by the CSG President",                        "John Doe, CSG President"],
    ["8:30 - 8:45 AM",       "Introduction of the Resource Person",                         "Program Emcee"],
    ["8:45 - 10:15 AM",      "Session 1: Modern Web Development Landscape\n(Engr. Marco D. Santos)", "Resource Person"],
    ["10:15 - 10:30 AM",     "Open Forum / Q&A -- Session 1",                               "Emcee & Resource Person"],
    ["10:30 - 10:45 AM",     "Short Break / Snacks",                                        "Logistics Committee"],
    ["10:45 AM - 12:15 PM",  "Session 2: Tools and Frameworks in the Industry\n(Engr. Marco D. Santos)", "Resource Person"],
    ["12:15 - 1:00 PM",      "Lunch Break",                                                 "All Participants"],
    ["1:00 - 2:30 PM",       "Session 3: Career Readiness and Tech Industry Realities",     "Resource Person"],
    ["2:30 - 2:45 PM",       "Open Forum / Q&A -- Session 3",                               "Emcee & Resource Person"],
    ["2:45 - 3:00 PM",       "Short Break",                                                 "All Participants"],
    ["3:00 - 4:00 PM",       "Workshop: Portfolio Building and GitHub Basics",               "Resource Person & Tech Committee"],
    ["4:00 - 4:20 PM",       "Distribution of Certificates of Participation",               "Finance Officer & Logistics"],
    ["4:20 - 4:40 PM",       "Evaluation and Feedback Form Filling",                        "All Participants"],
    ["4:40 - 5:00 PM",       "Closing Remarks and Photo Documentation",                     "CSG President"],
    ["5:00 PM onwards",      "Venue Cleanup and Turnover",                                  "Logistics Committee"],
  ];

  for (let i = 0; i < sched.length; i++) {
    const [time, act, pic] = sched[i];
    const aLines = act.split("\n"), pLines = pic.split("\n");
    const rowH = Math.max(aLines.length, pLines.length) * 13 + 6;
    const bg = i % 2 === 1 ? LIGHT_GRAY : WHITE;
    page.drawRectangle({ x: tC0, y: y - rowH + 10, width: CONTENT_W, height: rowH, color: bg });
    page.drawText(time, { x: tC0 + 4, y: y + 1, size: 9, font: regular, color: BLACK });
    aLines.forEach((ln, li) => page.drawText(ln, { x: tC1 + 4, y: y + 1 - li * 13, size: 9, font: li === 0 ? regular : italic, color: BLACK }));
    pLines.forEach((ln, li) => page.drawText(ln, { x: tC2 + 4, y: y + 1 - li * 13, size: 9, font: italic, color: DARK_GRAY }));
    y -= rowH;
  }

  y -= 16;
  page.drawText("Prepared by:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  y -= 36;
  page.drawText("ANGELA R. FLORES", { x: MARGIN, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Overall Event Coordinator / CSG President", { x: MARGIN, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  fs.writeFileSync(path.join(OUT_DIR, "05_Program_Event_Flow.pdf"), await pdfDoc.save());
  console.log("  [OK] 05_Program_Event_Flow.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 06 — Profile of Speakers/Facilitators
// ─────────────────────────────────────────────────────────────────────────────
async function doc06_speakerProfile() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;
  let { page, y } = await newPage(pdfDoc, fonts);

  y = drawHeaderBlock(page, fonts, y);
  y = drawCentered(page, "PROFILE OF SPEAKERS / FACILITATORS", bold, 12, y, MAROON);
  y -= 4;
  y = drawCentered(page, "TechTalk: Web Development and Career Readiness Seminar", italic, 11, y);
  y -= 4;
  y = drawCentered(page, "July 25, 2026  |  EARIST AVR, 4th Floor, Main Building", regular, 10, y, DARK_GRAY);
  y -= 20;

  y = drawHRule(page, y, 1.5, MAROON);
  y = drawLeft(page, "RESOURCE PERSON / SPEAKER", bold, 11, y, MARGIN, MAROON);
  y -= 4;
  y = drawLeft(page, "Engr. Marco D. Santos", bold, 14, y);
  y = drawLeft(page, "Senior Full-Stack Developer -- TechBridge PH Inc.", italic, 11, y);
  y -= 6;
  y = drawHRule(page, y, 0.5);

  const sections = [
    ["Educational Background:", [
      "Bachelor of Science in Computer Engineering -- Polytechnic University of the Philippines (2012)",
      "Master of Science in Information Technology -- Technological Institute of the Philippines (2018, ongoing)",
    ]],
    ["Professional Experience:", [
      "Senior Full-Stack Developer, TechBridge PH Inc. (2020 - Present)",
      "  * Leads a team of 8 developers building enterprise-grade web apps using React, Node.js, and AWS.",
      "  * Specializes in cloud-native architecture, RESTful API design, and DevOps automation.",
      "Full-Stack Developer, CodeSync Solutions (2016 - 2020)",
      "  * Developed e-commerce platforms and payment integrations for mid-market clients.",
      "Junior Web Developer, ByteForge Labs (2012 - 2016)",
      "  * Focused on front-end development using HTML5, CSS3, JavaScript, and early React.",
    ]],
    ["Technical Expertise:", [
      "Front-End: React.js, Vue.js, HTML5, CSS3, Tailwind CSS, TypeScript",
      "Back-End: Node.js, Express, Python (Django), REST APIs, GraphQL",
      "Database: PostgreSQL, MySQL, MongoDB, Firebase Firestore",
      "DevOps / Cloud: AWS (EC2, S3, Lambda), Docker, GitHub Actions, CI/CD pipelines",
    ]],
    ["Certifications:", [
      "AWS Certified Developer - Associate (Amazon Web Services, 2021)",
      "Google Professional Cloud Developer (Google Cloud, 2022)",
      "Certified Scrum Master (Scrum Alliance, 2019)",
    ]],
    ["Civic and Academic Engagements:", [
      "Guest Lecturer, PUP College of Engineering -- Web Technologies (AY 2023-2024)",
      "Speaker, PH Tech Summit 2023 -- \"Building Scalable Full-Stack Apps in the Philippines\"",
      "Mentor, Google Developer Student Clubs (GDSC) PH -- Chapter Mentor (2021 - Present)",
      "Volunteer Trainer, UP ITTC Digital Literacy Program (2020)",
    ]],
    ["Session Topics:", [
      "Session 1: \"Modern Web Development Landscape\"",
      "Session 2: \"Tools and Frameworks in the Industry\"",
      "Session 3: \"Career Readiness and Tech Industry Realities\"",
      "Workshop: \"Portfolio Building and GitHub Basics\"",
    ]],
  ];

  for (const [heading, items] of sections) {
    y = drawLeft(page, heading, bold, 10, y);
    for (const item of items) {
      y = drawWrapped(page, item, regular, 10, y, CONTENT_W - 12, MARGIN + 12);
    }
    y -= 6;
  }

  y -= 8;
  y = drawHRule(page, y, 1, MAROON);
  y -= 6;
  y = drawLeft(page, "Confirmed by:", bold, 10, y);
  y -= 36;
  const sR = PW / 2 + 20;
  page.drawText("Engr. MARCO D. SANTOS", { x: MARGIN, y, size: 11, font: bold, color: BLACK });
  page.drawText("JOHN DOE",              { x: sR,     y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Resource Person",       { x: MARGIN, y, size: 10, font: italic, color: BLACK });
  page.drawText("President, CCS-CSG",   { x: sR,     y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  fs.writeFileSync(path.join(OUT_DIR, "06_Speaker_Facilitator_Profile.pdf"), await pdfDoc.save());
  console.log("  [OK] 06_Speaker_Facilitator_Profile.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 07 — Equipment Borrowing Form
// ─────────────────────────────────────────────────────────────────────────────
async function doc07_equipmentBorrowingForm() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;
  let { page, y } = await newPage(pdfDoc, fonts);

  y = drawHeaderBlock(page, fonts, y);

  y = drawCentered(page, "LEADERSHIP DIVISION", bold, 11, y, MAROON);
  y = drawCentered(page, "EQUIPMENT BORROWING FORM", bold, 13, y, MAROON);
  y -= 6;
  y = drawHRule(page, y, 1, MAROON);

  // Form number and date row
  const fRight = PW / 2 + 10;
  page.drawText("Form No.:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  page.drawLine({ start: { x: MARGIN + 55, y: y - 2 }, end: { x: MARGIN + 200, y: y - 2 }, thickness: 0.5, color: BLACK });
  page.drawText("Date:", { x: fRight, y, size: 10, font: bold, color: BLACK });
  page.drawLine({ start: { x: fRight + 35, y: y - 2 }, end: { x: PW - MARGIN, y: y - 2 }, thickness: 0.5, color: BLACK });
  y -= 24;

  // Section A: Borrower Information
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_W, height: 16, color: MAROON });
  page.drawText("A.  BORROWER INFORMATION", { x: MARGIN + 6, y: y + 1, size: 10, font: bold, color: WHITE });
  y -= 22;

  const fieldRows = [
    [["Name of Borrower:", 160], ["Student No.:", 120]],
    [["Course / Year / Section:", 160], ["Contact No.:", 120]],
    [["Organization / Department:", 160], ["", 0]],
    [["Purpose / Event Title:", 160], ["", 0]],
  ];

  for (const row of fieldRows) {
    let cx = MARGIN;
    for (const [label, fieldW] of row) {
      if (!label) continue;
      const lw = bold.widthOfTextAtSize(label, 10);
      page.drawText(label, { x: cx, y, size: 10, font: bold, color: BLACK });
      const lineEnd = fieldW > 0 ? cx + lw + fieldW : PW - MARGIN;
      page.drawLine({ start: { x: cx + lw + 4, y: y - 2 }, end: { x: lineEnd, y: y - 2 }, thickness: 0.5, color: BLACK });
      cx = lineEnd + 16;
    }
    y -= 22;
  }

  y -= 8;

  // Section B: Borrowing Details
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_W, height: 16, color: MAROON });
  page.drawText("B.  BORROWING DETAILS", { x: MARGIN + 6, y: y + 1, size: 10, font: bold, color: WHITE });
  y -= 22;

  const dateRow = [
    ["Date of Use:", 100],
    ["Time Out:", 100],
    ["Time In / Return:", 120],
  ];
  let dcx = MARGIN;
  for (const [label, fw] of dateRow) {
    const lw = bold.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: dcx, y, size: 10, font: bold, color: BLACK });
    page.drawLine({ start: { x: dcx + lw + 4, y: y - 2 }, end: { x: dcx + lw + fw, y: y - 2 }, thickness: 0.5, color: BLACK });
    dcx += lw + fw + 20;
  }
  y -= 22;

  page.drawText("Venue / Location of Use:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  page.drawLine({ start: { x: MARGIN + 130, y: y - 2 }, end: { x: PW - MARGIN, y: y - 2 }, thickness: 0.5, color: BLACK });
  y -= 30;

  // Section C: Equipment Table
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_W, height: 16, color: MAROON });
  page.drawText("C.  EQUIPMENT / ITEM DETAILS", { x: MARGIN + 6, y: y + 1, size: 10, font: bold, color: WHITE });
  y -= 16;

  const eC0 = MARGIN;
  const eC1 = MARGIN + 30;
  const eC2 = MARGIN + 180;
  const eC3 = MARGIN + 280;
  const eC4 = MARGIN + 340;
  const eC5 = PW - MARGIN;

  page.drawRectangle({ x: eC0, y: y - 4, width: CONTENT_W, height: 18, color: LIGHT_GRAY });
  page.drawText("No.", { x: eC0 + 4, y: y + 1, size: 9, font: bold, color: BLACK });
  page.drawText("Item / Equipment Name", { x: eC1 + 4, y: y + 1, size: 9, font: bold, color: BLACK });
  page.drawText("Description / Specs", { x: eC2 + 4, y: y + 1, size: 9, font: bold, color: BLACK });
  page.drawText("Qty", { x: eC3 + 4, y: y + 1, size: 9, font: bold, color: BLACK });
  page.drawText("Condition Out", { x: eC4 + 4, y: y + 1, size: 9, font: bold, color: BLACK });
  page.drawText("Condition In", { x: eC5 - bold.widthOfTextAtSize("Condition In", 9) - 4, y: y + 1, size: 9, font: bold, color: BLACK });
  y -= 18;

  for (let i = 1; i <= 8; i++) {
    const bg = i % 2 === 0 ? LIGHT_GRAY : WHITE;
    page.drawRectangle({ x: eC0, y: y - 4, width: CONTENT_W, height: 18, color: bg });
    page.drawText(String(i), { x: eC0 + 4, y: y + 1, size: 9, font: regular, color: BLACK });
    // Column separator lines
    for (const cx of [eC1, eC2, eC3, eC4, eC5]) {
      page.drawLine({ start: { x: cx, y: y - 4 }, end: { x: cx, y: y + 14 }, thickness: 0.3, color: DARK_GRAY });
    }
    y -= 18;
  }
  page.drawLine({ start: { x: eC0, y }, end: { x: eC5, y }, thickness: 0.5, color: DARK_GRAY });
  y -= 20;

  // Section D: Condition Notes
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_W, height: 16, color: MAROON });
  page.drawText("D.  CONDITION NOTES / REMARKS", { x: MARGIN + 6, y: y + 1, size: 10, font: bold, color: WHITE });
  y -= 22;

  for (const label of ["Upon Release:", "Upon Return:"]) {
    page.drawText(label, { x: MARGIN, y, size: 10, font: bold, color: BLACK });
    page.drawLine({ start: { x: MARGIN + 80, y: y - 2 }, end: { x: PW - MARGIN, y: y - 2 }, thickness: 0.5, color: BLACK });
    y -= 18;
    page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: PW - MARGIN, y: y - 2 }, thickness: 0.5, color: BLACK });
    y -= 22;
  }

  y -= 6;

  // Section E: Signatures
  y = drawHRule(page, y, 1, MAROON);
  y = drawCentered(page, "SIGNATURES", bold, 10, y, MAROON);
  y -= 10;

  const sigCols = [MARGIN, PW / 2 - 30, PW - MARGIN - 130];
  const sigLabels = ["Borrower", "Equipment Custodian", "Approving Officer"];
  const sigTitles = ["Signature over Printed Name", "SAS / Org Officer", "SAS Director / Adviser"];

  page.drawText("Signature:", { x: sigCols[0], y, size: 9, font: bold, color: BLACK });
  page.drawText("Signature:", { x: sigCols[1], y, size: 9, font: bold, color: BLACK });
  page.drawText("Signature:", { x: sigCols[2], y, size: 9, font: bold, color: BLACK });
  y -= 36;

  for (let i = 0; i < sigCols.length; i++) {
    page.drawLine({ start: { x: sigCols[i], y: y - 2 }, end: { x: sigCols[i] + 130, y: y - 2 }, thickness: 0.5, color: BLACK });
    y -= 0;
  }
  const sigY = y;
  for (let i = 0; i < sigCols.length; i++) {
    page.drawText(sigLabels[i], { x: sigCols[i], y: sigY - 14, size: 9, font: bold, color: BLACK });
    page.drawText(sigTitles[i], { x: sigCols[i], y: sigY - 26, size: 8, font: italic, color: DARK_GRAY });
  }
  y -= 36;

  y -= 16;
  page.drawText("Date Returned:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  page.drawLine({ start: { x: MARGIN + 90, y: y - 2 }, end: { x: MARGIN + 250, y: y - 2 }, thickness: 0.5, color: BLACK });
  page.drawText("Received by:", { x: PW / 2 + 10, y, size: 10, font: bold, color: BLACK });
  page.drawLine({ start: { x: PW / 2 + 80, y: y - 2 }, end: { x: PW - MARGIN, y: y - 2 }, thickness: 0.5, color: BLACK });

  // Footer
  page.drawText("EARIST-QSF-SAS-EBF  |  Leadership Division, Student Affairs and Services", {
    x: MARGIN, y: 30, size: 7.5, font: italic, color: DARK_GRAY,
  });

  fs.writeFileSync(path.join(OUT_DIR, "07_Equipment_Borrowing_Form.pdf"), await pdfDoc.save());
  console.log("  [OK] 07_Equipment_Borrowing_Form.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
console.log("Generating / updating EARIST dummy documents...");
console.log(`Output: ${OUT_DIR}\n`);

await doc01_requestLetterISG();
await doc02_requestLetterPresident();
await doc03_watermarkExisting();
await doc04_budgetaryAllocation();
await doc05_programFlow();
await doc06_speakerProfile();
await doc07_equipmentBorrowingForm();

console.log("\nDone.");
