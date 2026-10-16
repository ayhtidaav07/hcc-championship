import readline from "node:readline";
import {
  createInitialState,
  startInnings,
  setOpeners,
  setBowler,
  setNewBatter,
  lockInput,
  resolveBall,
} from "../src/lib/gameEngine.ts";
import { TEAMS } from "../src/lib/teams.ts";
import { SHOTS, DELIVERIES } from "../src/lib/engine/constants.ts";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(q: string): Promise<string> {
  return new Promise((res) => rl.question(q, res));
}

async function main() {
  console.clear();
  console.log("=================================================");
  console.log("        HCC CRICKET CHAMPIONSHIP - LIVE MATCH   ");
  console.log("=================================================\n");

  const team1 = TEAMS[0]; // TUXI
  const team2 = TEAMS[1]; // CJ

  console.log(`Match: ${team1.name} vs ${team2.name}`);
  console.log(`You are playing as ${team1.name} (BATTING).`);
  console.log(`Computer is bowling for ${team2.name}.\n`);

  let s = createInitialState("CLI_ROOM");
  s = { ...s, hostTeamId: team1.id, awayTeamId: team2.id, matchStartedAt: Date.now() };
  s = startInnings(s, 1, "host");
  s = setOpeners(s, team1.players[0].name, team1.players[1].name);

  const bowlers = team2.players.filter((p) => p.role !== "Bat" && p.role !== "WK");
  let activeBowlerIdx = 0;
  s = setBowler(s, bowlers[activeBowlerIdx].name);

  while (true) {
    const inn = s.innings[s.currentInnings]!;

    if (inn.closed || inn.allOut || inn.overNumber >= 2) {
      console.log("\n=================================================");
      console.log(`INNINGS CLOSED! Total: ${inn.runs}/${inn.wickets} in ${inn.overNumber}.${inn.ballInOver} overs.`);
      console.log("=================================================");
      break;
    }

    if (s.phase === "select_bowler") {
      activeBowlerIdx = (activeBowlerIdx + 1) % bowlers.length;
      s = setBowler(s, bowlers[activeBowlerIdx].name);
      console.log(`\nNew Over! Bowler is now: ${bowlers[activeBowlerIdx].name}`);
      continue;
    }

    if (s.phase === "select_new_batter") {
      const nextBat = inn.yetToBat[0];
      if (nextBat) {
        console.log(`\nNext batter coming in: ${nextBat}`);
        s = setNewBatter(s, nextBat);
      } else {
        break;
      }
      continue;
    }

    console.log(`\nScore: ${inn.runs}/${inn.wickets} | Over: ${inn.overNumber}.${inn.ballInOver} | Striker: ${inn.striker} | Bowler: ${inn.bowler}`);
    console.log("-------------------------------------------------");
    console.log("Select your shot (0-10):");
    console.log(" 0: Defence (0 runs, safe)     1: Late dab (Behind point)");
    console.log(" 2: Cut (Off side square)       3: Cover drive (Through cover)");
    console.log(" 4: Straight drive (Down ground)5: Flick (Leg side)");
    console.log(" 6: Pull (Midwicket/Square)     7: Sweep (Leg side)");
    console.log(" 8: Loft drive (Straight/Off)   9: Slog (Aggressive aerial)");
    console.log("10: Reverse sweep (Reverse-side placement)");

    const answer = await ask("\nYour Shot [0-10] (or 'q' to quit, Enter for random): ");
    if (answer.trim().toLowerCase() === "q") break;

    let shotNum = parseInt(answer.trim(), 10);
    if (isNaN(shotNum) || shotNum < 0 || shotNum > 10) {
      shotNum = Math.floor(Math.random() * 11);
      console.log(`Auto-selected shot: [${shotNum}] ${SHOTS[shotNum].name}`);
    }

    // Computer picks delivery (1-10)
    const bowlNum = Math.floor(1 + Math.random() * 10);

    s = lockInput(s, "host", shotNum);
    s = lockInput(s, "away", bowlNum);
    s = resolveBall(s);

    const updatedInn = s.innings[s.currentInnings]!;
    const last = updatedInn.balls[updatedInn.balls.length - 1];

    console.log("\n---------------- BALL RESOLUTION ----------------");
    console.log(`Batter: [${last.bat}] ${last.shotName} | Bowler: [${last.bowl}] ${last.deliveryName}`);
    console.log(`Matchup: ${last.compatibility}${last.hasStar ? "★" : ""} | Trajectory: ${last.trajectory} | Quality: ${last.contactQuality}`);

    if (last.isExtra) {
      console.log(`EXTRA: ${last.extraType?.toUpperCase()}! (+${last.runs} run, ball re-bowled)`);
    } else if (last.isWicket) {
      console.log(`WICKET! OUT! Dismissal: ${last.dismissalType?.toUpperCase()}${last.dismissalFielder ? " (Fielder: " + last.dismissalFielder + ")" : ""}`);
    } else {
      console.log(`RUNS SCORED: ${last.runs} run${last.runs === 1 ? "" : "s"}${last.runs >= 4 ? " (BOUNDARY!)" : ""}`);
    }
    console.log("-------------------------------------------------");
  }

  rl.close();
}

main().catch(console.error);
