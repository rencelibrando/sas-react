import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

const BLOCK_HEIGHT = 150;
const BLOCK_BOTTOM_MARGIN = 50;
const LEFT_MARGIN = 60;
const RIGHT_MARGIN = 60;
const TOP_HEADROOM = 60;
const COLUMN_GAP = 24;
const ROW_GAP = 18;
const SIG_IMAGE_MAX_WIDTH = 180;
const SIG_IMAGE_MAX_HEIGHT = 60;
const CONTENT_GAP = 48; // minimum vertical gap between letter content and the row above it

const WHITE_THRESHOLD = 240;

/**
 * Stamp a signature block onto an existing PDF.
 *
 * Placement strategy: 2-column grid below the letter content.
 *
 *   1. First stamp: pixel-scan the letter's last page to find the content
 *      floor (lowest non-white y), then place at top-left of the row that
 *      sits just below the content (with CONTENT_GAP).
 *   2. Subsequent stamps follow the saved cursor:
 *        - If the row's left slot is taken, fill the right slot of the same row.
 *        - If both slots of a row are taken, drop down to a new row's left.
 *   3. When a new row would not fit above the page bottom margin, append a new
 *      page (sized to match the letter) and start its first row near the top.
 *
 * Placement state: { pageIndex, rowTopY, nextSlot } where nextSlot is
 * "left" or "right". Persisted by the caller in pipeline.signaturePageInfo.
 *
 * Pixel-scan failure (pdfjs/canvas) is non-fatal — falls back to placing the
 * first stamp at the standard bottom margin.
 */
export async function stampSignature({
  pdfBuffer,
  signatureBuffer,
  signatureMime,
  name,
  role,
  timestamp,
  placement,
}) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const isJpg =
    signatureMime === 'image/jpeg' ||
    signatureMime === 'image/jpg' ||
    (signatureBuffer[0] === 0xff && signatureBuffer[1] === 0xd8);
  const sigImage = isJpg
    ? await pdfDoc.embedJpg(signatureBuffer)
    : await pdfDoc.embedPng(signatureBuffer);
  const sigDims = sigImage.scaleToFit(SIG_IMAGE_MAX_WIDTH, SIG_IMAGE_MAX_HEIGHT);

  const pages = pdfDoc.getPages();
  const lastLetterPageIndex = pages.length - 1;
  const lastLetterSize = pages[lastLetterPageIndex].getSize();

  // Determine target page, row top, and slot for THIS stamp.
  let pageIndex;
  let rowTopY;
  let slot;

  const validResume =
    placement &&
    placement.pageIndex != null &&
    placement.rowTopY != null &&
    (placement.nextSlot === 'left' || placement.nextSlot === 'right') &&
    pages[placement.pageIndex] != null;

  if (validResume) {
    pageIndex = placement.pageIndex;
    rowTopY = placement.rowTopY;
    slot = placement.nextSlot;

    if (rowTopY - BLOCK_HEIGHT < BLOCK_BOTTOM_MARGIN) {
      // No room for this row on the current page — append a new page.
      pdfDoc.addPage([lastLetterSize.width, lastLetterSize.height]);
      pageIndex = pdfDoc.getPageCount() - 1;
      rowTopY = lastLetterSize.height - TOP_HEADROOM;
      slot = 'left';
    }
  } else {
    // First stamp on the proposal — anchor to content floor of the letter.
    pageIndex = lastLetterPageIndex;
    slot = 'left';

    const contentFloorY = await detectContentFloor(pdfBuffer, pageIndex);
    const pageH = lastLetterSize.height;

    let candidateRowTopY;
    if (contentFloorY == null) {
      candidateRowTopY = BLOCK_BOTTOM_MARGIN + BLOCK_HEIGHT;
    } else if (contentFloorY === 0) {
      candidateRowTopY = pageH - TOP_HEADROOM;
    } else {
      candidateRowTopY = contentFloorY - CONTENT_GAP;
    }

    if (candidateRowTopY - BLOCK_HEIGHT < BLOCK_BOTTOM_MARGIN) {
      // Content extends too far down — overflow to a new page.
      pdfDoc.addPage([lastLetterSize.width, lastLetterSize.height]);
      pageIndex = pdfDoc.getPageCount() - 1;
      rowTopY = lastLetterSize.height - TOP_HEADROOM;
    } else if (candidateRowTopY > pageH - TOP_HEADROOM) {
      rowTopY = pageH - TOP_HEADROOM;
    } else {
      rowTopY = candidateRowTopY;
    }
  }

  const targetPage = pdfDoc.getPages()[pageIndex];
  const pageWidth = targetPage.getSize().width;
  const columnWidth = (pageWidth - LEFT_MARGIN - RIGHT_MARGIN - COLUMN_GAP) / 2;
  const leftX = LEFT_MARGIN;
  const rightX = LEFT_MARGIN + columnWidth + COLUMN_GAP;
  const blockX = slot === 'right' ? rightX : leftX;

  drawStampBlock({
    page: targetPage,
    x: blockX,
    blockTopY: rowTopY,
    sigImage,
    sigDims,
    name,
    role,
    timestamp,
    fonts: { helvetica, helveticaBold, helveticaItalic },
  });

  // Compute next placement: left → same row's right; right → next row's left.
  let nextPlacement;
  if (slot === 'left') {
    nextPlacement = { pageIndex, rowTopY, nextSlot: 'right' };
  } else {
    nextPlacement = {
      pageIndex,
      rowTopY: rowTopY - BLOCK_HEIGHT - ROW_GAP,
      nextSlot: 'left',
    };
  }

  const buffer = await pdfDoc.save();
  return { buffer, placement: nextPlacement };
}

