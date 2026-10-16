import React, { useState, useEffect, useRef } from "react";
import {
  INNER_FIELDING_POSITIONS,
  OUTER_FIELDING_POSITIONS,
  TACTICAL_FIELDING_POSITIONS,
  FIELDING_POSITION_NAMES,
  FIELDING_POSITION_DESCRIPTIONS,
  type FieldingZone,
} from "../../lib/engine/constants";
import {
  validateFielderMove,
  validateFieldDistribution,
  isInnerPosition,
} from "../../lib/engine/fieldingValidation";

const C = {
  bg: "#151923",
  card: "#242B3A",
  cyan: "#39C6E6",
  amber: "#FFB454",
  red: "#FF525F",
  violet: "#A78BFA",
  textPrimary: "#F0F4FF",
  textMuted: "#7A8BA8",
  border: "rgba(255,255,255,0.08)",
  fieldGreen: "#13231B",
  fieldBorder: "#1D3B2B",
  innerCircle: "#2B523C",
  pitchColor: "#5A4428",
  pitchLine: "#DCD0BA",
} as const;

export interface FieldMinimapProps {
  positions: (FieldingZone | string)[];
  onPositionsChange?: (newPositions: FieldingZone[]) => void;
  isBowlingSide: boolean;
  disabled?: boolean;
  ballDestinationZone?: string | null;
  compact?: boolean;
}

// Normalized coordinate map (0..100) for standard cricket field layout
// Batter at bottom (50, 72) facing Bowler at top (50, 22).
// Off side = Left (x < 50), Leg side = Right (x > 50).
export const POSITION_COORDINATES: Record<string, { x: number; y: number; inner: boolean }> = {
  // 5 Inner-circle positions
  point: { x: 26, y: 72, inner: true },
  cover: { x: 30, y: 56, inner: true },
  mid_off: { x: 40, y: 40, inner: true },
  mid_on: { x: 60, y: 40, inner: true },
  short_midwicket: { x: 70, y: 56, inner: true },

  // 6 Outer-field positions
  deep_third_man: { x: 18, y: 84, inner: false },
  deep_cover: { x: 14, y: 50, inner: false },
  long_off: { x: 34, y: 15, inner: false },
  long_on: { x: 66, y: 15, inner: false },
  deep_midwicket: { x: 86, y: 50, inner: false },
  fine_leg: { x: 82, y: 84, inner: false },

  // Legacy mappings for fallback
  midwicket: { x: 70, y: 56, inner: true },
  third_man: { x: 18, y: 84, inner: false },
  deep_square_leg: { x: 86, y: 50, inner: false },
};

const INSTRUCTION_STORAGE_KEY = "hcc_field_minimap_tip_dismissed";

