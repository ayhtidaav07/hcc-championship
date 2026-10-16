import { describe, it, expect } from "vitest";
import {
  SHOT_METADATA,
  DELIVERY_METADATA,
  INNER_FIELDING_POSITIONS,
  OUTER_FIELDING_POSITIONS,
  TACTICAL_FIELDING_POSITIONS,
  FIELDING_POSITION_NAMES,
  FIELDING_POSITION_DESCRIPTIONS,
} from "./constants";
import {
  validateFieldDistribution,
  validateFielderMove,
} from "./fieldingValidation";
import { buildFieldingSetup, resolveInterception } from "./fielding";
import { resolveBallDelivery, resolveLBWReview } from "./resolution";
import { getAIDecision } from "../practiceAI";
import {
  createInitialState,
  startInnings,
  setOpeners,
  setBowler,
  setNewBatter,
  lockInput,
  resolveBall,
} from "../gameEngine";
import { TEAMS } from "../teams";

describe("HCC Master Gameplay Final Integration Test", () => {
  it("verifies exact 5 inner and 6 outer named tactical fielding positions", () => {
    expect(INNER_FIELDING_POSITIONS).toHaveLength(5);
    expect(OUTER_FIELDING_POSITIONS).toHaveLength(6);
    expect(TACTICAL_FIELDING_POSITIONS).toHaveLength(11);

    // 5 Inner
    expect(INNER_FIELDING_POSITIONS).toContain("point");
    expect(INNER_FIELDING_POSITIONS).toContain("cover");
    expect(INNER_FIELDING_POSITIONS).toContain("mid_off");
    expect(INNER_FIELDING_POSITIONS).toContain("mid_on");
    expect(INNER_FIELDING_POSITIONS).toContain("short_midwicket");

    // 6 Outer
    expect(OUTER_FIELDING_POSITIONS).toContain("deep_third_man");
    expect(OUTER_FIELDING_POSITIONS).toContain("deep_cover");
    expect(OUTER_FIELDING_POSITIONS).toContain("long_off");
    expect(OUTER_FIELDING_POSITIONS).toContain("long_on");
    expect(OUTER_FIELDING_POSITIONS).toContain("deep_midwicket");
    expect(OUTER_FIELDING_POSITIONS).toContain("fine_leg");

    // All 11 have human-readable names and descriptions
    for (const zone of TACTICAL_FIELDING_POSITIONS) {
      expect(FIELDING_POSITION_NAMES[zone]).toBeDefined();
      expect(FIELDING_POSITION_DESCRIPTIONS[zone]).toBeDefined();
    }
  });

  it("verifies shot tactical coverage mapping (Section 14)", () => {
    // 1. Cover Drive (3) -> covered by 'cover' or 'deep_cover'
    const setupCover = buildFieldingSetup("Bowler", 75, "Keeper", 75, ["cover", "mid_on", "long_off", "deep_midwicket"]);
    const resCover = resolveBallDelivery({
      bat: 3,
      bowl: 2,
      strikerName: "Batter",
      bowlerName: "Bowler",
      fieldingSetup: setupCover,
      randomOverrides: { battingRoll: 0, fieldingRoll: 0.1 },
    });
    expect(resCover.runs).toBeLessThanOrEqual(2);

    // 2. Dab (1) -> covered by 'point' or 'deep_third_man'
    const setupDab = buildFieldingSetup("Bowler", 75, "Keeper", 75, ["point", "mid_on", "long_off", "deep_midwicket"]);
    const interceptDab = resolveInterception(setupDab, SHOT_METADATA[1].targetZones);
    expect(interceptDab.covered).toBe(true);
    expect(interceptDab.primaryFielder?.zone).toBe("point");

    // 3. Cut (2) -> covered by 'point' or 'deep_third_man'
    const interceptCut = resolveInterception(setupDab, SHOT_METADATA[2].targetZones);
    expect(interceptCut.covered).toBe(true);

    // 4. Drive (4) -> covered by 'mid_off' or 'long_off'
    const interceptDrive = resolveInterception(setupCover, SHOT_METADATA[4].targetZones);
    expect(interceptDrive.covered).toBe(true);
    expect(interceptDrive.primaryFielder?.zone).toBe("long_off");

    // 5. Flick (5) -> covered by 'mid_on', 'short_midwicket', 'deep_midwicket'
    const interceptFlick = resolveInterception(setupCover, SHOT_METADATA[5].targetZones);
    expect(interceptFlick.covered).toBe(true);

    // 6. Pull (6) -> covered by 'short_midwicket', 'deep_midwicket', 'fine_leg'
    const interceptPull = resolveInterception(setupCover, SHOT_METADATA[6].targetZones);
    expect(interceptPull.covered).toBe(true);
    expect(interceptPull.primaryFielder?.zone).toBe("deep_midwicket");

    // 7. Sweep (7) -> covered by 'short_midwicket', 'fine_leg'
    const setupSweep = buildFieldingSetup("Bowler", 75, "Keeper", 75, ["cover", "mid_on", "short_midwicket", "fine_leg"]);
    const interceptSweep = resolveInterception(setupSweep, SHOT_METADATA[7].targetZones);
    expect(interceptSweep.covered).toBe(true);

    // 8. Loft (8) -> covered by deep fielders
    const interceptLoft = resolveInterception(setupCover, SHOT_METADATA[8].targetZones);
    expect(interceptLoft.covered).toBe(true);
    expect(["long_off", "deep_midwicket"]).toContain(interceptLoft.primaryFielder?.zone);

    // 9. Slog (9) -> covered by 'short_midwicket', 'deep_midwicket', 'long_on'
    const interceptSlog = resolveInterception(setupCover, SHOT_METADATA[9].targetZones);
    expect(interceptSlog.covered).toBe(true);
    expect(interceptSlog.primaryFielder?.zone).toBe("deep_midwicket");

    // 10. Reverse (10) -> covered by 'point', 'deep_third_man'
    const setupReverse = buildFieldingSetup("Bowler", 75, "Keeper", 75, ["deep_third_man", "cover", "mid_on", "long_off"]);
    const interceptReverse = resolveInterception(setupReverse, SHOT_METADATA[10].targetZones);
    expect(interceptReverse.covered).toBe(true);
    expect(interceptReverse.primaryFielder?.zone).toBe("deep_third_man");
  });

  it("verifies all 11 shots and 10 deliveries have full names and descriptions (Section 15)", () => {
    // 0 to 10 shots
    for (let i = 0; i <= 10; i++) {
      expect(SHOT_METADATA[i]).toBeDefined();
      expect(SHOT_METADATA[i].name.length).toBeGreaterThan(1);
      expect(SHOT_METADATA[i].description.length).toBeGreaterThan(10);
    }
    expect(SHOT_METADATA[0].name).toBe("Defence");
    expect(SHOT_METADATA[1].name).toBe("Dab");
    expect(SHOT_METADATA[2].name).toBe("Cut");
    expect(SHOT_METADATA[3].name).toBe("Cover Drive");
    expect(SHOT_METADATA[4].name).toBe("Drive");
    expect(SHOT_METADATA[5].name).toBe("Flick");
    expect(SHOT_METADATA[6].name).toBe("Pull");
    expect(SHOT_METADATA[7].name).toBe("Sweep");
    expect(SHOT_METADATA[8].name).toBe("Loft");
    expect(SHOT_METADATA[9].name).toBe("Slog");
    expect(SHOT_METADATA[10].name).toBe("Reverse");

    // 1 to 10 deliveries
    for (let i = 1; i <= 10; i++) {
      expect(DELIVERY_METADATA[i]).toBeDefined();
      expect(DELIVERY_METADATA[i].name.length).toBeGreaterThan(1);
      expect(DELIVERY_METADATA[i].description.length).toBeGreaterThan(10);
    }
    expect(DELIVERY_METADATA[1].name).toBe("Good Length");
    expect(DELIVERY_METADATA[2].name).toBe("Full");
    expect(DELIVERY_METADATA[3].name).toBe("Back of a Length");
    expect(DELIVERY_METADATA[4].name).toBe("Slot Ball");
    expect(DELIVERY_METADATA[5].name).toBe("Inswing");
    expect(DELIVERY_METADATA[6].name).toBe("Outswing");
    expect(DELIVERY_METADATA[7].name).toBe("Short Ball");
    expect(DELIVERY_METADATA[8].name).toBe("Wide");
    expect(DELIVERY_METADATA[9].name).toBe("Slower Ball");
    expect(DELIVERY_METADATA[10].name).toBe("Yorker");
  });

  it("verifies HCC decision review mechanism (Section 11)", () => {
    // Matching numbers produce OUT
    const r1 = resolveLBWReview(1, 1);
    expect(r1.isOut).toBe(true);

    const r2 = resolveLBWReview(2, 2);
    expect(r2.isOut).toBe(true);

    // Differing numbers produce NOT OUT
    const r3 = resolveLBWReview(1, 2);
    expect(r3.isOut).toBe(false);

    const r4 = resolveLBWReview(2, 1);
    expect(r4.isOut).toBe(false);
  });

  it("verifies Practice AI decision making with real HCC squads (Section 10)", () => {
    // Create match with real teams: TUXI vs SS
    let state = createInitialState("AI-TEST-1");
    state.hostTeamId = "TUXI";
    state.awayTeamId = "SS";
    state.phase = "toss";

    // 1. AI handles toss call when away
    const tossDecision = getAIDecision(state, "away");
    expect(tossDecision).toBeDefined();
    expect(tossDecision?.type).toBe("toss_call");
    expect(["heads", "tails"]).toContain(tossDecision?.call);

    // Apply toss result
    state.tossCall = tossDecision!.call!;
    state.tossResult = "heads";
    state.tossWinner = "away";

    // 2. AI handles toss choice
    const choiceDecision = getAIDecision(state, "away");
    expect(choiceDecision).toBeDefined();
    expect(choiceDecision?.type).toBe("toss_choice");
    expect(["bat", "bowl"]).toContain(choiceDecision?.choice);

    // Start innings 1 with away batting
    state = startInnings(state, 1, "away");
    expect(state.phase).toBe("innings_setup");

    // 3. AI picks openers from real SS squad
    const openersDecision = getAIDecision(state, "away");
    expect(openersDecision).toBeDefined();
    expect(openersDecision?.type).toBe("select");
    expect(openersDecision?.kind).toBe("openers");
    expect(openersDecision?.payload.striker).toBe("Rohit Sharma");
    expect(openersDecision?.payload.nonStriker).toBe("Suryakumar Yadav");

    state = setOpeners(state, openersDecision!.payload.striker, openersDecision!.payload.nonStriker);
    expect(state.phase).toBe("select_bowler");

    // 4. Host (human) picks bowler from TUXI
    state = setBowler(state, "Mohd Shami");
    expect(state.phase).toBe("playing");

    // 5. AI batting choice
    const batDecision = getAIDecision(state, "away");
    expect(batDecision).toBeDefined();
    expect(batDecision?.type).toBe("input");
    expect(batDecision?.value).toBeGreaterThanOrEqual(0);
    expect(batDecision?.value).toBeLessThanOrEqual(10);

    // Human bowler picks delivery
    state = lockInput(state, "host", 1);
    // AI batter picks shot
    state = lockInput(state, "away", batDecision!.value!);
    expect(state.hostLocked).toBe(true);
    expect(state.awayLocked).toBe(true);

    // 6. Resolve ball
    state = resolveBall(state);
    expect(state.innings[1]?.balls).toHaveLength(1);
    expect(state.lastBall).toBeDefined();
    expect(state.hostLocked).toBe(false);
    expect(state.awayLocked).toBe(false);
  });

  it("simulates full 2-innings Practice match to completion without stalls (Section 10)", () => {
    let state = createInitialState("AI-SIM-MATCH");
    state.hostTeamId = "TUXI";
    state.awayTeamId = "CJ";
    state.awayConnected = true;
    state = startInnings({ ...state, tossChoice: "bat", tossWinner: "away" }, 1, "away");

    let steps = 0;
    while (state.phase !== "match_over" && steps < 500) {
      steps++;
      if (state.phase === "innings_setup") {
        const inn = state.innings[state.currentInnings]!;
        const dec = getAIDecision(state, inn.battingSide);
        state = setOpeners(
          state,
          dec?.payload?.striker ?? "Striker",
          dec?.payload?.nonStriker ?? "Non-Striker"
        );
      } else if (state.phase === "select_bowler") {
        const inn = state.innings[state.currentInnings]!;
        const bowlingSide = inn.battingSide === "host" ? "away" : "host";
        const dec = getAIDecision(state, bowlingSide);
        state = setBowler(state, dec?.payload?.bowler ?? "Bowler");
      } else if (state.phase === "select_new_batter") {
        const inn = state.innings[state.currentInnings]!;
        const dec = getAIDecision(state, inn.battingSide);
        if (dec && dec.type === "select") {
          state = setNewBatter(state, dec.payload.batter);
        } else {
          break;
        }
      } else if (state.phase === "playing") {
        const inn = state.innings[state.currentInnings]!;
        const bowlingSide = inn.battingSide === "host" ? "away" : "host";
        const batDec = getAIDecision(state, inn.battingSide) ?? { type: "input", value: 3 };
        const bowlDec = getAIDecision(state, bowlingSide) ?? { type: "input", value: 1 };
        state = lockInput(state, inn.battingSide, batDec.value!);
        state = lockInput(state, bowlingSide, bowlDec.value!);
        state = resolveBall(state);
      } else if (state.phase === "innings_break") {
        const nextBatting = state.innings[state.currentInnings]!.battingSide === "host" ? "away" : "host";
        if (state.currentInnings >= 2) {
          state = { ...state, phase: "match_over" };
        } else {
          state = startInnings(state, (state.currentInnings + 1) as any, nextBatting);
        }
      }
    }

    expect(state.phase).toBe("match_over");
    expect(state.innings[1]?.runs).toBeGreaterThanOrEqual(0);
    expect(state.innings[2]?.runs).toBeGreaterThanOrEqual(0);
  });
});

