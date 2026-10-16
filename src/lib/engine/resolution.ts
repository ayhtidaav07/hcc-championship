import {
  DELIVERIES,
  SHOTS,
  getCompatibility,
  DEFAULT_CAPTAIN_FIELD_POSITIONS,
  type CompatibilityResult,
  type FieldingZone,
} from "./constants";
import {
  buildFieldingSetup,
  resolveInterception,
  attemptCatch,
  attemptGroundStop,
  type FieldingSetup,
  type CatchAttemptResult,
} from "./fielding";

export interface BallResolutionInput {
  bat: number; // 0..10
  bowl: number; // 1..10
  strikerName: string;
  bowlerName: string;
  batterOvr?: number; // 1..100, default 70
  bowlerOvr?: number; // 1..100, default 70
  bowlerStreakCount?: number; // consecutive uses of delivery 8 (or active delivery)
  fieldingSetup?: FieldingSetup;
  captainSelectedZones?: FieldingZone[];
  // Optional deterministic random values for testing & anti-exploit verification
  randomOverrides?: {
    battingRoll?: number; // -10 to +10
    bowlingRoll?: number; // -10 to +10
    fieldingRoll?: number; // 0 to 1
    trajectoryRoll?: number; // 0 to 1
    umpireReviewValue?: 1 | 2;
    playerReviewValue?: 1 | 2;
    wideRoll?: number; // 0 to 1
  };
}

export interface LBWReviewState {
  umpireValue: 1 | 2;
  reviewerValue: 1 | 2;
  isOut: boolean;
}

export type DismissalType = "bowled" | "caught" | "stumped" | "lbw";

export interface BallResolutionResult {
  bat: number;
  bowl: number;
  shotName: string;
  deliveryName: string;
  striker: string;
  bowler: string;
  compatibility: CompatibilityResult;
  battingExecution: number;
  bowlingExecution: number;
  streakPenalty: number;
  newStreakCount: number;
  contactQuality: "clean" | "controlled" | "mistimed" | "beaten";
  isBeaten: boolean;
  trajectory: "grounded" | "aerial" | "variable" | "reverse";
  targetZones: string[];
  isWicket: boolean;
  dismissalType: DismissalType | null;
  dismissalFielder: string | null;
  lbwReview: LBWReviewState | null;
  runs: number;
  isBoundary: boolean;
  isSix: boolean;
  isFour: boolean;
  isLegalBall: boolean;
  isExtra: boolean;
  extraType: "wide" | "no_ball" | null;
  extraRuns: number;
}

export function resolveLBWReview(
  umpireValue?: 1 | 2,
  reviewerValue?: 1 | 2,
): LBWReviewState {
  const uVal: 1 | 2 = umpireValue ?? (Math.random() < 0.5 ? 1 : 2);
  const rVal: 1 | 2 = reviewerValue ?? (Math.random() < 0.5 ? 1 : 2);
  const isOut = uVal === rVal;
  return {
    umpireValue: uVal,
    reviewerValue: rVal,
    isOut,
  };
}

