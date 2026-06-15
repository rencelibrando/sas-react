import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// Find the nearest scrollable ancestor — used as the IntersectionObserver root so
// "current page" tracks scrolling inside the modal body, not the whole window.
function getScrollParent(el) {
  let node = el?.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export default function PdfViewer({ fileUrl, renderOverlay, onPageChange }) {
  const rootRef = useRef(null);
  const pdfRef = useRef(null);
  const canvasRefs = useRef({}); // pageNum -> <canvas>
  const pageRefs = useRef({}); // pageNum -> page wrapper <div>
  const renderTasksRef = useRef({}); // pageNum -> RenderTask
  const visibilityRef = useRef({}); // pageNum -> intersection ratio

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pageDims, setPageDims] = useState({}); // pageNum -> { width, height }

  // Load the document
  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument({ url: fileUrl });
    loadingTask.promise
      .then((pdf) => {
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("PDF load failed:", err);
        setLoadError(err?.message || "Failed to load PDF");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      try { loadingTask.destroy(); } catch { /* noop */ }
      Object.values(renderTasksRef.current).forEach((t) => {
        try { t.cancel(); } catch { /* noop */ }
      });
      renderTasksRef.current = {};
      if (pdfRef.current) {
        try { pdfRef.current.destroy(); } catch { /* noop */ }
        pdfRef.current = null;
      }
    };
  }, [fileUrl]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  // Render every page to its own canvas; re-render all on zoom change.
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf || numPages === 0) return;
    let cancelled = false;

    (async () => {
      for (let p = 1; p <= numPages; p++) {
        if (cancelled) return;
        const canvas = canvasRefs.current[p];
        if (!canvas) continue;
        try {
          const page = await pdf.getPage(p);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: zoom });
          const dpr = window.devicePixelRatio || 1;
          const cssWidth = Math.floor(viewport.width);
          const cssHeight = Math.floor(viewport.height);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;

          if (renderTasksRef.current[p]) {
            try { renderTasksRef.current[p].cancel(); } catch { /* noop */ }
          }
          const ctx = canvas.getContext("2d");
          const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
          const task = page.render({ canvasContext: ctx, viewport, transform });
          renderTasksRef.current[p] = task;
          await task.promise;
          if (!cancelled) {
            setPageDims((prev) =>
              prev[p]?.width === cssWidth && prev[p]?.height === cssHeight
                ? prev
                : { ...prev, [p]: { width: cssWidth, height: cssHeight } }
            );
          }
        } catch (err) {
          if (err?.name === "RenderingCancelledException") return;
          console.error("PDF render failed:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      Object.values(renderTasksRef.current).forEach((t) => {
        try { t.cancel(); } catch { /* noop */ }
      });
    };
  }, [numPages, zoom]);

  // Track the most-visible page so the indicator + comment panel follow scroll.
  useEffect(() => {
    if (numPages === 0) return;
    const root = getScrollParent(rootRef.current);
    visibilityRef.current = {};
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const p = Number(entry.target.dataset.page);
          visibilityRef.current[p] = entry.intersectionRatio;
        }
        let best = 1;
        let bestRatio = -1;
        for (const [p, ratio] of Object.entries(visibilityRef.current)) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = Number(p);
          }
        }
        setCurrentPage(best);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    );
    for (let p = 1; p <= numPages; p++) {
      const el = pageRefs.current[p];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [numPages]);

  const scrollToPage = (p) => {
    const el = pageRefs.current[p];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const goPrev = () => scrollToPage(Math.max(1, currentPage - 1));
  const goNext = () => scrollToPage(Math.min(numPages, currentPage + 1));
  const zoomOut = () => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
    setZoom(ZOOM_LEVELS[Math.max(0, idx - 1)]);
  };
  const zoomIn = () => {
    const idx = ZOOM_LEVELS.findIndex((z) => z >= zoom);
    setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, idx + 1)]);
  };

  if (loadError) {
    return (
      <div className="pdf-viewer-error">
        <p>Couldn't load this PDF: {loadError}</p>
      </div>
    );
  }

  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div className="pdf-viewer" ref={rootRef}>
      <div className="pdf-viewer-toolbar">
        <button type="button" onClick={goPrev} disabled={currentPage <= 1 || loading}>
          ◀ Prev
        </button>
        <span className="pdf-viewer-pageinfo">
          {loading ? "Loading…" : `Page ${currentPage} / ${numPages}`}
        </span>
        <button type="button" onClick={goNext} disabled={currentPage >= numPages || loading}>
          Next ▶
        </button>
        <span className="pdf-viewer-divider" />
        <button type="button" onClick={zoomOut} disabled={loading}>−</button>
        <span className="pdf-viewer-zoominfo">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={zoomIn} disabled={loading}>+</button>
      </div>

      {loading && <div className="pdf-viewer-loading">Loading PDF…</div>}

      <div className="pdf-viewer-pages">
        {pages.map((p) => {
          const dims = pageDims[p] || { width: 0, height: 0 };
          return (
            <div
              key={p}
              className="pdf-viewer-page"
              data-page={p}
              ref={(el) => {
                if (el) pageRefs.current[p] = el;
                else delete pageRefs.current[p];
              }}
            >
              <div className="pdf-viewer-canvas-stack">
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current[p] = el;
                    else delete canvasRefs.current[p];
                  }}
                  className="pdf-viewer-canvas"
                />
                {dims.width > 0 &&
                  renderOverlay?.({
                    pageNum: p,
                    pageWidth: dims.width,
                    pageHeight: dims.height,
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
