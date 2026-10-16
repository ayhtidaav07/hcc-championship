import React, { useEffect, useState, useRef } from "react";
import {
  SHOT_METADATA,
  DELIVERY_METADATA,
  FIELDING_POSITION_NAMES,
  type FieldingZone,
} from "../../lib/engine/constants";
import { POSITION_COORDINATES } from "./FieldMinimap";

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
  pitchSand: "#5E462B",
  pitchLight: "#7A5E3E",
  creaseWhite: "#E2E8F0",
  grassDark: "#102316",
  grassBorder: "#193522",
  ballWhite: "#FFFFFF",
  stumpWood: "#E6CA65",
} as const;

export interface AnimatedPitchProps {
  lastBall?: {
    bat: number;
    bowl: number;
    runs: number;
    isWicket: boolean;
    shotName?: string;
    deliveryName?: string;
    compatibility?: string;
    hasStar?: boolean;
    contactQuality?: string;
    trajectory?: string;
    dismissalType?: string | null;
    dismissalFielder?: string | null;
    isBoundary?: boolean;
  } | null;
  selectedShot?: number | null; // For Cricket 24-style intended preview
  selectedDelivery?: number | null;
  fieldingPositions?: (FieldingZone | string)[];
  compact?: boolean;
  onAnimationEnd?: () => void;
}

type AnimationStep = "idle" | "runup" | "bowling" | "impact" | "fielding" | "complete";

