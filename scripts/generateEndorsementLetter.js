/**
 * Generates a sample SAS Endorsement Letter PDF for the TechTalk seminar activity,
 * matching the EARIST-aligned style of scripts/generateDummyDocs.js.
 *
 * Output: docs/dummy_docs/SAS_Endorsement_Letter.pdf
 *
 * Usage: node scripts/generateEndorsementLetter.js
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
const INK_BLUE = rgb(0.06, 0.12, 0.42);

// ── Page constants (Letter = 612 x 792 pts) ───────────────────────────────────
const [PW, PH] = PageSizes.Letter;
const MARGIN = 72; // 1 inch
const CONTENT_W = PW - MARGIN * 2;
const WATERMARK_SIZE = 6 * 72; // 6 inches in points

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

function drawHRule(page, y, thickness = 0.5, color = DARK_GRAY) {
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PW - MARGIN, y }, thickness, color });
  return y - 8;
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

function footerNote(page, fonts) {
  page.drawText("EARIST-QSF-SAS-006  |  Leadership Division, Student Affairs and Services", {
    x: MARGIN, y: 30, size: 7.5, font: fonts.italic, color: DARK_GRAY,
  });
}

// ── Sample handwritten e-signature ────────────────────────────────────────────
// Drawn as an SVG path so it reads like ink. (x, y) anchors the top-left of the
// signature's coordinate box; the strokes flow downward from there.
function drawSignature(page, x, y, scale = 1) {
  const sig =
    "M2,28 C7,4 13,3 16,26 C17,33 11,33 13,21 C15,7 25,5 30,25 " +
    "C32,33 25,33 27,19 C30,6 41,9 45,25 C47,32 40,33 42,21 " +
    "C45,8 58,7 61,27 C62,33 55,34 57,23 C61,8 74,9 80,25 " +
    "C86,37 98,16 106,23 C112,28 116,22 120,16 " +
    "M0,36 C34,30 86,30 124,35";
  page.drawSvgPath(sig, {
    x,
    y,
    scale,
    borderColor: INK_BLUE,
    borderWidth: 1.4,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SAS Endorsement Letter
// ─────────────────────────────────────────────────────────────────────────────
async function generateEndorsementLetter() {
  const pdfDoc = await PDFDocument.create();
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;

  const page = pdfDoc.addPage(PageSizes.Letter);
  await addWatermark(pdfDoc, page);
  let y = PH - MARGIN;

  y = drawHeaderBlock(page, fonts, y);

  // Title
  y = drawCentered(page, "LETTER OF ENDORSEMENT", bold, 13, y, MAROON);
  y -= 10;

  // Reference and date
  y = drawLeft(page, "SAS Ref. No.: SAS-END-2026-072", regular, 10, y, MARGIN, DARK_GRAY);
  y = drawLeft(page, "July 15, 2026", regular, 11, y);
  y -= 8;

  // Addressee
  y = drawLeft(page, "DR. JOSE ANTONIO R. REYES, Ph.D.", bold, 11, y);
  y = drawLeft(page, "Institute President", italic, 11, y);
  y = drawLeft(page, 'Eulogio "Amang" Rodriguez Institute of Science and Technology', regular, 11, y);
  y = drawLeft(page, "Nagtahan, Sampaloc, Manila", regular, 11, y);
  y -= 12;

  y = drawLeft(page, "Dear Dr. Reyes,", regular, 11, y);
  y -= 6;

  y = drawLeft(page, "Subject:  Endorsement of the TechTalk: Web Development and Career Readiness Seminar", bold, 11, y);
  y -= 12;

  y = drawJustified(page,
    "Greetings of peace and goodwill from the Office of Student Affairs and Services (SAS)!",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "Upon thorough review of the documents submitted by the College of Computing Studies " +
    "Student Government (CCS-CSG), this Office respectfully ENDORSES for your approval their " +
    "proposed activity entitled \"TechTalk: Web Development and Career Readiness Seminar,\" " +
    "scheduled on July 25, 2026, from 8:00 AM to 5:00 PM at the EARIST Audio-Visual Room " +
    "(AVR), 4th Floor, Main Building.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "The activity aims to equip approximately fifty (50) BS Computer Science and BS " +
    "Information Technology students with practical knowledge on current web development " +
    "trends and career readiness skills through the guidance of an industry practitioner. " +
    "After evaluation, this Office finds the activity to be in order, educationally relevant, " +
    "and consistent with the institutional mission of providing quality technological " +
    "education and holistic student development.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "The complete set of supporting documents -- including the Student Activity Proposal " +
    "Form (EARIST-QSF-SAS-006), Budgetary Allocation and Venue Reservation, Program Flow, " +
    "and Speaker Profile -- have been verified and found compliant with the requirements " +
    "set forth by this Office.",
    regular, 11, y);
  y -= 8;

  y = drawJustified(page,
    "In view of the foregoing, we respectfully recommend the approval of this activity. " +
    "Your favorable action on this endorsement is highly appreciated.",
    regular, 11, y);
  y -= 16;

  y = drawLeft(page, "Respectfully endorsed,", regular, 11, y);
  y -= 50;

  // Sample e-signature sits just above the Director's printed name.
  drawSignature(page, MARGIN + 6, y + 42);
  y = drawLeft(page, "Ms. AGNES F. AMORIN", bold, 11, y);
  y = drawLeft(page, "Director, Student Affairs and Services", italic, 11, y);

  footerNote(page, fonts);

  const outPath = path.join(OUT_DIR, "SAS_Endorsement_Letter.pdf");
  fs.writeFileSync(outPath, await pdfDoc.save());
  console.log(`  [OK] ${path.basename(outPath)}`);
}

console.log("Generating SAS Endorsement Letter...");
console.log(`Output: ${OUT_DIR}\n`);
await generateEndorsementLetter();
console.log("\nDone.");
