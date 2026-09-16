import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

// Store coordinates as percentages so they scale when the PDF zooms
export interface SignZone {
  pageIndex: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

const RESIZE_HANDLE_SIZE = 16;

const resizeHandleStyle: React.CSSProperties = {
  position: "absolute",
  bottom: -RESIZE_HANDLE_SIZE / 2,
  right: -RESIZE_HANDLE_SIZE / 2,
  width: RESIZE_HANDLE_SIZE,
  height: RESIZE_HANDLE_SIZE,
  background: "#000091",
  border: "2px solid #ffffff",
  cursor: "nwse-resize",
  borderRadius: "50%",
  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
  zIndex: 2,
};

const MIN_WIDTH_PCT = 12;
const MIN_HEIGHT_PCT = 6;
const DEFAULT_WIDTH_PCT = 28;
const DEFAULT_HEIGHT_PCT = 10;

export interface SignZoneOverlayManagerProps {
  isSignMode: boolean;
  signMode?: "selfsign" | "requestsign" | "sign";
  currentItemId?: string;
  fixedZone?: SignZone | null;
  signerDisplayName?: string;
  onZoneChange?: (zone: SignZone | null) => void;
}

export const SignZoneOverlayManager = ({
  isSignMode,
  signMode = "selfsign",
  currentItemId,
  fixedZone,
  signerDisplayName,
  onZoneChange,
}: SignZoneOverlayManagerProps) => {
  const { t } = useTranslation();
  const [pages, setPages] = useState<HTMLElement[]>([]);
  const [currentZone, setCurrentZone] = useState<SignZone | null>(
    signMode === "sign" ? fixedZone || null : null,
  );

  const isInteractive = signMode === "selfsign" || signMode === "requestsign";

  // Reset or update zone whenever itemId, signMode, or fixedZone changes
  useEffect(() => {
    if (signMode === "sign") {
      setCurrentZone(fixedZone || null);
    } else {
      // In selfsign and requestsign, always start unplaced for new document or mode
      setCurrentZone(null);
    }
  }, [currentItemId, signMode, fixedZone]);

  const dragRef = useRef<{
    type: "move" | "resize";
    startX: number;
    startY: number;
    startZone: SignZone;
    pageRect: DOMRect;
  } | null>(null);

  const isDraggingOrResizingRef = useRef(false);
  const dragCleanupTimerRef = useRef<NodeJS.Timeout | null>(null);

  const stableOnZoneChange = useRef(onZoneChange);
  stableOnZoneChange.current = onZoneChange;

  useEffect(() => {
    stableOnZoneChange.current?.(currentZone);
  }, [currentZone]);

  useEffect(() => {
    if (!isSignMode) {
      setPages([]);
      return;
    }

    const findPages = () => {
      const pageElements = Array.from(
        document.querySelectorAll(".react-pdf__Page"),
      ) as HTMLElement[];

      setPages((prevPages) => {
        if (
          pageElements.length !== prevPages.length ||
          !pageElements.every((el, i) => el === prevPages[i])
        ) {
          pageElements.forEach((page) => {
            if (getComputedStyle(page).position === "static") {
              page.style.position = "relative";
            }
          });
          return pageElements;
        }
        return prevPages;
      });
    };

    findPages();

    let timeoutId: NodeJS.Timeout;
    const observer = new MutationObserver(() => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(findPages, 200);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [isSignMode]);

  // Click on a page to create or move the signature zone
  const handlePageClick = (
    e: React.MouseEvent<HTMLDivElement>,
    pageIndex: number,
    pageEl: HTMLElement,
  ) => {
    if (!isInteractive) return;
    if (dragRef.current || isDraggingOrResizingRef.current) return;

    const rect = pageEl.getBoundingClientRect();
    const clickXPct = ((e.clientX - rect.left) / rect.width) * 100;
    const clickYPct = ((e.clientY - rect.top) / rect.height) * 100;

    const w = currentZone ? currentZone.widthPct : DEFAULT_WIDTH_PCT;
    const h = currentZone ? currentZone.heightPct : DEFAULT_HEIGHT_PCT;

    const xPct = Math.max(0, Math.min(clickXPct - w / 2, 100 - w));
    const yPct = Math.max(0, Math.min(clickYPct - h / 2, 100 - h));

    setCurrentZone({
      pageIndex,
      xPct: Math.round(xPct * 100) / 100,
      yPct: Math.round(yPct * 100) / 100,
      widthPct: w,
      heightPct: h,
    });
  };

  // Drag-to-move handling
  const handleZoneMouseDown = (
    e: React.MouseEvent,
    pageEl: HTMLElement,
  ) => {
    if (!isInteractive) return;
    e.stopPropagation();
    if (!currentZone) return;

    if (dragCleanupTimerRef.current) {
      clearTimeout(dragCleanupTimerRef.current);
      dragCleanupTimerRef.current = null;
    }
    isDraggingOrResizingRef.current = true;

    dragRef.current = {
      type: "move",
      startX: e.clientX,
      startY: e.clientY,
      startZone: { ...currentZone },
      pageRect: pageEl.getBoundingClientRect(),
    };
  };

  // Drag-to-resize handling
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, pageEl: HTMLElement) => {
      if (!isInteractive) return;
      e.stopPropagation();
      if (!currentZone) return;

      if (dragCleanupTimerRef.current) {
        clearTimeout(dragCleanupTimerRef.current);
        dragCleanupTimerRef.current = null;
      }
      isDraggingOrResizingRef.current = true;

      dragRef.current = {
        type: "resize",
        startX: e.clientX,
        startY: e.clientY,
        startZone: { ...currentZone },
        pageRect: pageEl.getBoundingClientRect(),
      };
    },
    [currentZone, isInteractive],
  );

  // Global mouse move & mouse up listeners
  useEffect(() => {
    if (!isInteractive) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { type, startX, startY, startZone, pageRect } = dragRef.current;

      const deltaXPct = ((e.clientX - startX) / pageRect.width) * 100;
      const deltaYPct = ((e.clientY - startY) / pageRect.height) * 100;

      if (type === "move") {
        const maxX = 100 - startZone.widthPct;
        const maxY = 100 - startZone.heightPct;
        const newX = Math.max(0, Math.min(maxX, startZone.xPct + deltaXPct));
        const newY = Math.max(0, Math.min(maxY, startZone.yPct + deltaYPct));

        setCurrentZone((prev) =>
          prev
            ? {
                ...prev,
                xPct: Math.round(newX * 100) / 100,
                yPct: Math.round(newY * 100) / 100,
              }
            : null,
        );
      } else if (type === "resize") {
        const maxW = 100 - startZone.xPct;
        const maxH = 100 - startZone.yPct;
        const newW = Math.max(
          MIN_WIDTH_PCT,
          Math.min(maxW, startZone.widthPct + deltaXPct),
        );
        const newH = Math.max(
          MIN_HEIGHT_PCT,
          Math.min(maxH, startZone.heightPct + deltaYPct),
        );

        setCurrentZone((prev) =>
          prev
            ? {
                ...prev,
                widthPct: Math.round(newW * 100) / 100,
                heightPct: Math.round(newH * 100) / 100,
              }
            : null,
        );
      }
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        if (dragCleanupTimerRef.current) {
          clearTimeout(dragCleanupTimerRef.current);
        }
        dragCleanupTimerRef.current = setTimeout(() => {
          isDraggingOrResizingRef.current = false;
          dragCleanupTimerRef.current = null;
        }, 150);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (dragCleanupTimerRef.current) {
        clearTimeout(dragCleanupTimerRef.current);
      }
    };
  }, [isInteractive]);

