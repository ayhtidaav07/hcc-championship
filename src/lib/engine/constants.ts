export type CompatibilityCode = "G" | "P" | "B" | "X";

export interface DeliveryConfig {
  number: number;
  name: string;
  category: "balanced" | "pace" | "spin" | "specialist";
  intendedBehaviour: string;
  baseDifficulty: number; // 0 to 15
  targetsStumps: boolean; // capable of bowled/LBW
  maxRunsCap?: number; // e.g. Delivery 3 capped at 4
  isRestrictiveControl?: boolean; // Delivery 7
}

export interface ShotConfig {
  number: number;
  name: string;
  defaultTrajectory: "grounded" | "aerial" | "variable" | "reverse";
  intent: string;
  isSafeDefence?: boolean; // Shot 0
  primaryZones: string[];
}

export interface CompatibilityResult {
  code: CompatibilityCode;
  hasStar: boolean;
  matchupModifier: number; // +12, 0, -12, 0
  starBonus: number; // +4 or 0
  totalMatchupContribution: number; // max +16
  isBeaten: boolean;
}

export const MATCHUP_MODIFIERS: Record<CompatibilityCode, number> = {
  G: 12,
  P: 0,
  B: -12,
  X: 0,
};

export const STAR_BONUS = 4;

export const DELIVERIES: Record<number, DeliveryConfig> = {
  1: {
    number: 1,
    name: "Good length / flighted",
    category: "balanced",
    intendedBehaviour: "Balanced standard delivery",
    baseDifficulty: 0,
    targetsStumps: true,
  },
  2: {
    number: 2,
    name: "Full / quicker",
    category: "pace",
    intendedBehaviour: "Tests front-foot timing",
    baseDifficulty: 2,
    targetsStumps: true,
  },
  3: {
    number: 3,
    name: "Back of length / stock spin",
    category: "balanced",
    intendedBehaviour: "Challenges drives and tests back-foot play (max 4 runs)",
    baseDifficulty: 1,
    targetsStumps: false,
    maxRunsCap: 4,
  },
  4: {
    number: 4,
    name: "Slot / overpitched",
    category: "pace",
    intendedBehaviour: "Attacking opportunity if poorly executed",
    baseDifficulty: 0,
    targetsStumps: true,
  },
  5: {
    number: 5,
    name: "Inswing / turn in",
    category: "specialist",
    intendedBehaviour: "Moves towards the batter",
    baseDifficulty: 4,
    targetsStumps: true,
  },
  6: {
    number: 6,
    name: "Outswing / turn away",
    category: "specialist",
    intendedBehaviour: "Moves away from the batter",
    baseDifficulty: 4,
    targetsStumps: false,
  },
  7: {
    number: 7,
    name: "Short / flat spin",
    category: "balanced",
    intendedBehaviour: "Restrictive, reliable control delivery",
    baseDifficulty: 0,
    targetsStumps: false,
    isRestrictiveControl: true,
  },
  8: {
    number: 8,
    name: "Wide yorker / wide line",
    category: "specialist",
    intendedBehaviour: "Specialist delivery with execution risk",
    baseDifficulty: 8,
    targetsStumps: false,
  },
  9: {
    number: 9,
    name: "Slower / flighted",
    category: "specialist",
    intendedBehaviour: "Tests timing and encourages mistiming",
    baseDifficulty: 3,
    targetsStumps: true,
  },
  10: {
    number: 10,
    name: "Yorker / arm ball",
    category: "specialist",
    intendedBehaviour: "Challenges execution near the stumps",
    baseDifficulty: 6,
    targetsStumps: true,
  },
};