export default function FieldMinimap({
  positions,
  onPositionsChange,
  isBowlingSide,
  disabled = false,
  ballDestinationZone = null,
  compact = false,
}: FieldMinimapProps) {
  const [selectedFielderIndex, setSelectedFielderIndex] = useState<number | null>(null);
  const [hoveredPosition, setHoveredPosition] = useState<FieldingZone | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const [showInstruction, setShowInstruction] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(INSTRUCTION_STORAGE_KEY) !== "true";
    } catch {
      return true;
    }
  });

  const dismissInstruction = () => {
    setShowInstruction(false);
    try {
      localStorage.setItem(INSTRUCTION_STORAGE_KEY, "true");
    } catch {}
  };

  const openInstruction = () => {
    setShowInstruction(true);
  };

  // Clear error after 4 seconds
  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => setErrorMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  // Current fielders: 4 elements
  const currentPositions = positions.slice(0, 4);

  // Distribution status
  const distribution = validateFieldDistribution(currentPositions);

  const handleFielderClick = (index: number) => {
    if (!isBowlingSide || disabled) return;
    if (selectedFielderIndex === index) {
      setSelectedFielderIndex(null);
    } else {
      setSelectedFielderIndex(index);
      setErrorMessage(null);
    }
  };

  const handlePositionClick = (targetZone: FieldingZone) => {
    if (!isBowlingSide || disabled || selectedFielderIndex === null) return;

    // Check move validity
    const validation = validateFielderMove(currentPositions, selectedFielderIndex, targetZone);
    if (!validation.valid) {
      setErrorMessage(validation.error ?? "Invalid field placement");
      return;
    }

    // Apply move
    const newPositions = [...currentPositions] as FieldingZone[];
    newPositions[selectedFielderIndex] = targetZone;

    onPositionsChange?.(newPositions);
    setSelectedFielderIndex(null);
    setErrorMessage(null);
  };

  // Drag and Drop support (Section 3)
  const getSvgCoords = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 120;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(120, y)) };
  };

  const handlePointerDownFielder = (index: number, e: React.PointerEvent) => {
    if (!isBowlingSide || disabled) return;
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {}
    setDraggingIndex(index);
    setSelectedFielderIndex(index);
    setErrorMessage(null);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIndex === null) return;
    const coords = getSvgCoords(e);
    if (coords) setDragPos(coords);
  };

  const handlePointerUp = () => {
    if (draggingIndex === null) return;
    const coords = dragPos;
    const activeIdx = draggingIndex;
    setDraggingIndex(null);
    setDragPos(null);

    if (!coords) return;

    // Find nearest tactical zone within snap distance (14 units)
    let nearestZone: FieldingZone | null = null;
    let minDist = 14;

    for (const zone of TACTICAL_FIELDING_POSITIONS) {
      const c = POSITION_COORDINATES[zone];
      if (!c) continue;
      const dist = Math.hypot(coords.x - c.x, coords.y - c.y);
      if (dist < minDist) {
        minDist = dist;
        nearestZone = zone;
      }
    }

    if (nearestZone && activeIdx !== null) {
      const validation = validateFielderMove(currentPositions, activeIdx, nearestZone);
      if (validation.valid) {
        const newPositions = [...currentPositions] as FieldingZone[];
        newPositions[activeIdx] = nearestZone;
        onPositionsChange?.(newPositions);
        setSelectedFielderIndex(null);
        setErrorMessage(null);
      } else {
        setErrorMessage(validation.error ?? "Invalid field placement");
      }
    }
  };

  const width = compact ? 260 : 320;
  const height = compact ? 320 : 390;

  return (
    <div
      className="flex flex-col rounded-2xl p-3 select-none"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        width: "100%",
        maxWidth: width + 24,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black tracking-wider uppercase" style={{ color: C.amber }}>
            Tactical Field Minimap
          </span>
          <button
            type="button"
            onClick={openInstruction}
            title="View fielding instructions"
            className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-opacity hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.08)", color: C.textMuted }}
          >
            ℹ
          </button>
        </div>
        <div className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: C.textMuted }}>
          In: {distribution.innerCount} · Out: {distribution.outerCount}
        </div>
      </div>

      {/* First-use Dismissible Instruction Banner (Section 3, 14, 16) */}
      {showInstruction && (
        <div
          className="mb-2 p-2.5 rounded-xl text-xs relative flex items-start justify-between gap-2"
          style={{
            background: "rgba(57,198,230,0.12)",
            border: `1px solid ${C.cyan}40`,
            color: C.textPrimary,
          }}
        >
          <div>
            <div className="font-bold text-[11px] mb-0.5" style={{ color: C.cyan }}>
              FIELD PLACEMENT CONTROLS
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: C.textPrimary }}>
              Tap or drag a fielder to reposition them. You can change your field between deliveries.
            </div>
          </div>
          <button
            type="button"
            onClick={dismissInstruction}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-opacity hover:opacity-80"
            style={{ background: C.cyan, color: "#0A1520" }}
          >
            Got it
          </button>
        </div>
      )}

      {/* Selected Fielder Status Banner */}
      {selectedFielderIndex !== null && isBowlingSide && (
        <div
          className="mb-2 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between animate-pulse"
          style={{ background: `${C.amber}20`, border: `1px solid ${C.amber}50`, color: C.amber }}
        >
          <span>
            Fielder {selectedFielderIndex + 1} selected — tap or drag to an open position
          </span>
          <button
            type="button"
            onClick={() => setSelectedFielderIndex(null)}
            className="text-[10px] underline ml-2 opacity-80 hover:opacity-100"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error Message Alert */}
      {errorMessage && (
        <div
          className="mb-2 px-3 py-1.5 rounded-xl text-xs font-bold"
          style={{ background: `${C.red}25`, border: `1px solid ${C.red}60`, color: C.red }}
        >
          ⚠️ {errorMessage}
        </div>
      )}

      {/* SVG Minimap Canvas with Drag & Drop */}
      <div className="relative mx-auto my-1">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox="0 0 100 120"
          className="rounded-xl overflow-hidden block touch-none"
          style={{ background: C.fieldGreen }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Outer Boundary Oval */}
          <ellipse
            cx="50"
            cy="60"
            rx="47"
            ry="57"
            fill="none"
            stroke={C.fieldBorder}
            strokeWidth="1.5"
          />

          {/* Inner 30-yard Circle (dashed) */}
          <ellipse
            cx="50"
            cy="60"
            rx="27"
            ry="31"
            fill="none"
            stroke={C.innerCircle}
            strokeWidth="0.8"
            strokeDasharray="2 1.5"
          />
          <text
            x="50"
            y="31"
            textAnchor="middle"
            fontSize="2.5"
            fill={C.innerCircle}
            opacity="0.8"
          >
            INNER CIRCLE
          </text>

          {/* Central Cricket Pitch */}
          <rect
            x="46"
            y="25"
            width="8"
            height="50"
            rx="1"
            fill={C.pitchColor}
            stroke={C.pitchLine}
            strokeWidth="0.4"
          />
          {/* Popping Creases */}
          <line x1="44" y1="31" x2="56" y2="31" stroke={C.pitchLine} strokeWidth="0.5" />
          <line x1="44" y1="69" x2="56" y2="69" stroke={C.pitchLine} strokeWidth="0.5" />

          {/* Stumps — Bowling End (Top) */}
          <circle cx="48.5" cy="28" r="0.6" fill="#F4E0A0" />
          <circle cx="50" cy="28" r="0.6" fill="#F4E0A0" />
          <circle cx="51.5" cy="28" r="0.6" fill="#F4E0A0" />

          {/* Stumps — Batting End (Bottom) */}
          <circle cx="48.5" cy="72" r="0.6" fill="#F4E0A0" />
          <circle cx="50" cy="72" r="0.6" fill="#F4E0A0" />
          <circle cx="51.5" cy="72" r="0.6" fill="#F4E0A0" />

          {/* Fixed Role: Bowler (Fixed at bowling crease, violet) */}
          <g>
            <circle cx="50" cy="22" r="2.8" fill={C.violet} />
            <text x="50" y="23" textAnchor="middle" fontSize="2.2" fontWeight="bold" fill="#0A0E14">
              B
            </text>
            <text x="50" y="18" textAnchor="middle" fontSize="2" fill={C.violet} fontWeight="bold">
              Bowler (Fixed)
            </text>
          </g>

          {/* Fixed Role: Batter (at batting crease, cyan) */}
          <g>
            <circle cx="50" cy="71" r="2.8" fill={C.cyan} />
            <text x="50" y="72" textAnchor="middle" fontSize="2.2" fontWeight="bold" fill="#0A0E14">
              🏏
            </text>
          </g>

          {/* Fixed Role: Wicketkeeper (Fixed directly behind batter, never movable) */}
          <g>
            <circle cx="50" cy="80" r="2.8" fill="#4B6B94" stroke="#7AA0CE" strokeWidth="0.6" />
            <text x="50" y="81" textAnchor="middle" fontSize="2.2" fontWeight="bold" fill="#F0F4FF">
              WK
            </text>
            <text x="50" y="85" textAnchor="middle" fontSize="2" fill="#7AA0CE" fontWeight="bold">
              Keeper (Fixed)
            </text>
          </g>

          {/* Ball Destination Highlight (if active) */}
          {ballDestinationZone && POSITION_COORDINATES[ballDestinationZone] && (
            <g>
              <circle
                cx={POSITION_COORDINATES[ballDestinationZone].x}
                cy={POSITION_COORDINATES[ballDestinationZone].y}
                r="7"
                fill="none"
                stroke={C.amber}
                strokeWidth="0.8"
                strokeDasharray="2 1"
                className="animate-ping"
              />
              <circle
                cx={POSITION_COORDINATES[ballDestinationZone].x}
                cy={POSITION_COORDINATES[ballDestinationZone].y}
                r="3.5"
                fill={`${C.amber}40`}
              />
            </g>
          )}

          {/* Named Placement Slots (All 11 Tactical Positions) */}
          {TACTICAL_FIELDING_POSITIONS.map((zone) => {
            const coord = POSITION_COORDINATES[zone];
            if (!coord) return null;

            // Is occupied by one of the 4 fielders?
            const occupiedFielderIndex = currentPositions.findIndex((p) => p === zone);
            const isOccupied = occupiedFielderIndex !== -1;
            const isSelectedFielderSpot = selectedFielderIndex !== null && currentPositions[selectedFielderIndex] === zone;

            // Target candidate when a fielder is selected
            const isTargetCandidate = selectedFielderIndex !== null && !isOccupied;

            return (
              <g
                key={zone}
                className={isTargetCandidate && isBowlingSide ? "cursor-pointer" : ""}
                onClick={() => isTargetCandidate && handlePositionClick(zone)}
                onMouseEnter={() => setHoveredPosition(zone)}
                onMouseLeave={() => setHoveredPosition(null)}
              >
                {/* Target Zone Slot Ring */}
                {!isOccupied && (
                  <circle
                    cx={coord.x}
                    cy={coord.y}
                    r={isTargetCandidate ? "3.2" : "2"}
                    fill={isTargetCandidate ? "rgba(255, 180, 84, 0.15)" : "rgba(255, 255, 255, 0.04)"}
                    stroke={isTargetCandidate ? C.amber : "rgba(255, 255, 255, 0.2)"}
                    strokeWidth={isTargetCandidate ? "0.8" : "0.4"}
                    strokeDasharray={isTargetCandidate ? "none" : "1 1"}
                  />
                )}

                {/* Movable Fielder Dot (1..4) with Tap & Drag */}
                {isOccupied && (
                  <g
                    className={isBowlingSide && !disabled ? "cursor-grab active:cursor-grabbing" : ""}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFielderClick(occupiedFielderIndex);
                    }}
                    onPointerDown={(e) => handlePointerDownFielder(occupiedFielderIndex, e)}
                  >
                    {/* Selected Fielder Glow */}
                    {isSelectedFielderSpot && (
                      <circle
                        cx={coord.x}
                        cy={coord.y}
                        r="5.5"
                        fill="none"
                        stroke={C.amber}
                        strokeWidth="1.2"
                        className="animate-pulse"
                      />
                    )}
                    {/* Fielder Body */}
                    <circle
                      cx={coord.x}
                      cy={coord.y}
                      r="3.2"
                      fill={isSelectedFielderSpot ? C.amber : C.cyan}
                      stroke="#0E1620"
                      strokeWidth="0.6"
                    />
                    <text
                      x={coord.x}
                      y={coord.y + 1}
                      textAnchor="middle"
                      fontSize="2.6"
                      fontWeight="black"
                      fill="#0A121D"
                    >
                      {occupiedFielderIndex + 1}
                    </text>
                  </g>
                )}

                {/* Position Name Label */}
                <text
                  x={coord.x}
                  y={coord.y + (coord.y > 60 ? 5.5 : -3.5)}
                  textAnchor="middle"
                  fontSize="2.1"
                  fontWeight={isOccupied ? "bold" : "normal"}
                  fill={
                    isOccupied
                      ? C.textPrimary
                      : isTargetCandidate
                      ? C.amber
                      : "rgba(255,255,255,0.4)"
                  }
                >
                  {FIELDING_POSITION_NAMES[zone]}
                </text>
              </g>
            );
          })}

          {/* Dragging Fielder Ghost Circle */}
          {draggingIndex !== null && dragPos && (
            <g pointerEvents="none">
              <circle
                cx={dragPos.x}
                cy={dragPos.y}
                r="4.5"
                fill={`${C.amber}90`}
                stroke="#FFFFFF"
                strokeWidth="0.8"
                className="animate-pulse"
              />
              <text
                x={dragPos.x}
                y={dragPos.y + 1}
                textAnchor="middle"
                fontSize="2.6"
                fontWeight="black"
                fill="#0A121D"
              >
                {draggingIndex + 1}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Position Detail & Tactical Purpose Footer */}
      <div
        className="mt-2 p-2 rounded-xl text-xs"
        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}` }}
      >
        {hoveredPosition ? (
          <div>
            <div className="font-bold flex items-center justify-between" style={{ color: C.amber }}>
              <span>{FIELDING_POSITION_NAMES[hoveredPosition]}</span>
              <span className="text-[10px] font-normal" style={{ color: C.textMuted }}>
                {isInnerPosition(hoveredPosition) ? "Inner Circle" : "Outer Field"}
              </span>
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {FIELDING_POSITION_DESCRIPTIONS[hoveredPosition]}
            </div>
          </div>
        ) : selectedFielderIndex !== null ? (
          <div>
            <div className="font-bold" style={{ color: C.amber }}>
              Relocating Fielder {selectedFielderIndex + 1}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              Currently at: {FIELDING_POSITION_NAMES[currentPositions[selectedFielderIndex] as FieldingZone] ?? "Field"}. Tap or drag to any open dotted circle.
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-center" style={{ color: C.textMuted }}>
            {isBowlingSide
              ? "Tap or drag a numbered fielder (1–4) to reposition them"
              : "Field set by bowling team (Read-only view)"}
          </div>
        )}
      </div>
    </div>
  );
}