export function resolveBallDelivery(input: BallResolutionInput): BallResolutionResult {
  // Step 1: Validate match state and selected inputs
  const bat = Math.max(0, Math.min(10, Math.floor(input.bat)));
  const bowl = Math.max(1, Math.min(10, Math.floor(input.bowl)));

  // Step 2: Read bowler delivery and batter shot
  const deliveryConfig = DELIVERIES[bowl] ?? DELIVERIES[1];
  const shotConfig = SHOTS[bat] ?? SHOTS[0];

  const batterOvr = Math.max(1, Math.min(100, input.batterOvr ?? 70));
  const bowlerOvr = Math.max(1, Math.min(100, input.bowlerOvr ?? 70));

  // Step 3: Look up compatibility result (G, P, B, X, ★)
  const compat = getCompatibility(bat, bowl);

  // Step 4: Calculate bowling execution (OVR, delivery difficulty, streak penalty)
  let streakPenalty = 0;
  let newStreakCount = 0;
  if (bowl === 8) {
    const prevStreak = input.bowlerStreakCount ?? 0;
    newStreakCount = prevStreak + 1;
    if (newStreakCount === 1) {
      streakPenalty = 0; // Normal specialty difficulty
    } else if (newStreakCount === 2) {
      streakPenalty = 15; // Reduced execution reliability
    } else {
      streakPenalty = 30; // Greater execution penalty for 3rd+
    }
  } else {
    newStreakCount = 0; // Selecting a different delivery resets streak
  }

  const randomBowlingNoise = input.randomOverrides?.bowlingRoll ?? (Math.random() * 10 - 5);
  const rawBowlingExecution = bowlerOvr - deliveryConfig.baseDifficulty - streakPenalty + randomBowlingNoise;
  const bowlingExecution = Math.max(0, Math.min(100, Math.round(rawBowlingExecution)));

  // Check for execution failure on specialist delivery 8 resulting in a wide
  let isWide = false;
  if (bowl === 8) {
    const wideThreshold = streakPenalty >= 30 ? 0.35 : streakPenalty >= 15 ? 0.20 : 0.08;
    const wideRoll = input.randomOverrides?.wideRoll ?? Math.random();
    if (bowlingExecution < 40 && wideRoll < wideThreshold) {
      isWide = true;
    }
  }

  if (isWide) {
    return {
      bat,
      bowl,
      shotName: shotConfig.name,
      deliveryName: deliveryConfig.name,
      striker: input.strikerName,
      bowler: input.bowlerName,
      compatibility: compat,
      battingExecution: 50,
      bowlingExecution,
      streakPenalty,
      newStreakCount,
      contactQuality: "beaten",
      isBeaten: true,
      trajectory: "grounded",
      targetZones: [],
      isWicket: false,
      dismissalType: null,
      dismissalFielder: null,
      lbwReview: null,
      runs: 1, // 1 wide run
      isBoundary: false,
      isSix: false,
      isFour: false,
      isLegalBall: false,
      isExtra: true,
      extraType: "wide",
      extraRuns: 1,
    };
  }

  // Step 5: Calculate batting execution (OVR differential, matchup modifiers, star bonus)
  // Formula: clamp(50 + 0.5 × (Batter OVR − Bowler OVR) + Matchup Modifier + Same-Number Bonus, 0, 100)
  const randomBattingNoise = input.randomOverrides?.battingRoll ?? (Math.random() * 8 - 4);
  let rawBattingExecution = 50 + 0.5 * (batterOvr - bowlerOvr) + compat.matchupModifier + compat.starBonus;

  // Bonus for batter if bowler severely mistimes/fails execution (loose ball)
  if (bowlingExecution < 30) {
    rawBattingExecution += 10;
  }

  rawBattingExecution += randomBattingNoise;
  const battingExecution = Math.max(0, Math.min(100, Math.round(rawBattingExecution)));

  // Step 6: Resolve contact quality and whether shot is beaten
  let isBeaten = false;
  let contactQuality: "clean" | "controlled" | "mistimed" | "beaten" = "controlled";

  if (shotConfig.isSafeDefence) {
    // Shot 0 Defence: Clean safe block along ground, 0 runs, immune to dismissals
    contactQuality = "clean";
    isBeaten = false;
  } else if (compat.code === "X") {
    // Beaten shot: no bat contact or bat runs
    contactQuality = "beaten";
    isBeaten = true;
  } else {
    if (battingExecution >= 68) {
      contactQuality = "clean";
    } else if (battingExecution >= 44) {
      contactQuality = "controlled";
    } else if (battingExecution >= 22) {
      contactQuality = "mistimed";
    } else {
      // Extremely low execution against strong bowling execution can beat the bat
      if (bowlingExecution >= 60) {
        contactQuality = "beaten";
        isBeaten = true;
      } else {
        contactQuality = "mistimed";
      }
    }
  }

  // Step 7: Resolve shot direction and trajectory (Grounded vs Aerial)
  let trajectory: "grounded" | "aerial" | "variable" | "reverse" = shotConfig.defaultTrajectory;
  const trajRoll = input.randomOverrides?.trajectoryRoll ?? Math.random();

  if (shotConfig.isSafeDefence) {
    trajectory = "grounded";
  } else if (shotConfig.defaultTrajectory === "grounded") {
    trajectory = "grounded";
  } else if (shotConfig.defaultTrajectory === "aerial") {
    trajectory = "aerial";
  } else if (shotConfig.defaultTrajectory === "variable") {
    // Pull / Sweep: Clean contact can keep it down; mistimed contact tends to balloon aerial
    if (contactQuality === "clean") {
      trajectory = trajRoll < 0.5 ? "grounded" : "aerial";
    } else if (contactQuality === "controlled") {
      trajectory = trajRoll < 0.35 ? "grounded" : "aerial";
    } else {
      trajectory = "aerial"; // mistimed pull/sweep balloons up
    }
  } else if (shotConfig.defaultTrajectory === "reverse") {
    // Reverse sweep
    if (contactQuality === "clean") {
      trajectory = trajRoll < 0.7 ? "grounded" : "aerial";
    } else {
      trajectory = "aerial"; // top edge pop up
    }
  }

  // Step 8: Resolve fielding coverage, stopping, catches, and boundary outcomes
  const fielding =
    input.fieldingSetup ??
    buildFieldingSetup(
      input.bowlerName,
      bowlerOvr,
      "Wicketkeeper",
      75,
      input.captainSelectedZones ?? DEFAULT_CAPTAIN_FIELD_POSITIONS,
    );

  const targetZones = [...shotConfig.primaryZones];
  const fieldRoll = input.randomOverrides?.fieldingRoll ?? Math.random();
  const isDeepZone = trajectory === "aerial" || contactQuality === "clean";

  // Check edge possibility for beaten deliveries near off-stump / outswing
  const isOutsideEdge = isBeaten && (bowl === 6 || bowl === 1 || bowl === 2);
  const interception = resolveInterception(fielding, targetZones, isOutsideEdge);

  // Step 9: Resolve eligible dismissal (mutually exclusive)
  // Dismissal Precedence:
  // 1. Shot 0 is immune to all dismissals.
  // 2. Caught (only on aerial balls covered by fielder before touching ground).
  // 3. Bowled (beaten ball targeting stumps).
  // 4. Stumped (stepping out on beaten/mistimed ball with keeper active).
  // 5. LBW Review (beaten ball hitting pad in line with stumps).
  let isWicket = false;
  let dismissalType: DismissalType | null = null;
  let dismissalFielder: string | null = null;
  let lbwReview: LBWReviewState | null = null;

  if (!shotConfig.isSafeDefence) {
    if (trajectory === "aerial" && !isBeaten) {
      // Catch resolution
      const catchResult: CatchAttemptResult = attemptCatch(interception, trajectory, contactQuality, fieldRoll);
      if (catchResult.caught && catchResult.fielder) {
        isWicket = true;
        dismissalType = "caught";
        dismissalFielder = catchResult.fielder.name;
      }
    } else if (isOutsideEdge && interception.covered && interception.isSlipCordon) {
      // Outside edge caught by keeper or slip (single deduplicated check)
      const edgeCatchResult = attemptCatch(interception, "aerial", "controlled", fieldRoll);
      if (edgeCatchResult.caught && edgeCatchResult.fielder) {
        isWicket = true;
        dismissalType = "caught";
        dismissalFielder = edgeCatchResult.fielder.name;
      }
    }

    // If not caught, check Bowled, Stumped, LBW
    if (!isWicket && isBeaten) {
      const targetsStumps = deliveryConfig.targetsStumps;

      // Stumping check: batter stepped out (Shots 8, 9, or stepping sweeps 7, 10 against spin 1, 9, 10)
      const isSteppingOut = bat === 8 || bat === 9 || (bat === 7 && (bowl === 1 || bowl === 9)) || (bat === 10 && bowl === 9);
      if (isSteppingOut && fielding.keeper && fieldRoll < 0.65) {
        isWicket = true;
        dismissalType = "stumped";
        dismissalFielder = fielding.keeper.name;
      } else if (targetsStumps) {
        // Stumps are in line. Can be Bowled or LBW
        // Bowled vs LBW check
        const bowledDanger = bowl === 10 ? 0.45 : bowl === 5 ? 0.35 : bowl === 1 ? 0.25 : 0.20;
        const adjustedBowledProb = bowledDanger * (bowlingExecution / 80);

        if (fieldRoll < adjustedBowledProb) {
          isWicket = true;
          dismissalType = "bowled";
        } else if (fieldRoll < adjustedBowledProb + 0.30) {
          // LBW Review Mini-Game triggered!
          const review = resolveLBWReview(
            input.randomOverrides?.umpireReviewValue,
            input.randomOverrides?.playerReviewValue,
          );
          lbwReview = review;
          if (review.isOut) {
            isWicket = true;
            dismissalType = "lbw";
          }
        }
      }
    }
  }

  // Step 10: Calculate runs and extras
  let runs = 0;
  let isBoundary = false;
  let isFour = false;
  let isSix = false;

  if (isWicket) {
    runs = 0;
  } else if (shotConfig.isSafeDefence || isBeaten) {
    runs = 0;
  } else {
    // Normal scoring calculation based on contact, trajectory, fielding and delivery constraints
    if (trajectory === "grounded") {
      const stopResult = attemptGroundStop(interception, contactQuality, isDeepZone, fieldRoll);
      runs = stopResult.runsAllowed;
    } else {
      // Aerial shot that was not caught
      const runRoll = input.randomOverrides?.fieldingRoll ?? Math.random();
      if (contactQuality === "clean") {
        if (!interception.covered) {
          // Open outfield: boundary!
          runs = runRoll < 0.6 ? 6 : 4;
        } else {
          // Deep fielder covers zone: boundary stop or 4
          runs = runRoll < 0.4 ? 4 : 2;
        }
      } else if (contactQuality === "controlled") {
        runs = !interception.covered ? (runRoll < 0.7 ? 4 : 2) : (runRoll < 0.5 ? 2 : 1);
      } else {
        // Mistimed aerial: lands in vacant area
        runs = !interception.covered ? (runRoll < 0.6 ? 2 : 1) : 1;
      }
    }

    // Delivery 7 Rule: Restrictive control delivery (suppresses heavy scoring)
    if (deliveryConfig.isRestrictiveControl && runs > 2) {
      // Only clean pull (Shot 6 with G★) or clean slog (Shot 9 with G) can reliably hit boundaries off 7
      if (!((bat === 6 && compat.hasStar) || (bat === 9 && compat.code === "G")) || contactQuality !== "clean") {
        runs = Math.min(runs, 2);
      }
    }

    // Delivery 3 Rule: Preserves its maximum 4-run scoring limit
    if (deliveryConfig.maxRunsCap !== undefined && runs > deliveryConfig.maxRunsCap) {
      runs = deliveryConfig.maxRunsCap;
    }

    if (runs === 4) {
      isBoundary = true;
      isFour = true;
    } else if (runs === 6) {
      isBoundary = true;
      isSix = true;
    }
  }

  return {
    bat,
    bowl,
    shotName: shotConfig.name,
    deliveryName: deliveryConfig.name,
    striker: input.strikerName,
    bowler: input.bowlerName,
    compatibility: compat,
    battingExecution,
    bowlingExecution,
    streakPenalty,
    newStreakCount,
    contactQuality,
    isBeaten,
    trajectory,
    targetZones,
    isWicket,
    dismissalType,
    dismissalFielder,
    lbwReview,
    runs,
    isBoundary,
    isSix,
    isFour,
    isLegalBall: true,
    isExtra: false,
    extraType: null,
    extraRuns: 0,
  };
}