export const SHOTS: Record<number, ShotConfig> = {
  0: {
    number: 0,
    name: "Defence",
    defaultTrajectory: "grounded",
    intent: "Safe defence, zero runs (Immune to all dismissals)",
    isSafeDefence: true,
    primaryZones: ["bowler", "mid_on", "mid_off"],
  },
  1: {
    number: 1,
    name: "Late dab",
    defaultTrajectory: "grounded",
    intent: "Grounded, behind point",
    primaryZones: ["third_man", "backward_point", "point"],
  },
  2: {
    number: 2,
    name: "Cut",
    defaultTrajectory: "grounded",
    intent: "Grounded, square off side",
    primaryZones: ["point", "backward_point", "deep_point", "cover"],
  },
  3: {
    number: 3,
    name: "Cover drive",
    defaultTrajectory: "grounded",
    intent: "Grounded, through cover",
    primaryZones: ["cover", "extra_cover", "deep_cover"],
  },
  4: {
    number: 4,
    name: "Straight drive",
    defaultTrajectory: "grounded",
    intent: "Grounded, down the ground",
    primaryZones: ["mid_off", "mid_on", "long_off", "long_on"],
  },
  5: {
    number: 5,
    name: "Flick",
    defaultTrajectory: "grounded",
    intent: "Grounded, leg side",
    primaryZones: ["midwicket", "square_leg", "fine_leg"],
  },
  6: {
    number: 6,
    name: "Pull",
    defaultTrajectory: "variable",
    intent: "Primarily aerial, leg side",
    primaryZones: ["midwicket", "square_leg", "deep_square_leg"],
  },
  7: {
    number: 7,
    name: "Sweep",
    defaultTrajectory: "variable",
    intent: "Low or aerial, leg side",
    primaryZones: ["square_leg", "fine_leg", "deep_square_leg"],
  },
  8: {
    number: 8,
    name: "Loft drive",
    defaultTrajectory: "aerial",
    intent: "Aerial, straight/off side",
    primaryZones: ["long_off", "long_on", "extra_cover", "deep_cover"],
  },
  9: {
    number: 9,
    name: "Slog",
    defaultTrajectory: "aerial",
    intent: "Aggressive aerial shot",
    primaryZones: ["midwicket", "long_on", "deep_square_leg"],
  },
  10: {
    number: 10,
    name: "Reverse sweep",
    defaultTrajectory: "reverse",
    intent: "Reverse-side placement",
    primaryZones: ["point", "backward_point", "third_man", "deep_point"],
  },
};

// Raw compatibility cells [shot][delivery]
// Format: "G", "P", "B", "X", "G*"
const RAW_COMPATIBILITY_MATRIX: Record<number, Record<number, string>> = {
  0: { 1: "P", 2: "P", 3: "P", 4: "P", 5: "P", 6: "P", 7: "P", 8: "P", 9: "P", 10: "P" },
  1: { 1: "G*", 2: "P", 3: "P", 4: "P", 5: "P", 6: "P", 7: "X", 8: "X", 9: "P", 10: "B" },
  2: { 1: "G", 2: "G*", 3: "G", 4: "P", 5: "P", 6: "G", 7: "P", 8: "X", 9: "P", 10: "X" },
  3: { 1: "P", 2: "G", 3: "G*", 4: "G", 5: "B", 6: "P", 7: "X", 8: "B", 9: "P", 10: "P" },
  4: { 1: "P", 2: "G", 3: "P", 4: "G*", 5: "P", 6: "P", 7: "B", 8: "X", 9: "B", 10: "P" },
  5: { 1: "P", 2: "P", 3: "B", 4: "G", 5: "G*", 6: "P", 7: "B", 8: "X", 9: "P", 10: "B" },
  6: { 1: "B", 2: "B", 3: "P", 4: "B", 5: "G", 6: "P", 7: "G*", 8: "X", 9: "B", 10: "X" },
  7: { 1: "P", 2: "P", 3: "P", 4: "P", 5: "G", 6: "B", 7: "G", 8: "G*", 9: "G", 10: "B" },
  8: { 1: "P", 2: "P", 3: "P", 4: "G", 5: "B", 6: "B", 7: "B", 8: "B", 9: "P", 10: "G*" },
  9: { 1: "B", 2: "P", 3: "G", 4: "G", 5: "P", 6: "B", 7: "G", 8: "P", 9: "G*", 10: "G" },
  10: { 1: "P", 2: "B", 3: "G", 4: "B", 5: "P", 6: "P", 7: "B", 8: "X", 9: "G", 10: "G*" },
};

export function getCompatibility(shot: number, delivery: number): CompatibilityResult {
  const row = RAW_COMPATIBILITY_MATRIX[shot] ?? RAW_COMPATIBILITY_MATRIX[0];
  const raw = row[delivery] ?? "P";
  const hasStar = raw.includes("*") || raw.includes("★");
  const code = raw.replace(/[*★]/g, "") as CompatibilityCode;
  const matchupModifier = MATCHUP_MODIFIERS[code] ?? 0;
  const starBonus = hasStar ? STAR_BONUS : 0;
  const totalMatchupContribution = Math.min(16, matchupModifier + starBonus);

  return {
    code,
    hasStar,
    matchupModifier,
    starBonus,
    totalMatchupContribution,
    isBeaten: code === "X",
  };
}