  const formattedDate = useMemo(() => {
    const now = new Date();
    return `${now.toLocaleDateString("fr-FR")} à ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  }, []);

  if (!isSignMode || pages.length === 0) {
    return null;
  }

  const pageOverlayStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 10,
    pointerEvents: isInteractive ? "auto" : "none",
    cursor: isInteractive ? "crosshair" : "default",
  };

  return (
    <>
      {pages.map((pageEl, index) =>
        createPortal(
          <div
            key={index}
            style={pageOverlayStyle}
            onClick={(e: React.MouseEvent<HTMLDivElement>) =>
              handlePageClick(e, index, pageEl)
            }
          >
            {currentZone && currentZone.pageIndex === index && (
              <div
                onMouseDown={(e) => handleZoneMouseDown(e, pageEl)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: `${currentZone.xPct}%`,
                  top: `${currentZone.yPct}%`,
                  width: `${currentZone.widthPct}%`,
                  height: `${currentZone.heightPct}%`,
                  border: isInteractive ? "2px dashed #000091" : "2px solid #000091",
                  backgroundColor: "#F5F5FE",
                  cursor: isInteractive ? "grab" : "default",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 2px 8px rgba(0, 0, 145, 0.15)",
                  borderRadius: "4px",
                  userSelect: "none",
                  boxSizing: "border-box",
                  padding: "6px 10px",
                  pointerEvents: "auto",
                }}
              >
                {/* Visual content based on mode */}
                {signMode === "requestsign" ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#000091", fontWeight: "bold", fontSize: "0.8rem" }}>
                      <span className="material-icons" style={{ fontSize: "18px" }}>draw</span>
                      <span>{t("sign_zone.future_title", "Zone de signature")}</span>
                    </div>
                    <span style={{ fontSize: "0.68rem", color: "#4d4d4d", marginTop: "2px" }}>
                      {t("sign_zone.future_desc", "Les destinataires signeront à cet emplacement")}
                    </span>
                  </div>
                ) : (
                  // Official stamp rendering for selfsign and sign modes
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        color: "#000091",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <span className="material-icons" style={{ fontSize: "14px", color: "#000091" }}>
                        verified_user
                      </span>
                      <span>{t("sign_zone.signed_by", "Signé électroniquement par :")}</span>
                    </div>

                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: "bold",
                        color: "#000091",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        padding: "2px 0",
                      }}
                    >
                      {signerDisplayName || t("sign_zone.default_signer", "Signataire")}
                    </div>

                    <div style={{ fontSize: "0.64rem", color: "#4d4d4d" }}>
                      {t("sign_zone.signed_at", { date: formattedDate, defaultValue: `Le ${formattedDate}` })}
                    </div>
                  </div>
                )}

                {/* Resize handle (bottom-right corner) only in interactive mode */}
                {isInteractive && (
                  <div
                    style={resizeHandleStyle}
                    onMouseDown={(e) => handleResizeMouseDown(e, pageEl)}
                    onClick={(e) => e.stopPropagation()}
                    title={t("sign_zone.resize", "Redimensionner la zone")}
                  />
                )}
              </div>
            )}
          </div>,
          pageEl,
        ),
      )}
    </>
  );
};
