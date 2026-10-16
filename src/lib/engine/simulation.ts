import { resolveBallDelivery } from "./resolution";
import { DELIVERIES, SHOTS, ALL_FIELDING_ZONES, type FieldingZone } from "./constants";
import { buildFieldingSetup } from "./fielding";

interface SimMetrics {
  totalBalls: number;
  totalLegalBalls: number;
  totalRuns: number;
  totalWickets: number;
  totalDots: number;
  totalFours: number;
  totalSixes: number;
  totalExtras: number;
  byDelivery: Record<
    number,
    {
      balls: number;
      runs: number;
      wickets: number;
      executionFailures: number;
      dots: number;
      boundaries: number;
    }
  >;
  byShot: Record<
    number,
    {
      balls: number;
      runs: number;
      wickets: number;
      dots: number;
      fours: number;
      sixes: number;
    }
  >;
  byOvrBand: Record<
    string,
    {
      balls: number;
      runs: number;
      wickets: number;
      fours: number;
      sixes: number;
    }
  >;
  delivery8Streaks: Record<
    number,
    {
      balls: number;
      runs: number;
      wickets: number;
      wides: number;
      avgExecution: number;
    }
  >;
}

export function runSimulation(numBalls = 10000): SimMetrics {
  const metrics: SimMetrics = {
    totalBalls: 0,
    totalLegalBalls: 0,
    totalRuns: 0,
    totalWickets: 0,
    totalDots: 0,
    totalFours: 0,
    totalSixes: 0,
    totalExtras: 0,
    byDelivery: {},
    byShot: {},
    byOvrBand: {
      "Low Bat vs Low Bowl (40-60 vs 40-60)": { balls: 0, runs: 0, wickets: 0, fours: 0, sixes: 0 },
      "High Bat vs Low Bowl (80-99 vs 40-60)": { balls: 0, runs: 0, wickets: 0, fours: 0, sixes: 0 },
      "Low Bat vs High Bowl (40-60 vs 80-99)": { balls: 0, runs: 0, wickets: 0, fours: 0, sixes: 0 },
      "High Bat vs High Bowl (80-99 vs 80-99)": { balls: 0, runs: 0, wickets: 0, fours: 0, sixes: 0 },
    },
    delivery8Streaks: {
      1: { balls: 0, runs: 0, wickets: 0, wides: 0, avgExecution: 0 },
      2: { balls: 0, runs: 0, wickets: 0, wides: 0, avgExecution: 0 },
      3: { balls: 0, runs: 0, wickets: 0, wides: 0, avgExecution: 0 },
    },
  };

  for (let d = 1; d <= 10; d++) {
    metrics.byDelivery[d] = { balls: 0, runs: 0, wickets: 0, executionFailures: 0, dots: 0, boundaries: 0 };
  }
  for (let s = 0; s <= 10; s++) {
    metrics.byShot[s] = { balls: 0, runs: 0, wickets: 0, dots: 0, fours: 0, sixes: 0 };
  }

  // Pre-generate random field setups
  const sampleFieldZones: FieldingZone[][] = [
    ["first_slip", "cover", "midwicket", "long_on"],
    ["first_slip", "backward_point", "extra_cover", "deep_square_leg"],
    ["cover", "point", "mid_off", "long_off"],
    ["midwicket", "square_leg", "deep_midwicket" as any, "long_on"],
  ];

  let currentStreakBowl8 = 0;

  for (let i = 0; i < numBalls; i++) {
    // Pick batter & bowler OVR bands
    const randType = Math.random();
    let batOvr: number;
    let bowlOvr: number;
    let bandKey: string;

    if (randType < 0.25) {
      batOvr = Math.floor(40 + Math.random() * 20);
      bowlOvr = Math.floor(40 + Math.random() * 20);
      bandKey = "Low Bat vs Low Bowl (40-60 vs 40-60)";
    } else if (randType < 0.5) {
      batOvr = Math.floor(80 + Math.random() * 19);
      bowlOvr = Math.floor(40 + Math.random() * 20);
      bandKey = "High Bat vs Low Bowl (80-99 vs 40-60)";
    } else if (randType < 0.75) {
      batOvr = Math.floor(40 + Math.random() * 20);
      bowlOvr = Math.floor(80 + Math.random() * 19);
      bandKey = "Low Bat vs High Bowl (40-60 vs 80-99)";
    } else {
      batOvr = Math.floor(80 + Math.random() * 19);
      bowlOvr = Math.floor(80 + Math.random() * 19);
      bandKey = "High Bat vs High Bowl (80-99 vs 80-99)";
    }

    // Pick shot and delivery
    // 10% chance of shot 0, remaining distributed across 1-10
    const bat = Math.random() < 0.08 ? 0 : Math.floor(1 + Math.random() * 10);
    // 20% chance of testing streak 8 consecutive balls
    let bowl: number;
    if (Math.random() < 0.25 && currentStreakBowl8 < 4) {
      bowl = 8;
    } else {
      bowl = Math.floor(1 + Math.random() * 10);
      if (bowl !== 8) currentStreakBowl8 = 0;
    }

    const fieldSetup = buildFieldingSetup(
      "Bowler",
      bowlOvr,
      "Keeper",
      75,
      sampleFieldZones[i % sampleFieldZones.length],
    );

    const res = resolveBallDelivery({
      bat,
      bowl,
      strikerName: "Batter",
      bowlerName: "Bowler",
      batterOvr: batOvr,
      bowlerOvr: bowlOvr,
      bowlerStreakCount: currentStreakBowl8,
      fieldingSetup: fieldSetup,
    });

    if (bowl === 8) {
      currentStreakBowl8 = res.newStreakCount;
      const streakBucket = Math.min(3, currentStreakBowl8);
      const sMet = metrics.delivery8Streaks[streakBucket];
      if (sMet) {
        sMet.balls += 1;
        sMet.runs += res.runs;
        if (res.isWicket) sMet.wickets += 1;
        if (res.isExtra && res.extraType === "wide") sMet.wides += 1;
        sMet.avgExecution += res.bowlingExecution;
      }
    } else {
      currentStreakBowl8 = 0;
    }

    metrics.totalBalls++;
    if (res.isLegalBall) metrics.totalLegalBalls++;
    metrics.totalRuns += res.runs;
    if (res.isWicket) metrics.totalWickets++;
    if (res.runs === 0 && res.isLegalBall) metrics.totalDots++;
    if (res.isFour) metrics.totalFours++;
    if (res.isSix) metrics.totalSixes++;
    if (res.isExtra) metrics.totalExtras++;

    // By delivery
    const dMet = metrics.byDelivery[bowl];
    dMet.balls++;
    dMet.runs += res.runs;
    if (res.isWicket) dMet.wickets++;
    if (res.bowlingExecution < 40) dMet.executionFailures++;
    if (res.runs === 0 && res.isLegalBall) dMet.dots++;
    if (res.isBoundary) dMet.boundaries++;

    // By shot
    const sMet = metrics.byShot[bat];
    sMet.balls++;
    if (!res.isExtra) {
      sMet.runs += res.runs;
    }
    if (res.isWicket) sMet.wickets++;
    if (res.runs === 0) sMet.dots++;
    if (res.isFour) sMet.fours++;
    if (res.isSix) sMet.sixes++;

    // By OVR band
    const bMet = metrics.byOvrBand[bandKey];
    bMet.balls++;
    bMet.runs += res.runs;
    if (res.isWicket) bMet.wickets++;
    if (res.isFour) bMet.fours++;
    if (res.isSix) bMet.sixes++;
  }

  // Normalize avgExecution for streak buckets
  for (let k = 1; k <= 3; k++) {
    const s = metrics.delivery8Streaks[k];
    if (s.balls > 0) s.avgExecution = Math.round(s.avgExecution / s.balls);
  }

  return metrics;
}