export const ALL_FIELDING_ZONES = [
  "wicketkeeper",
  "first_slip",
  "second_slip",
  "third_man",
  "point",
  "backward_point",
  "cover",
  "extra_cover",
  "mid_off",
  "mid_on",
  "midwicket",
  "short_midwicket",
  "square_leg",
  "fine_leg",
  "deep_point",
  "deep_cover",
  "long_off",
  "long_on",
  "deep_midwicket",
  "deep_square_leg",
  "deep_third_man",
] as const;

export type FieldingZone = (typeof ALL_FIELDING_ZONES)[number];

// The 5 inner-circle and 6 outer-field positions required by HCC Master Gameplay Specification
export const INNER_FIELDING_POSITIONS: readonly FieldingZone[] = [
  "point",
  "cover",
  "mid_off",
  "mid_on",
  "short_midwicket",
];

export const OUTER_FIELDING_POSITIONS: readonly FieldingZone[] = [
  "deep_third_man",
  "deep_cover",
  "long_off",
  "long_on",
  "deep_midwicket",
  "fine_leg",
];

export const TACTICAL_FIELDING_POSITIONS: readonly FieldingZone[] = [
  ...INNER_FIELDING_POSITIONS,
  ...OUTER_FIELDING_POSITIONS,
];

export const FIELDING_POSITION_NAMES: Record<FieldingZone, string> = {
  point: "Point",
  cover: "Cover",
  mid_off: "Mid-off",
  mid_on: "Mid-on",
  short_midwicket: "Short Midwicket",
  deep_third_man: "Deep Third Man",
  deep_cover: "Deep Cover",
  long_off: "Long-off",
  long_on: "Long-on",
  deep_midwicket: "Deep Midwicket",
  fine_leg: "Fine Leg",
  // Legacy aliases
  midwicket: "Short Midwicket",
  third_man: "Deep Third Man",
  deep_square_leg: "Deep Midwicket",
  wicketkeeper: "Wicketkeeper",
  first_slip: "First Slip",
  second_slip: "Second Slip",
  backward_point: "Backward Point",
  extra_cover: "Extra Cover",
  square_leg: "Square Leg",
  deep_point: "Deep Point",
};

export const FIELDING_POSITION_DESCRIPTIONS: Record<FieldingZone, string> = {
  point: "Covers cut shots and square shots on the off side",
  cover: "Covers cover drives and shots through the off-side gap",
  mid_off: "Covers straighter shots on the off side",
  mid_on: "Covers straighter shots on the leg side",
  short_midwicket: "Covers flicks, pulls and shots into the leg-side infield",
  deep_third_man: "Covers area behind point on off side; useful against dabs, cuts and reverse shots",
  deep_cover: "Covers lofted or powerful shots through the cover region",
  long_off: "Covers lofted shots towards the straight off side",
  long_on: "Covers lofted shots towards the straight leg side",
  deep_midwicket: "Covers pulls, flicks and lofted leg-side shots",
  fine_leg: "Covers shots travelling behind the batter on the leg side, including sweeps",
  // Legacy fallbacks
  midwicket: "Covers flicks, pulls and shots into the leg-side infield",
  third_man: "Covers area behind point on off side",
  deep_square_leg: "Covers pulls, flicks and lofted leg-side shots",
  wicketkeeper: "Stationed directly behind the batter",
  first_slip: "Cordon behind off stump",
  second_slip: "Cordon wider behind off stump",
  backward_point: "Behind square on off side",
  extra_cover: "Between cover and mid-off",
  square_leg: "Square on the leg side",
  deep_point: "Deep boundary behind point",
};

// Default captain positions: 2 inside, 2 outside (valid distribution)
export const DEFAULT_CAPTAIN_FIELD_POSITIONS: FieldingZone[] = [
  "cover",
  "mid_on",
  "long_off",
  "deep_midwicket",
];

// Full Shot Metadata (Section 15)
export interface ShotMetadata {
  number: number;
  name: string;
  description: string;
  angle: number; // degrees from straight: negative = off side, positive = leg side
  targetZones: FieldingZone[];
}

