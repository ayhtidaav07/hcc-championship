import { describe, it, expect } from "vitest";
import {
  validateFieldDistribution,
  validateFielderMove,
} from "./fieldingValidation";

describe("Fielding Distribution Validation", () => {
  it("allows 1 inside, 3 outside", () => {
    // cover (inner), long_off, long_on, deep_midwicket (outer)
    const res = validateFieldDistribution(["cover", "long_off", "long_on", "deep_midwicket"]);
    if (!res.valid) throw new Error(`Expected valid but got: ${res.error}`);
    if (res.innerCount !== 1 || res.outerCount !== 3) throw new Error("Incorrect counts");
  });

  it("allows 2 inside, 2 outside", () => {
    // cover, mid_on (inner), long_off, deep_midwicket (outer)
    const res = validateFieldDistribution(["cover", "mid_on", "long_off", "deep_midwicket"]);
    if (!res.valid) throw new Error(`Expected valid but got: ${res.error}`);
    if (res.innerCount !== 2 || res.outerCount !== 2) throw new Error("Incorrect counts");
  });

  it("allows 3 inside, 1 outside", () => {
    // point, cover, mid_off (inner), long_on (outer)
    const res = validateFieldDistribution(["point", "cover", "mid_off", "long_on"]);
    if (!res.valid) throw new Error(`Expected valid but got: ${res.error}`);
    if (res.innerCount !== 3 || res.outerCount !== 1) throw new Error("Incorrect counts");
  });

  it("rejects 4 inside, 0 outside", () => {
    const res = validateFieldDistribution(["point", "cover", "mid_off", "mid_on"]);
    if (res.valid) throw new Error("Expected invalid for 4 inside");
    if (!res.error?.includes("outside the circle")) throw new Error(`Wrong error: ${res.error}`);
  });

  it("rejects 0 inside, 4 outside", () => {
    const res = validateFieldDistribution(["deep_third_man", "deep_cover", "long_off", "long_on"]);
    if (res.valid) throw new Error("Expected invalid for 4 outside");
    if (!res.error?.includes("inside the circle")) throw new Error(`Wrong error: ${res.error}`);
  });

  it("rejects duplicate positions", () => {
    const res = validateFieldDistribution(["cover", "cover", "long_off", "long_on"]);
    if (res.valid) throw new Error("Expected invalid for duplicate");
    if (!res.error?.includes("occupied")) throw new Error(`Wrong error: ${res.error}`);
  });

  it("validates fielder move", () => {
    const current = ["cover", "mid_on", "long_off", "deep_midwicket"];
    // Moving fielder 0 (cover) to point (another inner) -> valid 2 in, 2 out
    const move1 = validateFielderMove(current, 0, "point");
    if (!move1.valid) throw new Error(`Expected valid move but got: ${move1.error}`);

    // Moving fielder 0 (cover) to deep_cover (outer) -> 1 in, 3 out -> valid!
    const move2 = validateFielderMove(current, 0, "deep_cover");
    if (!move2.valid) throw new Error(`Expected valid move but got: ${move2.error}`);

    // Moving fielder 1 (mid_on, the only remaining inner in move2 state) to fine_leg -> 0 in, 4 out -> invalid!
    const move3 = validateFielderMove(["deep_cover", "mid_on", "long_off", "deep_midwicket"], 1, "fine_leg");
    if (move3.valid) throw new Error("Expected invalid move creating 0 in, 4 out");

    // Moving to already occupied position
    const move4 = validateFielderMove(current, 0, "long_off");
    if (move4.valid) throw new Error("Expected invalid move to occupied slot");
  });
});
