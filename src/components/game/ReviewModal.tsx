import React, { useState } from "react";
import type { Side } from "../../lib/gameTypes";

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
} as const;

export interface ReviewModalProps {
  isOpen: boolean;
  mySide: Side;
  batterName: string;
  bowlerName: string;
  isBatting: boolean;
  onChoiceSubmit: (choice: 1 | 2) => void;
  myChoice: 1 | 2 | null;
  opponentChoice: 1 | 2 | null;
  resultOut?: boolean | null;
  onClose: () => void;
}

export default function ReviewModal({
  isOpen,
  mySide,
  batterName,
  bowlerName,
  isBatting,
  onChoiceSubmit,
  myChoice,
  opponentChoice,
  resultOut = null,
  onClose,
}: ReviewModalProps) {
  if (!isOpen) return null;

  const bothRevealed = myChoice !== null && opponentChoice !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div
        className="rounded-3xl p-6 max-w-md w-full text-center shadow-2xl relative"
        style={{ background: C.card, border: `2px solid ${C.violet}` }}
      >
        {/* Header */}
        <div className="text-3xl mb-1">⚖️</div>
        <h3 className="text-xl font-black mb-1" style={{ color: C.violet }}>
          HCC DECISION REVIEW
        </h3>
        <p className="text-xs mb-4" style={{ color: C.textMuted }}>
          {isBatting ? "Batting Side Review" : "Bowling Side Appeal"} · {batterName} vs {bowlerName}
        </p>

        {/* Rules Reminder */}
        <div
          className="p-3 rounded-2xl mb-5 text-xs text-left"
          style={{ background: "rgba(167, 139, 250, 0.08)", border: `1px solid ${C.violet}30` }}
        >
          <div className="font-bold mb-1" style={{ color: C.violet }}>
            HCC REVIEW RULES:
          </div>
          <ul className="list-disc list-inside space-y-0.5" style={{ color: C.textPrimary }}>
            <li>Both participants secretly select either <b>1</b> or <b>2</b>.</li>
            <li>Choices remain hidden until both have locked in.</li>
            <li>Matching numbers = <span style={{ color: C.red, fontWeight: "bold" }}>OUT</span></li>
            <li>Different numbers = <span style={{ color: C.cyan, fontWeight: "bold" }}>NOT OUT</span></li>
          </ul>
        </div>

        {/* Choice Buttons or Waiting State */}
        {!bothRevealed ? (
          <div>
            {myChoice === null ? (
              <div>
                <div className="text-sm font-bold mb-3" style={{ color: C.textPrimary }}>
                  Pick your secret review number (1 or 2):
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => onChoiceSubmit(1)}
                    className="py-5 rounded-2xl text-2xl font-black transition-all hover:scale-105 active:scale-95 border-2"
                    style={{ background: "rgba(57,198,230,0.15)", borderColor: C.cyan, color: C.cyan }}
                  >
                    1
                  </button>
                  <button
                    type="button"
                    onClick={() => onChoiceSubmit(2)}
                    className="py-5 rounded-2xl text-2xl font-black transition-all hover:scale-105 active:scale-95 border-2"
                    style={{ background: "rgba(255,180,84,0.15)", borderColor: C.amber, color: C.amber }}
                  >
                    2
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-6 rounded-2xl mb-4" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="text-2xl font-black mb-1" style={{ color: C.cyan }}>
                  Number {myChoice} Locked 🔒
                </div>
                <div className="text-xs" style={{ color: C.textMuted }}>
                  Waiting for opponent to submit their secret choice…
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Reveal Screen */
          <div className="animate-scale-in py-2">
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="text-xs" style={{ color: C.textMuted }}>YOUR PICK</div>
                <div className="text-4xl font-black mt-1" style={{ color: C.cyan }}>
                  {myChoice}
                </div>
              </div>
              <div className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="text-xs" style={{ color: C.textMuted }}>OPPONENT</div>
                <div className="text-4xl font-black mt-1" style={{ color: C.amber }}>
                  {opponentChoice}
                </div>
              </div>
            </div>

            {/* Verdict */}
            <div
              className="py-3 px-6 rounded-2xl text-xl font-black mb-5"
              style={{
                background: resultOut ? `${C.red}25` : `${C.cyan}25`,
                border: `2px solid ${resultOut ? C.red : C.cyan}`,
                color: resultOut ? C.red : C.cyan,
              }}
            >
              {resultOut ? "MATCH! — OUT 🔴" : "DIFFER! — NOT OUT 🟢"}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
              style={{ background: C.violet, color: "#0A0E14" }}
            >
              Continue Match
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
