import type { GameState, Side, InningsState } from "./gameTypes";
import { getTeam, getEligibleBatters, getEligibleBowlers, type Team } from "./teams";
import { zerosUsedThisOver } from "./gameEngine";

export interface AIDecision {
  type: "input" | "select" | "toss_call" | "toss_choice" | "next_innings_choice" | "follow_on" | "reposition_field";
  value?: number;
  kind?: "openers" | "bowler" | "batter";
  payload?: any;
  call?: "heads" | "tails";
  choice?: "bat" | "bowl";
  battingSide?: Side;
  enforce?: boolean;
  fieldPositions?: string[];
}

/**
 * Computes the next action for an AI opponent.
 * Returns null if it is not the AI's turn or if AI is already locked.
 */
export function getAIDecision(state: GameState, aiSide: Side): AIDecision | null {
  const isAITurn = (side: Side) => side === aiSide;

  // 1. TOSS
  if (state.phase === "toss") {
    // If toss has not been called yet and AI is calling (away side calls)
    if (!state.tossCall && aiSide === "away") {
      const call: "heads" | "tails" = Math.random() < 0.5 ? "heads" : "tails";
      return { type: "toss_call", call };
    }
    // If toss was won by AI and choice is pending
    if (state.tossWinner === aiSide && !state.tossChoice) {
      // 60% chance to bat first
      const choice: "bat" | "bowl" = Math.random() < 0.6 ? "bat" : "bowl";
      return { type: "toss_choice", choice };
    }
    return null;
  }

  // 2. OPENERS SELECTION (innings_setup)
  if (state.phase === "innings_setup" && state.pendingSelect?.type === "openers") {
    if (isAITurn(state.pendingSelect.forSide)) {
      const teamId = aiSide === "host" ? state.hostTeamId : state.awayTeamId;
      const team = teamId ? getTeam(teamId) : null;
      if (team) {
        const eligible = getEligibleBatters(team);
        if (eligible.length >= 2) {
          return {
            type: "select",
            kind: "openers",
            payload: {
              striker: eligible[0].name,
              nonStriker: eligible[1].name,
            },
          };
        }
      }
    }
    return null;
  }

  // 3. BOWLER SELECTION (select_bowler)
  if (state.phase === "select_bowler" && state.pendingSelect?.type === "bowler") {
    if (isAITurn(state.pendingSelect.forSide)) {
      const inn = state.innings[state.currentInnings];
      const teamId = aiSide === "host" ? state.hostTeamId : state.awayTeamId;
      const team = teamId ? getTeam(teamId) : null;
      if (team && inn) {
        const eligible = getEligibleBowlers(team);
        // Filter out the bowler who bowled the immediate previous over (unless only 1 bowler available)
        const candidates = eligible.filter((p) => p.name !== inn.prevBowler);
        const pool = candidates.length > 0 ? candidates : eligible;
        if (pool.length > 0) {
          const chosen = pool[Math.floor(Math.random() * pool.length)];
          return {
            type: "select",
            kind: "bowler",
            payload: { bowler: chosen.name },
          };
        }
      }
    }
    return null;
  }

  // 4. NEW BATTER SELECTION (select_new_batter)
  if (state.phase === "select_new_batter" && state.pendingSelect?.type === "batter") {
    if (isAITurn(state.pendingSelect.forSide)) {
      const inn = state.innings[state.currentInnings];
      const teamId = aiSide === "host" ? state.hostTeamId : state.awayTeamId;
      const team = teamId ? getTeam(teamId) : null;
      if (team && inn && inn.yetToBat.length > 0) {
        // Pick next in line from yetToBat
        const nextBatter = inn.yetToBat[0];
        return {
          type: "select",
          kind: "batter",
          payload: { batter: nextBatter },
        };
      }
    }
    return null;
  }

  // 5. INNINGS BREAK
  if (state.phase === "innings_break") {
    // Only host decides to start next innings
    if (aiSide === "host") {
      const nextInn = (state.currentInnings + 1) as 2 | 3 | 4;
      // Invert batting side from previous innings
      const prevBatting = state.innings[state.currentInnings]?.battingSide ?? "host";
      const nextBatting: Side = prevBatting === "host" ? "away" : "host";
      return { type: "next_innings_choice", battingSide: nextBatting };
    }
    return null;
  }

  // 6. FOLLOW-ON DECISION
  if (state.phase === "follow_on_decision") {
    if (aiSide === "host") {
      // 50% chance to enforce follow-on
      const enforce = Math.random() < 0.5;
      return { type: "follow_on", enforce };
    }
    return null;
  }

  // 7. PLAYING PHASE (BALL INPUT)
  if (state.phase === "playing") {
    const aiLocked = aiSide === "host" ? state.hostLocked : state.awayLocked;
    if (aiLocked) return null; // already locked

    const inn = state.innings[state.currentInnings];
    if (!inn) return null;

    const isAIBatting = inn.battingSide === aiSide;

    if (isAIBatting) {
      // Batting AI: Pick shot 0–10
      const zerosUsed = zerosUsedThisOver(inn);
      const allowZero = zerosUsed < 3;

      // Weighted distribution:
      // Defence (0): 10% (if allowed)
      // Ground shots (1..5): 60%
      // Aerial/aggressive (6..10): 30%
      const roll = Math.random();

      if (allowZero && roll < 0.12) {
        return { type: "input", value: 0 };
      } else if (roll < 0.72) {
        // Ground shots 1..5
        const groundShots = [1, 2, 3, 4, 5];
        const val = groundShots[Math.floor(Math.random() * groundShots.length)];
        return { type: "input", value: val };
      } else {
        // Aggressive/aerial shots 6..10
        const attackShots = [6, 7, 8, 9, 10];
        const val = attackShots[Math.floor(Math.random() * attackShots.length)];
        return { type: "input", value: val };
      }
    } else {
      // Bowling AI: Pick delivery 1–10
      // Balanced standard deliveries (1, 2, 3, 4): 50%
      // Movement / swing (5, 6): 20%
      // Variations & control (7, 9, 10): 25%
      // Wide yorker (8): 5%
      const roll = Math.random();
      let delivery = 1;
      if (roll < 0.48) {
        const standard = [1, 2, 3, 4];
        delivery = standard[Math.floor(Math.random() * standard.length)];
      } else if (roll < 0.70) {
        delivery = Math.random() < 0.5 ? 5 : 6;
      } else if (roll < 0.94) {
        const tactical = [7, 9, 10];
        delivery = tactical[Math.floor(Math.random() * tactical.length)];
      } else {
        delivery = 8;
      }
      return { type: "input", value: delivery };
    }
  }

  return null;
}