export const SHOT_METADATA: Record<number, ShotMetadata> = {
  0: {
    number: 0,
    name: "Defence",
    description: "Play safely with a defensive shot",
    angle: 0,
    targetZones: ["mid_off", "mid_on"],
  },
  1: {
    number: 1,
    name: "Dab",
    description: "Guide the ball into the off-side region behind point",
    angle: -55,
    targetZones: ["point", "deep_third_man"],
  },
  2: {
    number: 2,
    name: "Cut",
    description: "Play square on the off side",
    angle: -75,
    targetZones: ["point", "deep_third_man"],
  },
  3: {
    number: 3,
    name: "Cover Drive",
    description: "Drive through the cover region",
    angle: -40,
    targetZones: ["cover", "deep_cover"],
  },
  4: {
    number: 4,
    name: "Drive",
    description: "Play a straighter drive on the off side",
    angle: -10,
    targetZones: ["mid_off", "long_off"],
  },
  5: {
    number: 5,
    name: "Flick",
    description: "Work the ball towards the leg side",
    angle: 35,
    targetZones: ["mid_on", "short_midwicket", "deep_midwicket"],
  },
  6: {
    number: 6,
    name: "Pull",
    description: "Play a cross-batted shot towards the leg side",
    angle: 65,
    targetZones: ["short_midwicket", "deep_midwicket", "fine_leg"],
  },
  7: {
    number: 7,
    name: "Sweep",
    description: "Sweep the ball towards the leg side",
    angle: 80,
    targetZones: ["short_midwicket", "fine_leg"],
  },
  8: {
    number: 8,
    name: "Loft",
    description: "Attempt an aerial shot in the mapped direction",
    angle: -25,
    targetZones: ["deep_cover", "long_off", "long_on", "deep_midwicket"],
  },
  9: {
    number: 9,
    name: "Slog",
    description: "Play a powerful cross-batted shot using the existing direction mapping",
    angle: 50,
    targetZones: ["short_midwicket", "deep_midwicket", "long_on"],
  },
  10: {
    number: 10,
    name: "Reverse",
    description: "Play the existing reverse-shot variation",
    angle: -65,
    targetZones: ["point", "deep_third_man"],
  },
};

// Full Delivery Metadata (Section 15)
export interface DeliveryMetadata {
  number: number;
  name: string;
  description: string;
  landingYPercent: number; // 0 (bowler) to 100 (batter)
  landingXPercent: number; // 50 is middle stump, <50 off side, >50 leg side
}

export const DELIVERY_METADATA: Record<number, DeliveryMetadata> = {
  1: {
    number: 1,
    name: "Good Length",
    description: "Target a controlled good-length delivery",
    landingYPercent: 45,
    landingXPercent: 50,
  },
  2: {
    number: 2,
    name: "Full",
    description: "Pitch the ball fuller",
    landingYPercent: 72,
    landingXPercent: 50,
  },
  3: {
    number: 3,
    name: "Back of a Length",
    description: "Bowl slightly shorter than a good length",
    landingYPercent: 32,
    landingXPercent: 49,
  },
  4: {
    number: 4,
    name: "Slot Ball",
    description: "Target the existing slot-delivery region",
    landingYPercent: 82,
    landingXPercent: 50,
  },
  5: {
    number: 5,
    name: "Inswing",
    description: "Move the ball inward according to the existing delivery mapping",
    landingYPercent: 65,
    landingXPercent: 53,
  },
  6: {
    number: 6,
    name: "Outswing",
    description: "Move the ball outward according to the existing delivery mapping",
    landingYPercent: 58,
    landingXPercent: 46,
  },
  7: {
    number: 7,
    name: "Short Ball",
    description: "Bowl a shorter delivery",
    landingYPercent: 22,
    landingXPercent: 50,
  },
  8: {
    number: 8,
    name: "Wide",
    description: "Target the existing wide-delivery area",
    landingYPercent: 60,
    landingXPercent: 36,
  },
  9: {
    number: 9,
    name: "Slower Ball",
    description: "Reduce delivery pace according to the existing mechanics",
    landingYPercent: 48,
    landingXPercent: 50,
  },
  10: {
    number: 10,
    name: "Yorker",
    description: "Target the base of the stumps",
    landingYPercent: 92,
    landingXPercent: 50,
  },
};