// Print formatted simulation summary report
export function formatSimulationReport(m: SimMetrics): string {
  const avgRunsPerBall = (m.totalRuns / m.totalLegalBalls).toFixed(2);
  const avgRunsPerOver = ((m.totalRuns / m.totalLegalBalls) * 6).toFixed(2);
  const overallWicketPct = ((m.totalWickets / m.totalBalls) * 100).toFixed(1);
  const overallDotPct = ((m.totalDots / m.totalLegalBalls) * 100).toFixed(1);
  const overallBoundaryPct = (((m.totalFours + m.totalSixes) / m.totalLegalBalls) * 100).toFixed(1);

  let out = "";
  out += `========================================================================\n`;
  out += `          HCC GAME ENGINE — BATCH SIMULATION REPORT (${m.totalBalls.toLocaleString()} BALLS)\n`;
  out += `========================================================================\n\n`;

  out += `[1] OVERALL ENGINE METRICS\n`;
  out += `------------------------------------------------------------------------\n`;
  out += `Total Deliveries:       ${m.totalBalls.toLocaleString()}\n`;
  out += `Legal Balls:            ${m.totalLegalBalls.toLocaleString()} (${((m.totalLegalBalls / m.totalBalls) * 100).toFixed(1)}%)\n`;
  out += `Total Runs:             ${m.totalRuns.toLocaleString()}\n`;
  out += `Average Runs / Ball:    ${avgRunsPerBall}\n`;
  out += `Average Runs / Over:    ${avgRunsPerOver}\n`;
  out += `Total Wickets:          ${m.totalWickets} (${overallWicketPct}% wicket rate)\n`;
  out += `Dot Ball Rate:          ${overallDotPct}%\n`;
  out += `Fours:                  ${m.totalFours.toLocaleString()} (${((m.totalFours / m.totalLegalBalls) * 100).toFixed(1)}%)\n`;
  out += `Sixes:                  ${m.totalSixes.toLocaleString()} (${((m.totalSixes / m.totalLegalBalls) * 100).toFixed(1)}%)\n`;
  out += `Boundary Frequency:     ${overallBoundaryPct}% of legal balls\n`;
  out += `Extras (Wides/No-balls):${m.totalExtras} (${((m.totalExtras / m.totalBalls) * 100).toFixed(1)}%)\n\n`;

  out += `[2] DELIVERY EFFECTIVENESS & WICKET / FAILURE RATES\n`;
  out += `------------------------------------------------------------------------\n`;
  out += `Del | Name                         | Balls  | Runs/B | Wkt % | Fail % | Boundary %\n`;
  out += `----+------------------------------+--------+--------+-------+--------+-----------\n`;
  for (let d = 1; d <= 10; d++) {
    const dm = m.byDelivery[d];
    const name = DELIVERIES[d].name.padEnd(28, " ");
    const rpb = (dm.runs / dm.balls).toFixed(2);
    const wktPct = ((dm.wickets / dm.balls) * 100).toFixed(1) + "%";
    const failPct = ((dm.executionFailures / dm.balls) * 100).toFixed(1) + "%";
    const bndPct = ((dm.boundaries / dm.balls) * 100).toFixed(1) + "%";
    out += ` ${String(d).padStart(2)} | ${name} | ${String(dm.balls).padStart(6)} | ${rpb.padStart(6)} | ${wktPct.padStart(5)} | ${failPct.padStart(6)} | ${bndPct.padStart(9)}\n`;
  }
  out += `\n`;

  out += `[3] SHOT SCORING & BOUNDARY RATES\n`;
  out += `------------------------------------------------------------------------\n`;
  out += `Shot| Name             | Trajectory | Balls  | Runs/B | Out % | Fours | Sixes | Bnd %\n`;
  out += `----+------------------+------------+--------+--------+-------+-------+-------+------\n`;
  for (let s = 0; s <= 10; s++) {
    const sm = m.byShot[s];
    const cfg = SHOTS[s];
    const name = cfg.name.padEnd(16, " ");
    const traj = cfg.defaultTrajectory.padEnd(10, " ");
    const rpb = (sm.runs / sm.balls).toFixed(2);
    const outPct = ((sm.wickets / sm.balls) * 100).toFixed(1) + "%";
    const bndPct = (((sm.fours + sm.sixes) / sm.balls) * 100).toFixed(1) + "%";
    out += ` ${String(s).padStart(2)} | ${name} | ${traj} | ${String(sm.balls).padStart(6)} | ${rpb.padStart(6)} | ${outPct.padStart(5)} | ${String(sm.fours).padStart(5)} | ${String(sm.sixes).padStart(5)} | ${bndPct.padStart(5)}\n`;
  }
  out += `\n`;

  out += `[4] DELIVERY 8 CONSECUTIVE REPETITION STREAK BALANCE\n`;
  out += `------------------------------------------------------------------------\n`;
  out += `Streak Use | Balls  | Avg Bowler Exec | Wide % | Wicket % | Runs / Ball\n`;
  out += `-----------+--------+-----------------+--------+----------+-------------\n`;
  for (let k = 1; k <= 3; k++) {
    const s = m.delivery8Streaks[k];
    const label = k === 3 ? "3rd+ consec" : k === 2 ? "2nd consec " : "1st use    ";
    const widePct = s.balls > 0 ? ((s.wides / s.balls) * 100).toFixed(1) + "%" : "0.0%";
    const wktPct = s.balls > 0 ? ((s.wickets / s.balls) * 100).toFixed(1) + "%" : "0.0%";
    const rpb = s.balls > 0 ? (s.runs / s.balls).toFixed(2) : "0.00";
    out += ` ${label} | ${String(s.balls).padStart(6)} | ${String(s.avgExecution).padStart(15)} | ${widePct.padStart(6)} | ${wktPct.padStart(8)} | ${rpb.padStart(11)}\n`;
  }
  out += `\n`;

  out += `[5] OVR BAND MATRICES (BATTING VS BOWLING)\n`;
  out += `------------------------------------------------------------------------\n`;
  for (const [band, bm] of Object.entries(m.byOvrBand)) {
    const rpb = (bm.runs / bm.balls).toFixed(2);
    const wktPct = ((bm.wickets / bm.balls) * 100).toFixed(1);
    const bndPct = (((bm.fours + bm.sixes) / bm.balls) * 100).toFixed(1);
    out += `${band.padEnd(42, " ")}: ${rpb} RPO, ${wktPct}% Wkt, ${bndPct}% Bnd (${bm.balls.toLocaleString()} balls)\n`;
  }
  out += `========================================================================\n`;

  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const metrics = runSimulation(15000);
  console.log(formatSimulationReport(metrics));
}
