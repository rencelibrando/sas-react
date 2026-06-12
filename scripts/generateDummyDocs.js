/**
 * Generates 5 dummy EARIST-aligned PDF documents for the TechTalk seminar activity:
 *   1. Request Letter to ISG President
 *   2. Request Letter to Institute President
 *   3. Budgetary Allocation and Venue Reservation
 *   4. Program / Event Flow
 *   5. Profile of Speakers/Facilitators
 *
 * Usage: node scripts/generateDummyDocs.js
 * Output: docs/dummy/
 */

import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../docs/dummy");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Colors
const MAROON = rgb(0.502, 0, 0.125);
const BLACK = rgb(0, 0, 0);
const DARK_GRAY = rgb(0.2, 0.2, 0.2);
const LIGHT_GRAY = rgb(0.9, 0.9, 0.9);
const WHITE = rgb(1, 1, 1);

// Page constants
const [PW, PH] = PageSizes.Letter;
const MARGIN = 72;
const CONTENT_W = PW - MARGIN * 2;

async function getFonts(doc) {
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  return { regular, bold, italic };
}

// Drawing helpers

function drawHeaderBlock(page, fonts, y) {
  const { regular, bold } = fonts;
  const cx = PW / 2;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PW - MARGIN, y }, thickness: 1.5, color: MAROON });
  y -= 14;

  const line1 = "Republic of the Philippines";
  page.drawText(line1, { x: cx - regular.widthOfTextAtSize(line1, 9) / 2, y, size: 9, font: regular, color: BLACK });
  y -= 13;

  const line2 = 'EULOGIO "AMANG" RODRIGUEZ INSTITUTE OF SCIENCE AND TECHNOLOGY';
  page.drawText(line2, { x: cx - bold.widthOfTextAtSize(line2, 10) / 2, y, size: 10, font: bold, color: BLACK });
  y -= 12;

  const line3 = "Nagtahan, Sampaloc, Manila";
  page.drawText(line3, { x: cx - regular.widthOfTextAtSize(line3, 9) / 2, y, size: 9, font: regular, color: BLACK });
  y -= 14;

  const line4 = "STUDENT AFFAIRS AND SERVICES";
  page.drawText(line4, { x: cx - bold.widthOfTextAtSize(line4, 11) / 2, y, size: 11, font: bold, color: MAROON });
  y -= 8;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PW - MARGIN, y }, thickness: 1, color: MAROON });
  return y - 20;
}

function drawCenteredText(page, text, font, size, y, color = BLACK) {
  page.drawText(text, { x: (PW - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  return y - size - 4;
}

function drawLeftText(page, text, font, size, y, x = MARGIN, color = BLACK) {
  page.drawText(text, { x, y, size, font, color });
  return y - size - 4;
}

function drawWrappedText(page, text, font, size, y, maxWidth = CONTENT_W, x = MARGIN, color = BLACK, lineSpacing = 6) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color });
      y -= size + lineSpacing;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color });
    y -= size + lineSpacing;
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

