import { ALL_FIELDING_ZONES, type FieldingZone, DEFAULT_CAPTAIN_FIELD_POSITIONS } from "./constants";

export interface FielderOnField {
  id: string;
  name: string;
  role: string;
  fieldingOvr: number; // 1-100
  zone: FieldingZone | "bowler";
}

export interface FieldingSetup {
  keeper: FielderOnField;
  bowler: FielderOnField;
  fielders: FielderOnField[]; // exactly 4 captain-selected fielders
}

export interface InterceptionResult {
  covered: boolean;
  primaryFielder: FielderOnField | null;
  overlappingFielders: FielderOnField[];
  isSlipCordon: boolean;
}

export interface CatchAttemptResult {
  attempted: boolean;
  caught: boolean;
  fielder: FielderOnField | null;
  dropReason?: string;
}

export interface GroundStopResult {
  stopped: boolean;
  fielder: FielderOnField | null;
  runsAllowed: number; // 0, 1, 2, 3, or 4
}

// Cordon zones that share the same edge deduplication
export const SLIP_CORDON_ZONES = new Set<string>(["wicketkeeper", "first_slip", "second_slip"]);

// Helper to construct a fielding team of 6 players
export function buildFieldingSetup(
  bowlerName: string,
  bowlerOvr: number = 70,
  keeperName: string = "Wicketkeeper",
  keeperOvr: number = 75,
  captainSelectedZones: FieldingZone[] = DEFAULT_CAPTAIN_FIELD_POSITIONS,
  otherFielders: { name: string; ovr?: number; role?: string }[] = [],
): FieldingSetup {
  const selected = captainSelectedZones.slice(0, 4);
  while (selected.length < 4) {
    for (const z of ALL_FIELDING_ZONES) {
      if (z !== "wicketkeeper" && !selected.includes(z)) {
        selected.push(z);
        if (selected.length === 4) break;
      }
    }
  }

  const fielders: FielderOnField[] = selected.map((zone, idx) => {
    const fData = otherFielders[idx];
    return {
      id: `f-${idx + 1}`,
      name: fData?.name ?? `Fielder ${idx + 1}`,
      role: fData?.role ?? "Field",
      fieldingOvr: Math.max(1, Math.min(100, fData?.ovr ?? 70)),
      zone,
    };
  });

  return {
    keeper: {
      id: "keeper",
      name: keeperName,
      role: "WK",
      fieldingOvr: Math.max(1, Math.min(100, keeperOvr)),
      zone: "wicketkeeper",
    },
    bowler: {
      id: "bowler",
      name: bowlerName,
      role: "Bowler",
      fieldingOvr: Math.max(1, Math.min(100, bowlerOvr)),
      zone: "bowler",
    },
    fielders,
  };
}

// Check coverage of target zones by active 6 fielders
export function resolveInterception(
  setup: FieldingSetup,
  targetZones: string[],
  isEdge: boolean = false,
): InterceptionResult {
  const activeFielders: FielderOnField[] = [setup.keeper, setup.bowler, ...setup.fielders];

  // If this is an outside edge, it passes through the slip cordon / keeper
  if (isEdge) {
    const cordonFielders = activeFielders.filter((f) => SLIP_CORDON_ZONES.has(f.zone));
    if (cordonFielders.length > 0) {
      // Pick best fielder in cordon (deduplicated: no duplicate rolls)
      cordonFielders.sort((a, b) => b.fieldingOvr - a.fieldingOvr);
      return {
        covered: true,
        primaryFielder: cordonFielders[0],
        overlappingFielders: cordonFielders.slice(1),
        isSlipCordon: true,
      };
    }
    // Cordon is open (no slips, keeper missed)
    return {
      covered: false,
      primaryFielder: null,
      overlappingFielders: [],
      isSlipCordon: true,
    };
  }

  // General ground/aerial interception in target zones
  const matching = activeFielders.filter((f) => targetZones.includes(f.zone));
  if (matching.length === 0) {
    return {
      covered: false,
      primaryFielder: null,
      overlappingFielders: [],
      isSlipCordon: false,
    };
  }

  // Deduplicate overlapping fielders: select the highest rated fielder in zone
  matching.sort((a, b) => b.fieldingOvr - a.fieldingOvr);
  return {
    covered: true,
    primaryFielder: matching[0],
    overlappingFielders: matching.slice(1),
    isSlipCordon: false,
  };
}

