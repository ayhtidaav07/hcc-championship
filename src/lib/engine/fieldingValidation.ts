import {
  INNER_FIELDING_POSITIONS,
  OUTER_FIELDING_POSITIONS,
  FIELDING_POSITION_NAMES,
  type FieldingZone,
} from "./constants";

export interface FieldValidationResult {
  valid: boolean;
  error?: string;
  innerCount: number;
  outerCount: number;
}

export function isInnerPosition(pos: FieldingZone | string): boolean {
  return INNER_FIELDING_POSITIONS.includes(pos as FieldingZone);
}

export function isOuterPosition(pos: FieldingZone | string): boolean {
  return OUTER_FIELDING_POSITIONS.includes(pos as FieldingZone);
}

/**
 * Validates the 4 movable fielders distribution.
 * Rules:
 * - Exactly 4 distinct positions.
 * - At least 1 inside inner circle.
 * - At least 1 outside inner circle.
 * - No more than 3 outside inner circle.
 * - Valid: 1 in + 3 out, 2 in + 2 out, 3 in + 1 out.
 * - Invalid: all 4 in, all 4 out.
 */
export function validateFieldDistribution(positions: (FieldingZone | string)[]): FieldValidationResult {
  if (positions.length !== 4) {
    return {
      valid: false,
      error: "Must have exactly 4 movable fielders.",
      innerCount: 0,
      outerCount: 0,
    };
  }

  // Check unique positions
  const unique = new Set(positions);
  if (unique.size !== 4) {
    return {
      valid: false,
      error: "Position is already occupied by another fielder.",
      innerCount: 0,
      outerCount: 0,
    };
  }

  let innerCount = 0;
  let outerCount = 0;

  for (const pos of positions) {
    if (isInnerPosition(pos)) {
      innerCount++;
    } else if (isOuterPosition(pos)) {
      outerCount++;
    } else {
      // Legacy fallback
      if (pos === "first_slip" || pos === "second_slip" || pos === "point" || pos === "cover" || pos === "mid_off" || pos === "mid_on" || pos === "midwicket") {
        innerCount++;
      } else {
        outerCount++;
      }
    }
  }

  if (innerCount === 0) {
    return {
      valid: false,
      error: "Keep at least one fielder inside the circle.",
      innerCount,
      outerCount,
    };
  }

  if (outerCount === 0) {
    return {
      valid: false,
      error: "Keep at least one fielder outside the circle.",
      innerCount,
      outerCount,
    };
  }

  if (outerCount > 3) {
    return {
      valid: false,
      error: "No more than 3 fielders may be outside the inner circle.",
      innerCount,
      outerCount,
    };
  }

  return {
    valid: true,
    innerCount,
    outerCount,
  };
}

/**
 * Validates a single move: replacing fielder at index `fielderIndex` with `newZone`.
 */
export function validateFielderMove(
  currentPositions: (FieldingZone | string)[],
  fielderIndex: number,
  newZone: FieldingZone | string,
): FieldValidationResult {
  if (fielderIndex < 0 || fielderIndex >= currentPositions.length) {
    return {
      valid: false,
      error: "Invalid fielder index.",
      innerCount: 0,
      outerCount: 0,
    };
  }

  // Check if target zone already occupied by another fielder
  for (let i = 0; i < currentPositions.length; i++) {
    if (i !== fielderIndex && currentPositions[i] === newZone) {
      const name = FIELDING_POSITION_NAMES[newZone as FieldingZone] ?? newZone;
      return {
        valid: false,
        error: `${name} is already occupied by Fielder ${i + 1}.`,
        innerCount: 0,
        outerCount: 0,
      };
    }
  }

  const hypothetical = [...currentPositions];
  hypothetical[fielderIndex] = newZone;

  return validateFieldDistribution(hypothetical);
}