// ─────────────────────────────────────────────────────────────────────────────
// Document 1 - Request Letter to ISG President
// ─────────────────────────────────────────────────────────────────────────────
async function doc1_requestLetterISG() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.Letter);
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;

  let y = PH - MARGIN;
  y = drawHeaderBlock(page, fonts, y);

  y = drawLeftText(page, "July 10, 2026", regular, 11, y);
  y -= 8;

  y = drawLeftText(page, "Mr. CARL JUSTINE B. DIOQUINO", bold, 11, y);
  y = drawLeftText(page, "ISG President", italic, 11, y);
  y = drawLeftText(page, "Institute Student Government", regular, 11, y);
  y = drawLeftText(page, 'Eulogio "Amang" Rodriguez Institute of Science and Technology', regular, 11, y);
  y = drawLeftText(page, "Nagtahan, Sampaloc, Manila", regular, 11, y);
  y -= 10;

  y = drawLeftText(page, "Dear Mr. Dioquino,", regular, 11, y);
  y -= 8;

  const body1 =
    "We, the College of Computing Studies Student Government (CCS-CSG), respectfully " +
    "request your esteemed office to endorse our planned activity entitled \"TechTalk: " +
    "Web Development and Career Readiness Seminar.\" This seminar is scheduled on " +
    "July 25, 2026, from 8:00 AM to 5:00 PM at the EARIST Audio-Visual Room (AVR), " +
    "4th Floor, Main Building.";
  y = drawWrappedText(page, body1, regular, 11, y);
  y -= 8;

  const body2 =
    "The activity aims to equip 2nd to 4th Year BS Computer Science and BS Information " +
    "Technology students with practical knowledge on current web development trends and " +
    "career readiness skills through the guidance of an industry practitioner. We expect " +
    "approximately fifty (50) participants.";
  y = drawWrappedText(page, body2, regular, 11, y);
  y -= 8;

  const body3 =
    "Attached herewith is our Student Activity Proposal Form (EARIST-QSF-SAS-006) along " +
    "with the supporting documents for your reference and favorable action. We humbly " +
    "request your endorsement so that we may proceed with the submission to the Student " +
    "Affairs and Services office.";
  y = drawWrappedText(page, body3, regular, 11, y);
  y -= 8;

  y = drawWrappedText(page, "Thank you very much for your kind consideration and support.", regular, 11, y);
  y -= 20;

  y = drawLeftText(page, "Respectfully yours,", regular, 11, y);
  y -= 50;

  y = drawLeftText(page, "JOHN DOE", bold, 11, y);
  y = drawLeftText(page, "President, CCS-CSG", italic, 11, y);
  y -= 20;

  y = drawHRule(page, y);
  y = drawCenteredText(page, "Noted by:", bold, 10, y, MAROON);
  y -= 8;

  const col1 = MARGIN;
  const col2 = PW / 2 + 10;
  page.drawText("JOHN DOE", { x: col1, y, size: 11, font: bold, color: BLACK });
  page.drawText("Prof. ERNANIE M. CARLOS JR., MIT", { x: col2, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Adviser, CCS-CSG", { x: col1, y, size: 10, font: italic, color: BLACK });
  page.drawText("College Dean, College of Computing Studies", { x: col2, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(OUT_DIR, "01_Request_Letter_ISG_President.pdf"), bytes);
  console.log("  [OK] 01_Request_Letter_ISG_President.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 2 - Request Letter to Institute President
// ─────────────────────────────────────────────────────────────────────────────
async function doc2_requestLetterPresident() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.Letter);
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;

  let y = PH - MARGIN;
  y = drawHeaderBlock(page, fonts, y);

  y = drawLeftText(page, "July 10, 2026", regular, 11, y);
  y -= 8;

  y = drawLeftText(page, "DR. JOSE ANTONIO R. REYES, Ph.D.", bold, 11, y);
  y = drawLeftText(page, "Institute President", italic, 11, y);
  y = drawLeftText(page, 'Eulogio "Amang" Rodriguez Institute of Science and Technology', regular, 11, y);
  y = drawLeftText(page, "Nagtahan, Sampaloc, Manila", regular, 11, y);
  y -= 10;

  y = drawLeftText(page, "Dear Dr. Reyes,", regular, 11, y);
  y -= 8;

  const body1 =
    "On behalf of the College of Computing Studies Student Government (CCS-CSG), we " +
    "respectfully request your approval for our planned seminar entitled \"TechTalk: " +
    "Web Development and Career Readiness Seminar.\" The event is set on July 25, 2026, " +
    "8:00 AM to 5:00 PM at the EARIST Audio-Visual Room (AVR), 4th Floor, Main Building.";
  y = drawWrappedText(page, body1, regular, 11, y);
  y -= 8;

  const body2 =
    "This seminar is designed to bridge the gap between academic learning and industry " +
    "practice. An experienced Full-Stack Developer from TechBridge PH Inc. will serve as " +
    "our resource person, sharing current insights on web development tools and career " +
    "pathways in the technology sector. The activity targets approximately fifty (50) " +
    "students from BS Computer Science and BS Information Technology programs.";
  y = drawWrappedText(page, body2, regular, 11, y);
  y -= 8;

  const body3 =
    "The total proposed budget is PHP 6,500.00, sourced from the Student Government Fund " +
    "(PHP 3,500.00), organizational funds (PHP 2,000.00), and alumni donations/sponsorships " +
    "(PHP 1,000.00). All supporting documents -- including the Activity Proposal Form, " +
    "Budgetary Allocation, Program Flow, and Speaker Profile -- are attached herewith.";
  y = drawWrappedText(page, body3, regular, 11, y);
  y -= 8;

  const body4 =
    "We humbly seek your favorable approval to proceed with this activity in accordance " +
    "with EARIST's mission of providing quality technological education.";
  y = drawWrappedText(page, body4, regular, 11, y);
  y -= 20;

  y = drawLeftText(page, "Respectfully yours,", regular, 11, y);
  y -= 50;

  y = drawLeftText(page, "JOHN DOE", bold, 11, y);
  y = drawLeftText(page, "President, CCS-CSG", italic, 11, y);
  y -= 14;

  y = drawHRule(page, y);
  y = drawCenteredText(page, "Endorsed by:", bold, 10, y, MAROON);
  y -= 8;

  const col1 = MARGIN;
  const col2 = PW / 2 + 10;
  page.drawText("JOHN DOE", { x: col1, y, size: 11, font: bold, color: BLACK });
  page.drawText("Prof. ERNANIE M. CARLOS JR., MIT", { x: col2, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Adviser, CCS-CSG", { x: col1, y, size: 10, font: italic, color: BLACK });
  page.drawText("College Dean, College of Computing Studies", { x: col2, y, size: 10, font: italic, color: BLACK });
  y -= 24;

  page.drawText("MR. CARL JUSTINE B. DIOQUINO", { x: col1, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("ISG President", { x: col1, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(OUT_DIR, "02_Request_Letter_Institute_President.pdf"), bytes);
  console.log("  [OK] 02_Request_Letter_Institute_President.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 3 - Budgetary Allocation and Venue Reservation
// ─────────────────────────────────────────────────────────────────────────────
async function doc3_budgetaryAllocation() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.Letter);
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;

  let y = PH - MARGIN;
  y = drawHeaderBlock(page, fonts, y);

  y = drawCenteredText(page, "BUDGETARY ALLOCATION AND VENUE RESERVATION", bold, 12, y, MAROON);
  y -= 4;
  y = drawCenteredText(page, "TechTalk: Web Development and Career Readiness Seminar", italic, 11, y);
  y -= 16;

  const infoRight = MARGIN + 150;
  const rowGap = 16;
  const infoRows = [
    ["Proponent:", "College of Computing Studies - CSG (CCS-CSG)"],
    ["Activity Date:", "July 25, 2026"],
    ["Time:", "8:00 AM to 5:00 PM"],
    ["Venue:", "EARIST AVR, 4th Floor, Main Building"],
    ["No. of Participants:", "50"],
  ];
  for (const [label, value] of infoRows) {
    page.drawText(label, { x: MARGIN, y, size: 10, font: bold, color: BLACK });
    page.drawText(value, { x: infoRight, y, size: 10, font: regular, color: BLACK });
    y -= rowGap;
  }

  y -= 8;
  y = drawHRule(page, y, 1, MAROON);

  const col0 = MARGIN;
  const col1 = MARGIN + 250;
  const col2 = MARGIN + 330;
  const col3 = PW - MARGIN - 5;
  const tableTop = y;

  page.drawRectangle({ x: col0, y: tableTop - 4, width: CONTENT_W, height: 18, color: MAROON });
  page.drawText("Particulars", { x: col0 + 4, y: tableTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Quantity", { x: col1 + 4, y: tableTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Unit Cost", { x: col2 + 4, y: tableTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Amount", { x: col3 - bold.widthOfTextAtSize("Amount", 10) - 4, y: tableTop + 1, size: 10, font: bold, color: WHITE });
  y = tableTop - 8;

  const rows = [
    ["Venue Rental (Audio-Visual Room)", "1", "PHP 0.00", "PHP 0.00 (free for org)"],
    ["Tarpaulin / Event Banner (3x6 ft)", "2 pcs", "PHP 300.00", "PHP 600.00"],
    ["Printing of Certificates", "50 pcs", "PHP 10.00", "PHP 500.00"],
    ["Snacks and Light Refreshments", "50 pax", "PHP 50.00", "PHP 2,500.00"],
    ["Speaker / Resource Person Honorarium", "1", "PHP 1,500.00", "PHP 1,500.00"],
    ["Documentation (Photography)", "1", "PHP 500.00", "PHP 500.00"],
    ["Supplies and Materials (paper, pens, etc.)", "1 lot", "PHP 400.00", "PHP 400.00"],
    ["Miscellaneous", "--", "--", "PHP 500.00"],
  ];

  for (let i = 0; i < rows.length; i++) {
    const [particulars, qty, unit, amount] = rows[i];
    const rowBg = i % 2 === 1 ? LIGHT_GRAY : WHITE;
    page.drawRectangle({ x: col0, y: y - 4, width: CONTENT_W, height: 16, color: rowBg });
    page.drawText(particulars, { x: col0 + 4, y: y + 1, size: 10, font: regular, color: BLACK });
    page.drawText(qty, { x: col1 + 4, y: y + 1, size: 10, font: regular, color: BLACK });
    page.drawText(unit, { x: col2 + 4, y: y + 1, size: 10, font: regular, color: BLACK });
    const aw = regular.widthOfTextAtSize(amount, 10);
    page.drawText(amount, { x: col3 - aw - 4, y: y + 1, size: 10, font: regular, color: BLACK });
    y -= 16;
  }

  page.drawRectangle({ x: col0, y: y - 4, width: CONTENT_W, height: 18, color: MAROON });
  page.drawText("TOTAL", { x: col0 + 4, y: y + 1, size: 11, font: bold, color: WHITE });
  const totalStr = "PHP 6,500.00";
  page.drawText(totalStr, { x: col3 - bold.widthOfTextAtSize(totalStr, 11) - 4, y: y + 1, size: 11, font: bold, color: WHITE });
  y -= 24;

  y = drawHRule(page, y, 0.5, MAROON);
  y = drawLeftText(page, "Proposed Source of Funds:", bold, 11, y);
  y -= 4;
  const sources = [
    "* Student Government Fund:  PHP 3,500.00",
    "* Organization (CCS-CSG):  PHP 2,000.00",
    "* Others (Donations / Sponsorships from alumni):  PHP 1,000.00",
  ];
  for (const s of sources) {
    y = drawLeftText(page, s, regular, 10, y, MARGIN + 12);
  }

  y -= 16;
  y = drawHRule(page, y, 0.5, MAROON);
  y = drawLeftText(page, "Venue Reservation:", bold, 11, y);
  y -= 4;
  const venueText =
    "The EARIST Audio-Visual Room (AVR), 4th Floor, Main Building has been reserved for " +
    "the exclusive use of CCS-CSG on July 25, 2026, from 7:00 AM to 6:00 PM (setup and " +
    "teardown included). Venue use is free of charge per the institutional policy for " +
    "accredited student organizations.";
  y = drawWrappedText(page, venueText, regular, 10, y);

  y -= 20;
  const sigRight = PW / 2 + 20;
  page.drawText("Prepared by:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  page.drawText("Certified by:", { x: sigRight, y, size: 10, font: bold, color: BLACK });
  y -= 40;
  page.drawText("CLARISSE M. SANTOS", { x: MARGIN, y, size: 11, font: bold, color: BLACK });
  page.drawText("JOHN DOE", { x: sigRight, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Finance Officer, CCS-CSG", { x: MARGIN, y, size: 10, font: italic, color: BLACK });
  page.drawText("President, CCS-CSG", { x: sigRight, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(OUT_DIR, "03_Budgetary_Allocation_Venue_Reservation.pdf"), bytes);
  console.log("  [OK] 03_Budgetary_Allocation_Venue_Reservation.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 4 - Program / Event Flow
// ─────────────────────────────────────────────────────────────────────────────
async function doc4_programFlow() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.Letter);
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;

  let y = PH - MARGIN;
  y = drawHeaderBlock(page, fonts, y);

  y = drawCenteredText(page, "PROGRAM OF ACTIVITIES / EVENT FLOW", bold, 12, y, MAROON);
  y -= 4;
  y = drawCenteredText(page, "TechTalk: Web Development and Career Readiness Seminar", italic, 11, y);
  y -= 14;

  page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 50, color: LIGHT_GRAY });
  const dX = MARGIN + 8;
  page.drawText("Date:", { x: dX, y: y + 32, size: 10, font: bold, color: BLACK });
  page.drawText("July 25, 2026 (Saturday)", { x: dX + 36, y: y + 32, size: 10, font: regular, color: BLACK });
  page.drawText("Time:", { x: dX, y: y + 18, size: 10, font: bold, color: BLACK });
  page.drawText("8:00 AM to 5:00 PM", { x: dX + 38, y: y + 18, size: 10, font: regular, color: BLACK });
  page.drawText("Venue:", { x: dX, y: y + 4, size: 10, font: bold, color: BLACK });
  page.drawText("EARIST AVR, 4th Floor, Main Building, Nagtahan, Sampaloc, Manila", { x: dX + 42, y: y + 4, size: 10, font: regular, color: BLACK });
  y -= 66;

  const tCol0 = MARGIN;
  const tCol1 = MARGIN + 100;
  const tCol2 = MARGIN + 270;
  const tTop = y;

  page.drawRectangle({ x: tCol0, y: tTop - 4, width: CONTENT_W, height: 18, color: MAROON });
  page.drawText("Time", { x: tCol0 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Activity", { x: tCol1 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  page.drawText("Person-in-Charge", { x: tCol2 + 4, y: tTop + 1, size: 10, font: bold, color: WHITE });
  y = tTop - 8;

  const schedule = [
    ["7:00 - 8:00 AM", "Venue Setup and Registration of Participants", "Logistics Committee\n(Eva J. Reyes)"],
    ["8:00 - 8:15 AM", "Opening Prayer and National Anthem", "All Participants"],
    ["8:15 - 8:30 AM", "Welcome Remarks by the CSG President", "John Doe, CSG President"],
    ["8:30 - 8:45 AM", "Introduction of the Resource Person", "Program Emcee"],
    ["8:45 - 10:15 AM", "Session 1: Modern Web Development Landscape\n(Engr. Marco D. Santos)", "Resource Person"],
    ["10:15 - 10:30 AM", "Open Forum / Q&A -- Session 1", "Emcee & Resource Person"],
    ["10:30 - 10:45 AM", "Short Break / Snacks", "Logistics Committee"],
    ["10:45 AM - 12:15 PM", "Session 2: Tools and Frameworks in the Industry\n(Engr. Marco D. Santos)", "Resource Person"],
    ["12:15 - 1:00 PM", "Lunch Break", "All Participants"],
    ["1:00 - 2:30 PM", "Session 3: Career Readiness and Tech Industry\nRealities", "Resource Person"],
    ["2:30 - 2:45 PM", "Open Forum / Q&A -- Session 3", "Emcee & Resource Person"],
    ["2:45 - 3:00 PM", "Short Break", "All Participants"],
    ["3:00 - 4:00 PM", "Workshop: Portfolio Building and GitHub Basics", "Resource Person & Tech Committee"],
    ["4:00 - 4:20 PM", "Distribution of Certificates of Participation", "Finance Officer & Logistics"],
    ["4:20 - 4:40 PM", "Evaluation and Feedback Form Filling", "All Participants"],
    ["4:40 - 5:00 PM", "Closing Remarks and Photo Documentation", "CSG President"],
    ["5:00 PM onwards", "Venue Cleanup and Turnover", "Logistics Committee"],
  ];

  for (let i = 0; i < schedule.length; i++) {
    const [time, activity, pic] = schedule[i];
    const lines = activity.split("\n");
    const picLines = pic.split("\n");
    const rowLines = Math.max(lines.length, picLines.length);
    const rowH = rowLines * 13 + 6;
    const rowBg = i % 2 === 1 ? LIGHT_GRAY : WHITE;
    page.drawRectangle({ x: tCol0, y: y - rowH + 10, width: CONTENT_W, height: rowH, color: rowBg });
    page.drawText(time, { x: tCol0 + 4, y: y + 1, size: 9, font: regular, color: BLACK });
    lines.forEach((ln, li) => {
      page.drawText(ln, { x: tCol1 + 4, y: y + 1 - li * 13, size: 9, font: li === 0 ? regular : italic, color: BLACK });
    });
    picLines.forEach((ln, li) => {
      page.drawText(ln, { x: tCol2 + 4, y: y + 1 - li * 13, size: 9, font: italic, color: DARK_GRAY });
    });
    y -= rowH;
  }

  y -= 16;
  page.drawText("Prepared by:", { x: MARGIN, y, size: 10, font: bold, color: BLACK });
  y -= 36;
  page.drawText("ANGELA R. FLORES", { x: MARGIN, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Overall Event Coordinator / CSG President", { x: MARGIN, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(OUT_DIR, "04_Program_Event_Flow.pdf"), bytes);
  console.log("  [OK] 04_Program_Event_Flow.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Document 5 - Profile of Speakers/Facilitators
// ─────────────────────────────────────────────────────────────────────────────
async function doc5_speakerProfile() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage(PageSizes.Letter);
  const fonts = await getFonts(pdfDoc);
  const { regular, bold, italic } = fonts;

  let y = PH - MARGIN;
  y = drawHeaderBlock(page, fonts, y);

  y = drawCenteredText(page, "PROFILE OF SPEAKERS / FACILITATORS", bold, 12, y, MAROON);
  y -= 4;
  y = drawCenteredText(page, "TechTalk: Web Development and Career Readiness Seminar", italic, 11, y);
  y -= 4;
  y = drawCenteredText(page, "July 25, 2026  |  EARIST AVR, 4th Floor, Main Building", regular, 10, y, DARK_GRAY);
  y -= 20;

  y = drawHRule(page, y, 1.5, MAROON);

  y = drawLeftText(page, "RESOURCE PERSON / SPEAKER", bold, 11, y, MARGIN, MAROON);
  y -= 4;

  y = drawLeftText(page, "Engr. Marco D. Santos", bold, 14, y);
  y = drawLeftText(page, "Senior Full-Stack Developer -- TechBridge PH Inc.", italic, 11, y);
  y -= 6;

  y = drawHRule(page, y, 0.5);

  const profileSections = [
    ["Educational Background:", [
      "Bachelor of Science in Computer Engineering -- Polytechnic University of the Philippines (2012)",
      "Master of Science in Information Technology -- Technological Institute of the Philippines (2018, ongoing)",
    ]],
    ["Professional Experience:", [
      "Senior Full-Stack Developer, TechBridge PH Inc. (2020 - Present)",
      "  * Leads a team of 8 developers building enterprise-grade web applications using React, Node.js, and AWS.",
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

  for (const [heading, items] of profileSections) {
    y = drawLeftText(page, heading, bold, 10, y);
    for (const item of items) {
      y = drawWrappedText(page, item, regular, 10, y, CONTENT_W - 12, MARGIN + 12);
    }
    y -= 6;
  }

  y -= 8;
  y = drawHRule(page, y, 1, MAROON);
  y -= 6;
  y = drawLeftText(page, "Confirmed by:", bold, 10, y);
  y -= 36;
  const sigRight = PW / 2 + 20;
  page.drawText("Engr. MARCO D. SANTOS", { x: MARGIN, y, size: 11, font: bold, color: BLACK });
  page.drawText("JOHN DOE", { x: sigRight, y, size: 11, font: bold, color: BLACK });
  y -= 13;
  page.drawText("Resource Person", { x: MARGIN, y, size: 10, font: italic, color: BLACK });
  page.drawText("President, CCS-CSG", { x: sigRight, y, size: 10, font: italic, color: BLACK });

  footerNote(page, fonts);
  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(OUT_DIR, "05_Speaker_Facilitator_Profile.pdf"), bytes);
  console.log("  [OK] 05_Speaker_Facilitator_Profile.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
console.log("Generating dummy EARIST documents...");
console.log(`Output: ${OUT_DIR}\n`);

await doc1_requestLetterISG();
await doc2_requestLetterPresident();
await doc3_budgetaryAllocation();
await doc4_programFlow();
await doc5_speakerProfile();

console.log("\nDone. 5 documents generated.");