function drawStampBlock({ page, x, blockTopY, sigImage, sigDims, name, role, timestamp, fonts }) {
  const { helvetica, helveticaBold, helveticaItalic } = fonts;
  let y = blockTopY;

  page.drawText('Noted by:', {
    x,
    y,
    size: 11,
    font: helvetica,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 18;

  page.drawImage(sigImage, {
    x,
    y: y - sigDims.height,
    width: sigDims.width,
    height: sigDims.height,
  });
  y -= sigDims.height + 6;

  page.drawLine({
    start: { x, y },
    end: { x: x + 180, y },
    thickness: 0.6,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 14;

  page.drawText(name, {
    x,
    y,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });
  y -= 14;

  page.drawText(role, {
    x,
    y,
    size: 10,
    font: helvetica,
    color: rgb(0.25, 0.25, 0.25),
  });
  y -= 14;

  const dateStr = formatDatePH(timestamp);
  const timeStr = formatTimePH(timestamp);
  const disclaimerStyle = {
    x,
    size: 8,
    font: helveticaItalic,
    color: rgb(0.45, 0.45, 0.45),
  };
  page.drawText('Electronically signed & approved', { ...disclaimerStyle, y });
  y -= 10;
  page.drawText(`on ${dateStr} at ${timeStr} via secure review link`, { ...disclaimerStyle, y });
}

async function detectContentFloor(pdfBuffer, pageIndex) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');

    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
        'pdfjs-dist/legacy/build/pdf.worker.mjs'
      );
    }

    const data = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0 });

    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageData = ctx.getImageData(0, 0, w, h);
    const px = imageData.data;

    let contentFloorCanvasY = null;
    for (let canvasY = h - 1; canvasY >= 0; canvasY--) {
      const rowStart = canvasY * w * 4;
      let hasContent = false;
      for (let xx = 0; xx < w; xx++) {
        const idx = rowStart + xx * 4;
        if (
          px[idx] < WHITE_THRESHOLD ||
          px[idx + 1] < WHITE_THRESHOLD ||
          px[idx + 2] < WHITE_THRESHOLD
        ) {
          hasContent = true;
          break;
        }
      }
      if (hasContent) {
        contentFloorCanvasY = canvasY;
        break;
      }
    }

    page.cleanup();
    await pdf.cleanup();
    pdf.destroy();

    if (contentFloorCanvasY == null) return 0;
    return h - contentFloorCanvasY;
  } catch (err) {
    console.warn('[pdfStamper] Content-floor detection failed, falling back to fixed margin:', err.message);
    return null;
  }
}

function formatDatePH(date) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatTimePH(date) {
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}