// Catch probability calculation
// Grounded balls CANNOT be caught. Aerial balls can only be caught if covered.
export function attemptCatch(
  interception: InterceptionResult,
  trajectory: "grounded" | "aerial" | "variable" | "reverse",
  contactQuality: "clean" | "controlled" | "mistimed" | "beaten",
  randomRoll: number = Math.random(), // 0 to 1
): CatchAttemptResult {
  // Grounded shots can NEVER be caught
  if (trajectory === "grounded") {
    return { attempted: false, caught: false, fielder: null, dropReason: "Grounded trajectory cannot be caught" };
  }

  // If no fielder covers the zone, aerial ball lands safely
  if (!interception.covered || !interception.primaryFielder) {
    return { attempted: false, caught: false, fielder: null, dropReason: "No fielder in interception zone" };
  }

  const fielder = interception.primaryFielder;
  // Base catch difficulty depends on contact quality:
  // - mistimed skier: high/slow hanging in air (easy chance)
  // - controlled/clean drive or edge: sharp chance
  let baseCatchProbability = 0.70;
  if (contactQuality === "mistimed") {
    baseCatchProbability = 0.85;
  } else if (contactQuality === "clean") {
    baseCatchProbability = 0.45; // high-velocity lofted stroke towards boundary
  } else if (interception.isSlipCordon) {
    baseCatchProbability = 0.70;
  }

  // Adjust for fielder fielding OVR (normalized 1-100)
  // 99 OVR gives +0.15 boost, 30 OVR gives -0.20 penalty
  const ovrModifier = ((fielder.fieldingOvr - 70) / 100) * 0.4;
  const catchProbability = Math.max(0.15, Math.min(0.96, baseCatchProbability + ovrModifier));

  const caught = randomRoll <= catchProbability;

  return {
    attempted: true,
    caught,
    fielder,
    dropReason: caught ? undefined : "Catch dropped",
  };
}

// Ground stopping calculation for grounded shots
export function attemptGroundStop(
  interception: InterceptionResult,
  contactQuality: "clean" | "controlled" | "mistimed" | "beaten",
  isDeepZone: boolean,
  randomRoll: number = Math.random(),
): GroundStopResult {
  // If no fielder covers zone, ball pierces the infield
  if (!interception.covered || !interception.primaryFielder) {
    // Clean shot to open zone = 4 runs; controlled = 2-3 runs; mistimed = 1-2 runs
    if (contactQuality === "clean") return { stopped: false, fielder: null, runsAllowed: 4 };
    if (contactQuality === "controlled") return { stopped: false, fielder: null, runsAllowed: 2 };
    return { stopped: false, fielder: null, runsAllowed: 1 };
  }

  const fielder = interception.primaryFielder;
  // Fielder is present: stopping chance
  const stopProb = Math.max(0.4, Math.min(0.98, 0.75 + ((fielder.fieldingOvr - 70) / 100) * 0.3));
  const cleanStop = randomRoll <= stopProb;

  if (cleanStop) {
    // Intercepted cleanly: dot or single
    if (contactQuality === "mistimed" || !isDeepZone) {
      return { stopped: true, fielder, runsAllowed: 0 };
    }
    return { stopped: true, fielder, runsAllowed: 1 };
  } else {
    // Misfield / parry
    if (isDeepZone) return { stopped: false, fielder, runsAllowed: contactQuality === "clean" ? 4 : 2 };
    return { stopped: false, fielder, runsAllowed: contactQuality === "clean" ? 2 : 1 };
  }
}