export default function AnimatedPitch({
  lastBall,
  selectedShot = null,
  selectedDelivery = null,
  fieldingPositions = ["cover", "mid_on", "long_off", "deep_midwicket"],
  compact = false,
  onAnimationEnd,
}: AnimatedPitchProps) {
  const [animStep, setAnimStep] = useState<AnimationStep>("idle");
  const [ballProgress, setBallProgress] = useState(0); // 0 (bowler) to 1 (batter)
  const [shotProgress, setShotProgress] = useState(0); // 0 (batter) to 1 (field/boundary)
  const [batSwingAngle, setBatSwingAngle] = useState(0);
  const [bowlerArmAngle, setBowlerArmAngle] = useState(0);
  const [stumpsBroken, setStumpsBroken] = useState(false);
  const [fielderReacting, setFielderReacting] = useState<string | null>(null);

  const prevBallRef = useRef<any>(null);

  // Trigger full animated delivery sequence when a new ball arrives
  useEffect(() => {
    if (!lastBall) return;
    if (prevBallRef.current === lastBall) return;
    prevBallRef.current = lastBall;

    // Start 5-step animation sequence
    setAnimStep("runup");
    setBallProgress(0);
    setShotProgress(0);
    setBatSwingAngle(0);
    setBowlerArmAngle(0);
    setStumpsBroken(false);
    setFielderReacting(null);

    // Step 1: Bowler runup & delivery action (350ms)
    const t1 = setTimeout(() => {
      setAnimStep("bowling");
      setBowlerArmAngle(180);
      setBallProgress(0.5); // ball in flight towards pitch bounce
    }, 350);

    // Step 2: Ball travels down pitch and bounces (550ms)
    const t2 = setTimeout(() => {
      setBallProgress(1.0); // ball reaches crease
    }, 700);

    // Step 3: Batter swings, impact or miss (900ms)
    const t3 = setTimeout(() => {
      setAnimStep("impact");
      const targetAngle = lastBall.bat ? (SHOT_METADATA[lastBall.bat]?.angle ?? 0) : 0;
      setBatSwingAngle(targetAngle);

      if (lastBall.isWicket && (lastBall.dismissalType === "bowled" || lastBall.dismissalType === "stumped")) {
        setStumpsBroken(true);
      }
    }, 950);

    // Step 4: Ball travels into outfield, fielder reaction (1200ms)
    const t4 = setTimeout(() => {
      setAnimStep("fielding");
      setShotProgress(1.0);

      // Find relevant fielder if any
      const shotMeta = lastBall.bat !== undefined ? SHOT_METADATA[lastBall.bat] : undefined;
      if (shotMeta && shotMeta.targetZones.length > 0) {
        const reacting = fieldingPositions.find((pos) => shotMeta.targetZones.includes(pos as FieldingZone));
        if (reacting) {
          setFielderReacting(reacting);
        }
      }
    }, 1250);

    // Step 5: Result screen & completion callback (1800ms)
    const t5 = setTimeout(() => {
      setAnimStep("complete");
      onAnimationEnd?.();
    }, 1900);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [lastBall, fieldingPositions, onAnimationEnd]);

  const width = compact ? 260 : 340;
  const height = compact ? 360 : 450;
  const cx = 50;

  // Delivery length & bounce calculation
  const delivNum = lastBall?.bowl ?? selectedDelivery ?? 1;
  const delivMeta = DELIVERY_METADATA[delivNum] ?? DELIVERY_METADATA[1];
  const bounceY = 22 + (delivMeta.landingYPercent / 100) * 50; // pitch runs from y=22 to y=72

  // Shot calculation
  const shotNum = lastBall?.bat ?? selectedShot ?? 0;
  const shotMeta = SHOT_METADATA[shotNum] ?? SHOT_METADATA[0];
  const shotAngleRad = ((shotMeta.angle - 90) * Math.PI) / 180; // 0 deg is straight down the ground (south), negative is off side (west), positive is leg side (east)
  // Batter is at (50, 72). Ball travels towards field
  const shotDistance = lastBall?.runs === 6 ? 42 : lastBall?.runs === 4 ? 38 : lastBall?.isWicket ? 8 : 26;
  const shotDestX = 50 + Math.sin((shotMeta.angle * Math.PI) / 180) * shotDistance;
  const shotDestY = 72 - Math.cos((shotMeta.angle * Math.PI) / 180) * shotDistance;

  // Interpolated ball position
  let currentBallX = 50;
  let currentBallY = 22;
  let ballVisible = animStep !== "idle" && animStep !== "complete" && animStep !== "runup";

  if (animStep === "bowling") {
    // Travelling from bowler (50, 22) to batter (50, 72)
    currentBallX = 50;
    currentBallY = 22 + ballProgress * 50;
  } else if (animStep === "impact" || animStep === "fielding") {
    if (lastBall?.isWicket && (lastBall.dismissalType === "bowled" || lastBall.dismissalType === "lbw")) {
      currentBallX = 50;
      currentBallY = 72;
    } else {
      currentBallX = 50 + (shotDestX - 50) * shotProgress;
      currentBallY = 72 + (shotDestY - 72) * shotProgress;
    }
  }

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
        <span className="text-xs font-black tracking-wider uppercase" style={{ color: C.cyan }}>
          Live Animated Pitch
        </span>
        {lastBall && (
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded"
            style={{
              background: lastBall.isWicket ? `${C.red}25` : lastBall.runs >= 4 ? `${C.amber}25` : "rgba(255,255,255,0.08)",
              color: lastBall.isWicket ? C.red : lastBall.runs >= 4 ? C.amber : C.textPrimary,
            }}
          >
            {lastBall.isWicket ? (lastBall.dismissalType?.toUpperCase() ?? "OUT") : `${lastBall.runs} RUNS`}
          </span>
        )}
      </div>

      {/* SVG Cricket Scene */}
      <div className="relative mx-auto my-1">
        <svg
          width={width}
          height={height}
          viewBox="0 0 100 120"
          className="rounded-xl overflow-hidden block"
          style={{ background: C.grassDark }}
        >
          {/* Ground Oval */}
          <ellipse cx="50" cy="60" rx="48" ry="58" fill="none" stroke={C.grassBorder} strokeWidth="2" />
          <ellipse cx="50" cy="60" rx="28" ry="32" fill="none" stroke="rgba(255,255,255,0.06)" strokeDasharray="2 2" strokeWidth="0.6" />

          {/* Cricket Pitch Strip */}
          <rect x="45.5" y="20" width="9" height="56" rx="1.5" fill={C.pitchSand} stroke={C.pitchLight} strokeWidth="0.6" />

          {/* Crease Lines */}
          <line x1="43" y1="28" x2="57" y2="28" stroke={C.creaseWhite} strokeWidth="0.6" opacity="0.9" />
          <line x1="43" y1="72" x2="57" y2="72" stroke={C.creaseWhite} strokeWidth="0.6" opacity="0.9" />

          {/* Bowler End Stumps (Top) */}
          <line x1="49" y1="23" x2="49" y2="27" stroke={C.stumpWood} strokeWidth="0.7" />
          <line x1="50" y1="23" x2="50" y2="27" stroke={C.stumpWood} strokeWidth="0.7" />
          <line x1="51" y1="23" x2="51" y2="27" stroke={C.stumpWood} strokeWidth="0.7" />
          <line x1="48.5" y1="23" x2="51.5" y2="23" stroke="#FDE68A" strokeWidth="0.5" />

          {/* Batter End Stumps (Bottom) */}
          {!stumpsBroken ? (
            <g>
              <line x1="49" y1="72" x2="49" y2="76" stroke={C.stumpWood} strokeWidth="0.7" />
              <line x1="50" y1="72" x2="50" y2="76" stroke={C.stumpWood} strokeWidth="0.7" />
              <line x1="51" y1="72" x2="51" y2="76" stroke={C.stumpWood} strokeWidth="0.7" />
              <line x1="48.5" y1="72" x2="51.5" y2="72" stroke="#FDE68A" strokeWidth="0.5" />
            </g>
          ) : (
            /* Broken Stumps on Wicket */
            <g>
              <line x1="48" y1="73" x2="45" y2="78" stroke={C.red} strokeWidth="0.8" />
              <line x1="51" y1="73" x2="55" y2="77" stroke={C.red} strokeWidth="0.8" />
              <circle cx="50" cy="74" r="1.5" fill={C.red} className="animate-ping" />
            </g>
          )}

          {/* Cricket 24-Style Intended Shot-Area Sector Preview (Section 7) */}
          {selectedShot !== null && selectedShot !== undefined && animStep === "idle" && (
            <g opacity="0.6">
              {/* Highlighted directional cone/wedge originating from batter */}
              <path
                d={`M 50 72 L ${50 + Math.sin(((shotMeta.angle - 18) * Math.PI) / 180) * 35} ${
                  72 - Math.cos(((shotMeta.angle - 18) * Math.PI) / 180) * 35
                } A 35 35 0 0 1 ${50 + Math.sin(((shotMeta.angle + 18) * Math.PI) / 180) * 35} ${
                  72 - Math.cos(((shotMeta.angle + 18) * Math.PI) / 180) * 35
                } Z`}
                fill={C.cyan}
                opacity="0.22"
              />
              <line
                x1="50"
                y1="72"
                x2={50 + Math.sin((shotMeta.angle * Math.PI) / 180) * 35}
                y2={72 - Math.cos((shotMeta.angle * Math.PI) / 180) * 35}
                stroke={C.cyan}
                strokeWidth="1.2"
                strokeDasharray="2 1.5"
              />
              <circle
                cx={50 + Math.sin((shotMeta.angle * Math.PI) / 180) * 35}
                cy={72 - Math.cos((shotMeta.angle * Math.PI) / 180) * 35}
                r="3"
                fill={C.cyan}
                opacity="0.8"
              />
              <text
                x={50 + Math.sin((shotMeta.angle * Math.PI) / 180) * 35}
                y={72 - Math.cos((shotMeta.angle * Math.PI) / 180) * 35 - 3}
                textAnchor="middle"
                fontSize="2.4"
                fontWeight="bold"
                fill={C.cyan}
              >
                {shotMeta.name} (Intent)
              </text>
            </g>
          )}

          {/* Resolved Ball Trajectory Trail (when ball is resolved) */}
          {lastBall && (animStep === "fielding" || animStep === "complete") && (
            <g opacity="0.8">
              {/* Pitch path from bowler to landing */}
              <line x1="50" y1="22" x2="50" y2={bounceY} stroke={C.violet} strokeWidth="1.2" strokeDasharray="3 2" />
              {/* Bounce marker */}
              <circle cx="50" cy={bounceY} r="1.5" fill={C.violet} />
              {/* Bat to destination trail */}
              {!lastBall.isWicket && (
                <>
                  <line
                    x1="50"
                    y1="72"
                    x2={shotDestX}
                    y2={shotDestY}
                    stroke={lastBall.isBoundary ? C.amber : C.cyan}
                    strokeWidth={lastBall.isBoundary ? "2" : "1.2"}
                    strokeDasharray={lastBall.trajectory === "aerial" ? "none" : "3 1.5"}
                  />
                  <circle
                    cx={shotDestX}
                    cy={shotDestY}
                    r={lastBall.isBoundary ? "3.5" : "2.5"}
                    fill={lastBall.isBoundary ? C.amber : C.cyan}
                  />
                </>
              )}
            </g>
          )}

          {/* Active Fielders in the Environment */}
          {fieldingPositions.slice(0, 4).map((pos, idx) => {
            const coord = POSITION_COORDINATES[pos];
            if (!coord) return null;
            const isReacting = fielderReacting === pos;

            return (
              <g key={pos}>
                {isReacting && (
                  <circle cx={coord.x} cy={coord.y} r="6" fill="none" stroke={C.amber} strokeWidth="1" className="animate-ping" />
                )}
                {/* 2D Fielder Body */}
                <circle cx={coord.x} cy={coord.y} r="2.8" fill={isReacting ? C.amber : "#335C67"} stroke="#0E1620" strokeWidth="0.5" />
                <text x={coord.x} y={coord.y + 0.9} textAnchor="middle" fontSize="2.2" fontWeight="black" fill="#FFFFFF">
                  {idx + 1}
                </text>
              </g>
            );
          })}

          {/* BOWLER CHARACTER (Opposite end, top) */}
          <g transform="translate(50, 18)">
            {/* Head */}
            <circle cx="0" cy="0" r="1.8" fill={C.violet} />
            {/* Torso */}
            <line x1="0" y1="1.8" x2="0" y2="5.5" stroke={C.violet} strokeWidth="1.2" strokeLinecap="round" />
            {/* Legs */}
            <line x1="0" y1="5.5" x2="-1.5" y2="9" stroke={C.violet} strokeWidth="1.1" strokeLinecap="round" />
            <line x1="0" y1="5.5" x2="1.5" y2="9" stroke={C.violet} strokeWidth="1.1" strokeLinecap="round" />
            {/* Arms (Animated Bowling Action) */}
            <g transform={`rotate(${bowlerArmAngle}, 0, 3)`}>
              <line x1="0" y1="3" x2="-3.5" y2="1" stroke={C.violet} strokeWidth="1" strokeLinecap="round" />
              <line x1="0" y1="3" x2="3.5" y2="5" stroke={C.violet} strokeWidth="1" strokeLinecap="round" />
            </g>
          </g>

          {/* BATTER CHARACTER (Batting end, bottom) - Recognizable body with arms, legs, stance & bat */}
          <g transform="translate(50, 72)">
            {/* Head with helmet */}
            <circle cx="0" cy="-6" r="2.2" fill={C.cyan} />
            <circle cx="0.8" cy="-6" r="1.2" fill="#152635" />
            {/* Torso */}
            <line x1="0" y1="-3.8" x2="0" y2="1.5" stroke={C.cyan} strokeWidth="1.6" strokeLinecap="round" />
            {/* Front & Back Legs in batting stance */}
            <line x1="0" y1="1.5" x2="-2" y2="6.5" stroke={C.cyan} strokeWidth="1.4" strokeLinecap="round" />
            <line x1="0" y1="1.5" x2="2.2" y2="6.5" stroke={C.cyan} strokeWidth="1.4" strokeLinecap="round" />
            {/* Arms holding the bat (Swinging in intended shot direction!) */}
            <g transform={`rotate(${batSwingAngle}, 0, -2)`}>
              {/* Front arm */}
              <line x1="0" y1="-2" x2="-2.5" y2="0" stroke={C.cyan} strokeWidth="1.2" strokeLinecap="round" />
              {/* Back arm */}
              <line x1="0" y1="-2" x2="-1" y2="0.5" stroke={C.cyan} strokeWidth="1.2" strokeLinecap="round" />
              {/* Cricket Bat (Visible blade and handle) */}
              <line x1="-1.5" y1="0" x2="-3.8" y2="-4.5" stroke="#E2E8F0" strokeWidth="0.8" />
              <line x1="-3.8" y1="-4.5" x2="-7.5" y2="-10" stroke="#D97706" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          </g>

          {/* Animated Cricket Ball in flight */}
          {ballVisible && (
            <g>
              <circle cx={currentBallX} cy={currentBallY} r="1.8" fill={C.ballWhite} stroke="#DC2626" strokeWidth="0.3" />
              {/* Ball Shadow for depth */}
              <circle cx={currentBallX + 0.6} cy={currentBallY + 0.8} r="1.3" fill="rgba(0,0,0,0.3)" />
            </g>
          )}

          {/* Wicket Red Explosion */}
          {lastBall?.isWicket && (animStep === "fielding" || animStep === "complete") && (
            <g transform="translate(50, 72)">
              <text x="0" y="-8" textAnchor="middle" fontSize="6" fill={C.red} fontWeight="black" className="animate-bounce">
                OUT!
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Info Footnote below Pitch */}
      <div className="mt-2 p-2 rounded-xl text-xs flex items-center justify-between" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: lastBall ? C.cyan : C.amber }} />
          <span style={{ color: C.textPrimary }} className="font-semibold text-[11px]">
            {lastBall
              ? `${lastBall.shotName ?? "Shot"} vs ${lastBall.deliveryName ?? "Delivery"}`
              : selectedShot !== null
              ? `Selected Shot: ${SHOT_METADATA[selectedShot]?.name ?? selectedShot}`
              : "Waiting for shot selection…"}
          </span>
        </div>
        {lastBall?.compatibility && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded font-bold"
            style={{
              background: lastBall.compatibility === "G" ? "rgba(57,198,230,0.15)" : lastBall.compatibility === "B" ? "rgba(255,82,95,0.15)" : "rgba(255,255,255,0.06)",
              color: lastBall.compatibility === "G" ? C.cyan : lastBall.compatibility === "B" ? C.red : C.textMuted,
            }}
          >
            {lastBall.compatibility}{lastBall.hasStar ? "★" : ""} ({lastBall.contactQuality ?? "contact"})
          </span>
        )}
      </div>
    </div>
  );
}
