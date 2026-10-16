import { createFileRoute, useParams } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { TEAMS, PRACTICE_AWAY_ID, PRACTICE_HOME_ID, getTeam, getEligibleBatters, getEligibleBowlers } from "@/lib/teams";
import {
  createInitialState,
  setOpeners,
  setBowler,
  setNewBatter,
  lockInput,
  resolveBall,
  startInnings,
  startNextInnings,
  declareInnings,
  matchElapsedMs,
  formatClock,
  addThinkTime,
  OVERS_PER_INNINGS,
  totalsBySide,
  leadTrailLabel,
  finalizeResult,
  teamForSide,
  computeTarget,
  zerosUsedThisOver,
} from "@/lib/gameEngine";
import type { GameState, Side, BatStats, BowlStats } from "@/lib/gameTypes";
import { PHASE_OF_OVER } from "@/lib/gameTypes";
import { joinRoom, leaveRoom, type RoomEvent } from "@/lib/realtime";
import { loadSide, loadState, saveSide, saveState } from "@/lib/storage";
import { extractBallEvents, extractInnings, matchIdFor } from "@/lib/matchEvents";
import { recordMatchProgress } from "@/lib/matchRecord.functions";


export const Route = createFileRoute("/room/$code")({
  component: Room,
});

// ─── Design tokens ───────────────────────────────────────────────────────────
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

const MAX_CHAT_LEN = 200;
const MAX_CHAT_HISTORY = 50;

// ─── Local ball clock ────────────────────────────────────────────────────────
let lbKey: string | null = null;
let lbStart: number | null = null;
let lbPausedAt: number | null = null;

function syncLocalBallClock(s: GameState | null) {
  if (!s || s.phase !== "playing" || !s.ballStartedAt) {
    lbKey = null; lbStart = null; lbPausedAt = null; return;
  }
  const inn = s.innings[s.currentInnings];
  const key = `${s.currentInnings}:${inn?.ballsBowled ?? 0}:${s.ballStartedAt}`;
  if (key !== lbKey) { lbKey = key; lbStart = Date.now(); lbPausedAt = null; }
  if (s.paused) { if (lbPausedAt === null) lbPausedAt = Date.now(); }
  else if (lbPausedAt !== null) {
    if (lbStart !== null) lbStart += Date.now() - lbPausedAt;
    lbPausedAt = null;
  }
}
function localBallElapsed(): number | null {
  if (lbStart === null) return null;
  const now = lbPausedAt ?? Date.now();
  return Math.max(0, now - lbStart);
}

// ─── Root component ──────────────────────────────────────────────────────────
function Room() {
  const { code } = useParams({ from: "/room/$code" });
  const [side, setSide] = useState<Side | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const sendRef = useRef<((e: RoomEvent) => void) | null>(null);
  const sideRef = useRef<Side | null>(null);
  const myClientIdRef = useRef<string>(Math.random().toString(36).slice(2) + Date.now().toString(36));
  const peerClientIdRef = useRef<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const ident = loadSide(code);
    const cached = loadState(code);
    const resolvedSide: Side = ident.side ?? cached?.side ?? "away";
    const resolvedTeam =
      ident.teamId ??
      (cached ? (resolvedSide === "host" ? cached.state.hostTeamId : cached.state.awayTeamId) : null) ??
      (resolvedSide === "away" ? PRACTICE_AWAY_ID : PRACTICE_HOME_ID);
    setSide(resolvedSide);
    sideRef.current = resolvedSide;
    setTeamId(resolvedTeam);
    saveSide(code, resolvedSide, resolvedTeam);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      setState(cached.state); stateRef.current = cached.state;
    } else if (resolvedSide === "host" && !cached) {
      const init = createInitialState(code);
      init.hostTeamId = resolvedTeam;
      setState(init); stateRef.current = init;
    } else if (cached && resolvedSide === "host") {
      setState(cached.state); stateRef.current = cached.state;
    }
  }, [code]);

  useEffect(() => {
    if (!side) return;
    let chan: any = null;
    const pendingLeave: Record<string, ReturnType<typeof setTimeout>> = {};
    const peerStillPresent = (peerSide: Side) => {
      try {
        const st = chan?.presenceState?.() ?? {};
        return Object.values(st).some((arr: any) =>
          (arr as any[]).some((p) => p?.side === peerSide && p?.clientId !== myClientIdRef.current),
        );
      } catch { return false; }
    };
    const { channel, send: rawSend } = joinRoom(
      code, handleEvent,
      { side: sideRef.current!, clientId: myClientIdRef.current },
      {
        onJoin: ({ side: peerSide, clientId }) => {
          if (peerSide === sideRef.current) return;
          peerClientIdRef.current = clientId;
          if (pendingLeave[peerSide]) { clearTimeout(pendingLeave[peerSide]); delete pendingLeave[peerSide]; }
          if (sideRef.current === "host") {
            const cur = stateRef.current;
            if (cur && cur.paused && cur.pausedReason === "disconnect" && cur.disconnectedSide === peerSide) {
              const elapsed = cur.pausedAt ? Date.now() - cur.pausedAt : 0;
              applyAndBroadcast({ ...cur, paused: false, pausedAt: null, pausedReason: undefined, disconnectedSide: null, pausedTotalMs: (cur.pausedTotalMs ?? 0) + elapsed, lastActionAt: Date.now() + 5000, hostConnected: true, awayConnected: true });
            } else if (cur) {
              applyAndBroadcast({ ...cur, hostConnected: true, awayConnected: true });
            }
          }
        },
        onLeave: ({ side: peerSide }) => {
          if (peerSide === sideRef.current) return;
          if (sideRef.current !== "host") return;
          if (pendingLeave[peerSide]) return;
          pendingLeave[peerSide] = setTimeout(() => {
            delete pendingLeave[peerSide];
            if (peerStillPresent(peerSide)) return;
            const cur = stateRef.current;
            if (!cur) return;
            if (cur.phase === "lobby" || cur.phase === "match_over") return;
            if (cur.paused) return;
            applyAndBroadcast({ ...cur, paused: true, pausedAt: Date.now(), pausedReason: "disconnect", disconnectedSide: peerSide, awayConnected: peerSide === "away" ? false : cur.awayConnected, hostConnected: peerSide === "host" ? false : cur.hostConnected });
          }, 15000);
        },
      },
    );
    chan = channel;
    const send = (e: RoomEvent) => rawSend({ ...e, _from: myClientIdRef.current } as RoomEvent);
    sendRef.current = send;
    setTimeout(() => send({ type: "hello", side: sideRef.current!, clientId: myClientIdRef.current, teamId }), 300);
    const hb = setInterval(() => { try { channel.track({ side: sideRef.current!, clientId: myClientIdRef.current }); } catch {} }, 20000);
    return () => { clearInterval(hb); Object.values(pendingLeave).forEach(clearTimeout); leaveRoom(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, code]);

  useEffect(() => {
    if (state) saveState(code, state, sideRef.current);
    stateRef.current = state;
  }, [state, code]);

  const syncedRef = useRef<{ ids: Set<string>; sig: string; busy: boolean; again: boolean }>({ ids: new Set(), sig: "", busy: false, again: false });
  useEffect(() => {
    if (side !== "host" || !state || !state.hostTeamId || !state.awayTeamId) return;
    const matchId = matchIdFor(state);
    if (!matchId) return;
    const run = async () => {
      const s = stateRef.current;
      if (!s) return;
      const sync = syncedRef.current;
      if (sync.busy) { sync.again = true; return; }
      const events = extractBallEvents(s).filter((e) => !sync.ids.has(e.id));
      const final = s.phase === "match_over";
      const innings = extractInnings(s);
      const sig = `${matchId}|${JSON.stringify(innings)}|${final}|${s.tossWinner ?? ""}`;
      if (!events.length && sig === sync.sig) return;
      sync.busy = true;
      try {
        await recordMatchProgress({ data: { matchId, roomCode: s.roomCode, hostTeamId: s.hostTeamId!, awayTeamId: s.awayTeamId!, tossWinner: s.tossWinner, tossChoice: s.tossChoice, innings, events, final: final ? { winner: s.winner, result: s.result } : undefined } });
        events.forEach((e) => sync.ids.add(e.id));
        sync.sig = sig;
      } catch (err) {
        console.warn("[match-record] save failed, will retry", err);
      } finally {
        sync.busy = false;
        if (sync.again) { sync.again = false; void run(); }
      }
    };
    void run();
  }, [state, side]);

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s || s.phase === "match_over" || s.phase === "lobby") { force((n) => n + 1); return; }
      if (sideRef.current === "host") {
        if (s.paused && s.pausedReason === "disconnect" && s.pausedAt && Date.now() - s.pausedAt > 5 * 60 * 1000) {
          const winnerSide: Side = s.disconnectedSide === "host" ? "away" : "host";
          const winnerName = teamForSide(s, winnerSide)?.name ?? winnerSide;
          applyAndBroadcast({ ...s, phase: "match_over", paused: false, pausedReason: undefined, result: `${winnerName} wins — opponent did not return within 5 minutes`, winner: winnerSide });
          return;
        }
        if (!s.paused && (s.phase === "playing" || s.phase === "select_bowler" || s.phase === "select_new_batter") && Date.now() - s.lastActionAt > 60_000) {
          applyAndBroadcast({ ...s, paused: true, pausedAt: Date.now(), pausedReason: "idle" });
          return;
        }
      }
      force((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [side]);

  function broadcastState(s: GameState) { sendRef.current?.({ type: "state", state: s }); }
  function applyAndBroadcast(s: GameState) {
    const next = { ...s, version: s.version + 1 };
    setState(next); stateRef.current = next; broadcastState(next);
  }

  function handleEvent(e: RoomEvent) {
    const mySide = sideRef.current!;
    const cur = stateRef.current;
    const senderId = (e as any)._from as string | undefined;
    if (e.type === "state") {
      if (mySide === "host") return;
      if (!senderId) return;
      if (peerClientIdRef.current && senderId !== peerClientIdRef.current) return;
      if (!peerClientIdRef.current) peerClientIdRef.current = senderId;
      const incoming = e.state as GameState;
      if (!cur || incoming.version >= cur.version) { setState(incoming); stateRef.current = incoming; }
      return;
    }
    if (e.type === "hello") {
      if (e.side !== mySide && senderId) peerClientIdRef.current = senderId;
      if (mySide === "host" && e.side === "away") {
        let s = cur ?? createInitialState(code);
        s = { ...s, awayTeamId: e.teamId ?? s.awayTeamId, awayConnected: true, hostConnected: true };
        if (s.hostTeamId && s.awayTeamId && s.phase === "lobby") s = { ...s, phase: "toss" };
        if (s.paused && s.pausedReason === "disconnect" && s.disconnectedSide === "away") {
          const elapsed = s.pausedAt ? Date.now() - s.pausedAt : 0;
          s = { ...s, paused: false, pausedAt: null, pausedReason: undefined, disconnectedSide: null, pausedTotalMs: (s.pausedTotalMs ?? 0) + elapsed, lastActionAt: Date.now() + 5000 };
        }
        applyAndBroadcast(s);
      }
      return;
    }
    if (mySide !== "host" || !cur) return;
    const senderSide: Side | null = senderId
      ? senderId === myClientIdRef.current ? "host"
        : peerClientIdRef.current && senderId === peerClientIdRef.current ? "away" : null
      : null;
    switch (e.type) {
      case "toss_call": {
        const result: "heads" | "tails" = Math.random() < 0.5 ? "heads" : "tails";
        const winner: Side = e.call === result ? "away" : "host";
        applyAndBroadcast({ ...cur, tossCall: e.call, tossResult: result, tossWinner: winner });
        return;
      }
      case "toss_choice": {
        const battingSide: Side = e.choice === "bat" ? cur.tossWinner! : cur.tossWinner === "host" ? "away" : "host";
        applyAndBroadcast(startInnings({ ...cur, tossChoice: e.choice }, 1, battingSide));
        return;
      }
      case "select": {
        if (e.kind === "openers") applyAndBroadcast(setOpeners(cur, e.payload.striker, e.payload.nonStriker));
        else if (e.kind === "bowler") applyAndBroadcast(setBowler(cur, e.payload.bowler));
        else if (e.kind === "batter") applyAndBroadcast(setNewBatter(cur, e.payload.batter));
        return;
      }
      case "input": {
        const actualSide: Side | null = senderSide ?? (e.side === "host" || e.side === "away" ? e.side : null);
        if (!actualSide) return;
        if (senderSide && senderSide !== e.side) return;
        let working = cur;
        const reported = typeof (e as any).elapsedMs === "number" && isFinite((e as any).elapsedMs)
          ? Math.max(0, Math.min(10 * 60_000, (e as any).elapsedMs as number)) : null;
        if (working.phase === "playing" && working.ballStartedAt && !working.paused) {
          const alreadyLocked = actualSide === "host" ? working.hostLocked : working.awayLocked;
          const elapsed = reported ?? Date.now() - working.ballStartedAt;
          const innC = working.innings[working.currentInnings];
          const isBatting = innC && actualSide === innC.battingSide;
          const player = innC ? (isBatting ? innC.striker : innC.bowler) ?? "?" : "?";
          if (!alreadyLocked) working = addThinkTime(working, actualSide, player !== "?" ? player : null, elapsed);
        }
        let s = lockInput(working, actualSide, e.value);
        if (s.hostLocked && s.awayLocked) s = resolveBall(s);
        applyAndBroadcast(s);
        return;
      }
      case "follow_on": {
        const teamBSide = cur.innings[2]!.battingSide;
        applyAndBroadcast(startInnings({ ...cur, followOnOffered: true }, 3, teamBSide));
        return;
      }
      case "next_innings_choice": { applyAndBroadcast(startNextInnings(cur, e.battingSide)); return; }
      case "declare": { applyAndBroadcast(declareInnings(cur)); return; }
      case "chat": {
        const fromSide: Side | null = senderSide ?? (e.side === "host" || e.side === "away" ? e.side : null);
        if (!fromSide) return;
        if (senderSide && senderSide !== e.side) return;
        const text = typeof e.text === "string" ? e.text.slice(0, MAX_CHAT_LEN).trim() : "";
        if (!text) return;
        const nextChat = [...cur.chat, { side: fromSide, text, t: Date.now() }];
        if (nextChat.length > MAX_CHAT_HISTORY) nextChat.splice(0, nextChat.length - MAX_CHAT_HISTORY);
        applyAndBroadcast({ ...cur, chat: nextChat });
        return;
      }
      case "pause": { if (cur.paused) return; applyAndBroadcast({ ...cur, paused: true, pausedAt: Date.now(), pausedReason: "manual" }); return; }
      case "resume": {
        if (!cur.paused) return;
        if (cur.pausedReason === "disconnect") return;
        const elapsed = cur.pausedAt ? Date.now() - cur.pausedAt : 0;
        applyAndBroadcast({ ...cur, paused: false, pausedAt: null, pausedReason: undefined, pausedTotalMs: (cur.pausedTotalMs ?? 0) + elapsed, ballStartedAt: cur.ballStartedAt ? cur.ballStartedAt + elapsed : cur.ballStartedAt, lastActionAt: Date.now() + 5000 });
        return;
      }
    }
  }

  if (!side) return <Loading text="Loading…" />;
  if (!state) return <Loading text={`Joining room ${code}…`} sub="Waiting for host to send game state." />;

  return (
    <RoomUI
      code={code}
      mySide={side}
      myTeamId={teamId}
      state={state}
      send={(e) => {
        if (sideRef.current === "host") { handleEvent({ ...e, _from: myClientIdRef.current } as RoomEvent); return; }
        sendRef.current?.(e);
      }}
      onTeamPick={(id) => {
        setTeamId(id);
        saveSide(code, side, id);
        if (side === "host") { applyAndBroadcast({ ...state, hostTeamId: id }); }
        else { sendRef.current?.({ type: "hello", side: "away", clientId: "x", teamId: id }); }
      }}
    />
  );
}

// ─── Loading ─────────────────────────────────────────────────────────────────
function Loading({ text, sub }: { text: string; sub?: string }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg }} className="flex flex-col items-center justify-center text-white">
      <div className="text-xl font-bold">{text}</div>
      {sub && <div className="text-sm mt-2" style={{ color: C.textMuted }}>{sub}</div>}
    </div>
  );
}

// ─── RoomUI dispatcher ────────────────────────────────────────────────────────
function RoomUI({ code, mySide, myTeamId: _myTeamId, state, send, onTeamPick }: {
  code: string; mySide: Side; myTeamId: string | null;
  state: GameState; send: (e: RoomEvent) => void; onTeamPick: (id: string) => void;
}) {
  const hostTeam = state.hostTeamId ? getTeam(state.hostTeamId) : null;
  const awayTeam = state.awayTeamId ? getTeam(state.awayTeamId) : null;
  syncLocalBallClock(state);

  if (state.phase === "lobby") {
    if (mySide === "away" && !state.awayTeamId) {
      return (
        <div style={{ minHeight: "100vh", background: C.bg }} className="flex flex-col text-white p-6">
          <div className="max-w-2xl mx-auto w-full">
            <div className="mb-8 text-center">
              <div className="text-3xl font-black mb-1" style={{ color: C.cyan }}>HCC</div>
              <h2 className="text-xl font-bold mb-1">Join Room <span style={{ color: C.amber }}>{code}</span></h2>
              <p style={{ color: C.textMuted }} className="text-sm">Pick your team to join the match</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {TEAMS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTeamPick(t.id)}
                  className="rounded-2xl p-4 border-2 transition-all hover:scale-105 active:scale-95"
                  style={{ background: `linear-gradient(135deg, ${t.color}99, ${t.accent}99)`, borderColor: t.accent }}
                >
                  <div className="font-black text-lg">{t.id}</div>
                  <div className="text-xs opacity-70 mt-1">{t.name}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div style={{ minHeight: "100vh", background: C.bg }} className="flex flex-col items-center justify-center text-white">
        <div className="text-4xl mb-2">🏏</div>
        <div className="text-xs mb-1" style={{ color: C.textMuted }}>Room Code</div>
        <div className="text-6xl font-black tracking-widest mb-1" style={{ color: C.cyan }}>{code}</div>
        <div className="text-sm mb-4" style={{ color: C.textMuted }}>Share this link with your opponent</div>
        <code className="text-xs px-4 py-2 rounded-lg mb-8" style={{ background: C.card, color: C.amber }}>
          {typeof window !== "undefined" ? window.location.href : ""}
        </code>
        <div className="rounded-2xl p-4 text-center" style={{ background: C.card, minWidth: 280 }}>
          <div className="text-sm mb-2" style={{ color: C.textMuted }}>Match Setup</div>
          <div className="font-bold">{hostTeam?.name ?? "—"} <span style={{ color: C.textMuted }}>vs</span> {awayTeam?.name ?? <span style={{ color: C.amber }}>Waiting for away…</span>}</div>
        </div>
      </div>
    );
  }

  if (state.phase === "toss") return <TossView state={state} mySide={mySide} send={send} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg }} className="flex flex-col text-white">
      <TopBar state={state} mySide={mySide} code={code} send={send} />
      {state.paused && <PauseOverlay state={state} mySide={mySide} send={send} />}
      <main className="flex-1 overflow-y-auto">
        {state.phase === "match_over" ? (
          <Scorecard state={state} code={code} isHost={mySide === "host"} />
        ) : state.phase === "innings_break" ? (
          <InningsBreak state={state} mySide={mySide} send={send} />
        ) : state.phase === "follow_on_decision" ? (
          <FollowOnDecision state={state} mySide={mySide} send={send} />
        ) : (
          <GameBoard state={state} mySide={mySide} send={send} />
        )}
      </main>
      <ChatBox state={state} mySide={mySide} send={send} />
    </div>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({ state, mySide, code, send }: { state: GameState; mySide: Side; code: string; send: (e: RoomEvent) => void }) {
  const hostTeam = getTeam(state.hostTeamId!);
  const awayTeam = getTeam(state.awayTeamId!);
  const inn = state.currentInnings > 0 ? state.innings[state.currentInnings] : null;
  const t = totalsBySide(state);
  const myLockedNow = mySide === "host" ? state.hostLocked : state.awayLocked;
  const liveBall = state.phase === "playing" && !state.paused && !myLockedNow ? localBallElapsed() ?? 0 : 0;
  const myThink = (state.thinkMs?.[mySide] ?? 0) + liveBall;
  const phase = inn ? PHASE_OF_OVER(inn.overNumber) : "—";
  const canPause = state.phase !== "lobby" && state.phase !== "toss" && state.phase !== "match_over";

  return (
    <header className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm" style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
      <div className="font-black text-base" style={{ color: C.cyan }}>HCC</div>
      <div className="font-bold">{hostTeam?.name} <span style={{ color: C.textMuted }}>vs</span> {awayTeam?.name}</div>
      <div className="px-2 py-0.5 rounded text-xs" style={{ background: "rgba(255,255,255,0.06)", color: C.textMuted }}>#{code}</div>
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          You: {mySide === "host" ? hostTeam?.name : awayTeam?.name}
        </span>
        <span className="px-2 py-0.5 rounded text-xs font-semibold"
          style={{ background: phase === "CRAZY" ? "rgba(167,139,250,0.15)" : "rgba(57,198,230,0.1)", color: phase === "CRAZY" ? C.violet : C.cyan }}>
          Inn {state.currentInnings || "—"} · {phase}
        </span>
        {inn && (
          <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)" }}>
            {inn.overNumber}.{inn.ballInOver} / {OVERS_PER_INNINGS} ov
          </span>
        )}
        <span className="font-semibold text-xs px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)" }}>
          {hostTeam?.id} <span style={{ color: C.cyan }}>{t.host}</span>
          <span style={{ color: C.textMuted }}> – </span>
          {awayTeam?.id} <span style={{ color: C.amber }}>{t.away}</span>
        </span>
        {state.currentInnings === 4 && inn && (() => {
          const tgt = computeTarget(state);
          if (tgt === null) return null;
          const need = tgt - inn.runs;
          return <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "rgba(57,198,230,0.15)", color: C.cyan }}>Target {tgt} · Need {need}</span>;
        })()}
        {state.paused && <span className="text-xs" style={{ color: C.amber }}>⏸ paused</span>}
        <span className="font-mono text-xs" style={{ color: C.textMuted }}>🧠 {formatClock(myThink)}</span>
        {canPause && !state.paused && (
          <button onClick={() => send({ type: "pause" })} className="px-2 py-0.5 rounded text-xs"
            style={{ background: "rgba(255,180,84,0.12)", color: C.amber }}>⏸ Pause</button>
        )}
      </div>
    </header>
  );
}

// ─── Toss ─────────────────────────────────────────────────────────────────────
function TossView({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const [flipping, setFlipping] = useState(false);
  const hostTeam = getTeam(state.hostTeamId!);
  const awayTeam = getTeam(state.awayTeamId!);
  useEffect(() => { if (state.tossResult && !flipping) setFlipping(true); }, [state.tossResult, flipping]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg }} className="flex flex-col items-center justify-center text-white p-6">
      <div className="text-4xl mb-2">🪙</div>
      <h2 className="text-3xl font-black mb-1">The Toss</h2>
      <p className="text-sm mb-10" style={{ color: C.textMuted }}>
        <span style={{ color: C.amber }}>{awayTeam?.name}</span> calls · <span style={{ color: C.cyan }}>{hostTeam?.name}</span> flips
      </p>
      <div className={`w-36 h-36 rounded-full flex items-center justify-center text-4xl font-black shadow-2xl ${flipping ? "animate-spin" : ""}`}
        style={{ background: `linear-gradient(135deg, #F5D060, #C98B1A)`, color: "#3D2B00", animationDuration: flipping ? "0.6s" : undefined }}>
        {state.tossResult ? (state.tossResult === "heads" ? "H" : "T") : "?"}
      </div>
      <div className="mt-10 w-full max-w-sm">
        {!state.tossCall && mySide === "away" && (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => send({ type: "toss_call", call: "heads" })} className="py-4 rounded-2xl font-bold text-lg" style={{ background: C.amber, color: "#1A1000" }}>HEADS</button>
            <button onClick={() => send({ type: "toss_call", call: "tails" })} className="py-4 rounded-2xl font-bold text-lg border" style={{ borderColor: C.amber, color: C.amber }}>TAILS</button>
          </div>
        )}
        {!state.tossCall && mySide === "host" && (
          <div className="text-center" style={{ color: C.textMuted }}>Waiting for {awayTeam?.name} to call…</div>
        )}
        {state.tossCall && state.tossResult && state.tossWinner && !state.tossChoice && (
          <div className="text-center">
            <div className="mb-2" style={{ color: C.textMuted }}>Called: <b style={{ color: C.textPrimary }}>{state.tossCall.toUpperCase()}</b> · Result: <b style={{ color: C.textPrimary }}>{state.tossResult.toUpperCase()}</b></div>
            <div className="text-xl font-black mb-6" style={{ color: C.cyan }}>
              {state.tossWinner === "host" ? hostTeam?.name : awayTeam?.name} won the toss!
            </div>
            {mySide === state.tossWinner ? (
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => send({ type: "toss_choice", choice: "bat" })} className="py-4 rounded-2xl font-bold" style={{ background: C.cyan, color: "#0A1520" }}>🏏 BAT FIRST</button>
                <button onClick={() => send({ type: "toss_choice", choice: "bowl" })} className="py-4 rounded-2xl font-bold border" style={{ borderColor: C.violet, color: C.violet }}>🎯 BOWL FIRST</button>
              </div>
            ) : (
              <div style={{ color: C.textMuted }}>Waiting for {state.tossWinner === "host" ? hostTeam?.name : awayTeam?.name} to choose bat/bowl…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Game Board ───────────────────────────────────────────────────────────────
function GameBoard({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const inn = state.innings[state.currentInnings]!;
  const battingSide = inn.battingSide;
  const iAmBatting = mySide === battingSide;
  const myLocked = mySide === "host" ? state.hostLocked : state.awayLocked;
  const phase = PHASE_OF_OVER(inn.overNumber);

  if (state.phase === "innings_setup" && state.pendingSelect?.type === "openers") {
    if (mySide === state.pendingSelect.forSide) return <OpenersSelect state={state} mySide={mySide} send={send} />;
    return <BlockingOverlay text={`Waiting for ${teamForSide(state, state.pendingSelect.forSide)!.name} to choose openers…`} />;
  }
  if (state.phase === "select_bowler" && state.pendingSelect) {
    if (mySide === state.pendingSelect.forSide) return <BowlerSelect state={state} mySide={mySide} send={send} />;
    return <BlockingOverlay text={`Waiting for ${teamForSide(state, state.pendingSelect.forSide)!.name} to choose next bowler…`} />;
  }
  if (state.phase === "select_new_batter" && state.pendingSelect) {
    if (mySide === state.pendingSelect.forSide) return <NewBatterSelect state={state} mySide={mySide} send={send} />;
    return <BlockingOverlay text={`Waiting for ${teamForSide(state, state.pendingSelect.forSide)!.name} to choose next batter…`} />;
  }

  // Wicket flash overlay
  const showWicketFlash = state.lastBall?.isWicket &&
    state.phase === "playing" && !state.hostLocked && !state.awayLocked;

  return (
    <div className="max-w-5xl mx-auto w-full">
      {/* Wicket flash overlay */}
      {showWicketFlash && (
        <div className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="rounded-3xl px-12 py-8 text-center shadow-2xl animate-bounce" style={{ background: `${C.red}18`, border: `2px solid ${C.red}` }}>
            <div className="text-5xl mb-2">🔴</div>
            <div className="text-4xl font-black" style={{ color: C.red }}>OUT!</div>
            <div className="text-lg font-semibold mt-1" style={{ color: C.textPrimary }}>
              {state.lastBall?.dismissalType?.toUpperCase() ?? "WICKET"}
            </div>
            <div className="text-sm mt-1" style={{ color: C.textMuted }}>
              {state.lastBall?.striker}
            </div>
          </div>
        </div>
      )}

      {/* Desktop: two-column layout — pitch left, game right */}
      <div className="flex flex-col lg:flex-row gap-0">
        {/* LEFT: Pitch visualisation (lg+ only) */}
        <div className="hidden lg:flex lg:w-64 xl:w-72 flex-shrink-0 p-4 items-start justify-center pt-6">
          <PitchViz state={state} />
        </div>

        {/* RIGHT: main game panel */}
        <div className="flex-1 p-4 space-y-4">
          {/* Score header */}
          <LiveScore state={state} />

          {/* Ball strip */}
          <BallStrip inn={inn} />

          {/* Pitch viz on mobile (below ball strip) */}
          <div className="lg:hidden">
            <PitchViz state={state} compact />
          </div>

          {/* Player cards */}
          <div className="grid sm:grid-cols-2 gap-3">
            <PlayerCard title="Striker 🏏" name={inn.striker} stats={inn.striker ? inn.batStats[inn.striker] : undefined} type="bat" />
            <PlayerCard title={inn.isLMS ? "Last Man Standing 🛡️" : "Non-Striker"} name={inn.isLMS ? "— (solo)" : inn.nonStriker} stats={!inn.isLMS && inn.nonStriker ? inn.batStats[inn.nonStriker] : undefined} type="bat" />
            <PlayerCard title="Bowler 🎯" name={inn.bowler} stats={inn.bowler ? inn.bowlStats[inn.bowler] : undefined} type="bowl" />
            <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="text-xs mb-1" style={{ color: C.textMuted }}>Phase & Lead</div>
              <div className="font-bold text-sm">
                <span className="px-2 py-0.5 rounded text-xs font-semibold mr-2"
                  style={{ background: phase === "CRAZY" ? "rgba(167,139,250,0.15)" : "rgba(57,198,230,0.1)", color: phase === "CRAZY" ? C.violet : C.cyan }}>
                  {phase}
                </span>
              </div>
              {leadTrailLabel(state) && (
                <div className="mt-1 text-sm font-semibold" style={{ color: C.amber }}>{leadTrailLabel(state)}</div>
              )}
            </div>
          </div>

          {/* Last ball result */}
          {state.lastBall && <LastBallCard ball={state.lastBall} />}

          {/* Number pad */}
          <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-center text-sm mb-3 font-semibold" style={{ color: myLocked ? C.textMuted : iAmBatting ? C.cyan : C.violet }}>
              {iAmBatting ? "🏏 YOU'RE BATTING" : "🎯 YOU'RE BOWLING"}
              {myLocked && <span style={{ color: C.textMuted }}> · 🔒 Locked — waiting for opponent…</span>}
            </div>
            <Numpad
              disabled={myLocked || state.phase !== "playing"}
              onPick={(n) => send({ type: "input", side: mySide, value: n, elapsedMs: localBallElapsed() ?? 0 } as any)}
              batterMode={iAmBatting}
              batterZerosUsed={iAmBatting ? zerosUsedThisOver(inn) : 0}
            />
            {iAmBatting && (
              <button
                onClick={() => { if (confirm("Declare this innings now?")) send({ type: "declare" }); }}
                className="mt-4 w-full py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
                style={{ background: `${C.amber}22`, color: C.amber, border: `1px solid ${C.amber}44` }}
              >
                DECLARE INNINGS{inn.isLMS ? " (LMS)" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pitch Visualisation ──────────────────────────────────────────────────────
// Visual-only; coordinates are presentation-only mappings of shot/delivery zones.
// Resolution logic is unchanged — this reads from state.lastBall only.
function PitchViz({ state, compact }: { state: GameState; compact?: boolean }) {
  const ball = state.lastBall;
  const inn = state.currentInnings > 0 ? state.innings[state.currentInnings] : null;

  // Pitch SVG dimensions
  const W = compact ? 160 : 200;
  const H = compact ? 280 : 360;
  const cx = W / 2;
  const pitchTop = H * 0.12;
  const pitchBot = H * 0.88;
  const pitchH = pitchBot - pitchTop;
  const pitchW = W * 0.28;
  const pl = cx - pitchW / 2;
  const pr = cx + pitchW / 2;

  // Delivery landing zone (Y on pitch) — delivery 1-10 mapped to rough pitch zone
  const deliveryY = (d: number) => {
    const zones: Record<number, number> = {
      1: 0.42, 2: 0.72, 3: 0.3, 4: 0.85, 5: 0.65, 6: 0.55, 7: 0.2, 8: 0.5, 9: 0.45, 10: 0.82,
    };
    return pitchTop + pitchH * (zones[d] ?? 0.5);
  };
  // Shot direction — angle from stump centre in degrees (0=straight, neg=off, pos=leg)
  const shotAngle = (s: number): number => {
    const angles: Record<number, number> = {
      0: 0, 1: -55, 2: -70, 3: -45, 4: 0, 5: 40, 6: 60, 7: 55, 8: -15, 9: 45, 10: 75,
    };
    return angles[s] ?? 0;
  };

  const landingY = ball ? deliveryY(ball.bowl) : pitchTop + pitchH * 0.5;
  const ang = ball ? shotAngle(ball.bat) : 0;
  const rad = (ang * Math.PI) / 180;
  const shotLen = H * 0.3;
  const shotEndX = cx + Math.sin(rad) * shotLen;
  const shotEndY = pitchBot - Math.cos(rad) * shotLen;

  const isWicket = ball?.isWicket;
  const isBoundary = ball?.isBoundary;

  return (
    <div>
      <div className="text-xs font-bold mb-2 text-center" style={{ color: C.textMuted }}>PITCH VIEW</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto block">
        {/* Field (oval) */}
        <ellipse cx={cx} cy={H / 2} rx={W / 2 - 4} ry={H / 2 - 4} fill="#1A2D1A" stroke={C.border} strokeWidth="1" />
        {/* Inner circle */}
        <ellipse cx={cx} cy={H / 2} rx={W * 0.32} ry={H * 0.3} fill="none" stroke="#2A4D2A" strokeWidth="1" strokeDasharray="4 4" />
        {/* Pitch rectangle */}
        <rect x={pl} y={pitchTop} width={pitchW} height={pitchH} rx="3" fill="#4A3A1A" stroke="#6A5A2A" strokeWidth="1" />
        {/* Crease lines */}
        <line x1={pl - 6} y1={pitchTop + pitchH * 0.1} x2={pr + 6} y2={pitchTop + pitchH * 0.1} stroke="#CCC" strokeWidth="1" />
        <line x1={pl - 6} y1={pitchBot - pitchH * 0.1} x2={pr + 6} y2={pitchBot - pitchH * 0.1} stroke="#CCC" strokeWidth="1" />
        {/* Stumps — bowler end (top) */}
        {[-4, 0, 4].map((dx) => (
          <line key={dx} x1={cx + dx} y1={pitchTop + 4} x2={cx + dx} y2={pitchTop + pitchH * 0.1 - 2} stroke="#E8D080" strokeWidth="2" />
        ))}
        {/* Stumps — batter end (bottom) */}
        {[-4, 0, 4].map((dx) => (
          <line key={dx} x1={cx + dx} y1={pitchBot - pitchH * 0.1 + 2} x2={cx + dx} y2={pitchBot - 4} stroke="#E8D080" strokeWidth="2" />
        ))}
        {/* Bowler icon */}
        <circle cx={cx} cy={pitchTop - 12} r={7} fill={C.violet} />
        <text x={cx} y={pitchTop - 8} textAnchor="middle" fontSize="8" fill="white">B</text>
        {/* Batter icon */}
        <circle cx={cx} cy={pitchBot + 12} r={7} fill={C.cyan} />
        <text x={cx} y={pitchBot + 16} textAnchor="middle" fontSize="8" fill="#0A1520">🏏</text>

        {ball && (
          <>
            {/* Delivery path: bowler stumps → landing zone */}
            <line
              x1={cx} y1={pitchTop + pitchH * 0.1}
              x2={cx} y2={landingY}
              stroke={C.violet} strokeWidth="2" strokeDasharray="5 3" opacity="0.8"
            />
            {/* Landing marker */}
            <circle cx={cx} cy={landingY} r={5} fill={C.violet} opacity="0.9" />
            {/* Shot trajectory from batter to field */}
            {!isWicket && (
              <line
                x1={cx} y1={pitchBot - pitchH * 0.1}
                x2={shotEndX} y2={shotEndY}
                stroke={isBoundary ? C.amber : C.cyan} strokeWidth={isBoundary ? 3 : 2}
                strokeDasharray={ball.trajectory === "aerial" ? "none" : "6 3"}
                opacity="0.9"
              />
            )}
            {/* Shot endpoint / boundary */}
            {!isWicket && (
              <circle cx={shotEndX} cy={Math.max(8, shotEndY)} r={isBoundary ? 8 : 5}
                fill={isBoundary ? C.amber : C.cyan} opacity="0.9" />
            )}
            {/* Wicket flash */}
            {isWicket && (
              <text x={cx} y={pitchBot - pitchH * 0.1 - 14} textAnchor="middle" fontSize="18" fill={C.red}>💥</text>
            )}
            {/* Runs label */}
            <text x={W - 6} y={H - 6} textAnchor="end" fontSize="11" fontWeight="bold"
              fill={isWicket ? C.red : isBoundary ? C.amber : C.textPrimary}>
              {isWicket ? (ball.dismissalType?.toUpperCase() ?? "OUT") : `${ball.runs}r`}
            </text>
          </>
        )}
        {!ball && (
          <text x={cx} y={H / 2} textAnchor="middle" fontSize="10" fill={C.textMuted}>Awaiting delivery…</text>
        )}
      </svg>

      {/* Labels below pitch */}
      {ball && (
        <div className="mt-2 space-y-1 text-center">
          <div className="text-xs" style={{ color: C.violet }}>
            🎯 {ball.deliveryName ?? `Delivery ${ball.bowl}`}
          </div>
          <div className="text-xs" style={{ color: C.cyan }}>
            🏏 {ball.shotName ?? `Shot ${ball.bat}`}
          </div>
          {ball.compatibility && (
            <div className="text-xs font-mono px-2 py-0.5 rounded inline-block"
              style={{
                background: ball.compatibility === "G" ? "rgba(57,198,230,0.15)" : ball.compatibility === "B" ? "rgba(255,82,95,0.15)" : ball.compatibility === "X" ? "rgba(255,180,84,0.15)" : "rgba(255,255,255,0.06)",
                color: ball.compatibility === "G" ? C.cyan : ball.compatibility === "B" ? C.red : ball.compatibility === "X" ? C.amber : C.textMuted,
              }}>
              {ball.compatibility}{ball.hasStar ? "★" : ""} · {ball.contactQuality ?? "—"}
            </div>
          )}
        </div>
      )}

      {inn && (
        <div className="mt-3 text-center">
          <div className="text-xs" style={{ color: C.textMuted }}>
            Over {inn.overNumber + 1}.{inn.ballInOver} · {inn.balls.filter((b) => b.over === inn.overNumber + 1).map((b) => b.isWicket ? "W" : b.runs).join("-") || "—"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Last Ball Card ───────────────────────────────────────────────────────────
function LastBallCard({ ball }: { ball: any }) {
  const isWicket = ball.isWicket;
  const isBoundary = ball.isBoundary;
  return (
    <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${isWicket ? C.red : isBoundary ? C.amber : C.border}` }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold" style={{ color: C.textMuted }}>LAST BALL</span>
        {ball.shotName && ball.deliveryName && (
          <>
            <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(57,198,230,0.12)", color: C.cyan }}>{ball.shotName}</span>
            <span className="text-xs" style={{ color: C.textMuted }}>vs</span>
            <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(167,139,250,0.12)", color: C.violet }}>{ball.deliveryName}</span>
            <span className="text-xs" style={{ color: C.textMuted }}>→</span>
          </>
        )}
        {isWicket ? (
          <span className="text-sm font-black px-3 py-0.5 rounded-lg" style={{ background: `${C.red}22`, color: C.red }}>
            {ball.dismissalType?.toUpperCase() ?? "WICKET"} {ball.runs === 0 && "🦆"}
          </span>
        ) : (
          <span className="text-sm font-black px-3 py-0.5 rounded-lg" style={{ background: isBoundary ? `${C.amber}22` : "rgba(255,255,255,0.06)", color: isBoundary ? C.amber : C.textPrimary }}>
            {ball.runs} {ball.runs === 4 ? "FOUR" : ball.runs === 6 ? "SIX" : ball.runs === 1 ? "run" : "runs"}
          </span>
        )}
        {ball.compatibility && (
          <span className="text-xs ml-auto font-mono" style={{ color: ball.compatibility === "G" ? C.cyan : ball.compatibility === "B" ? C.red : C.textMuted }}>
            {ball.compatibility}{ball.hasStar ? "★" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Live Score ───────────────────────────────────────────────────────────────
function LiveScore({ state }: { state: GameState }) {
  const inn = state.innings[state.currentInnings]!;
  const team = teamForSide(state, inn.battingSide)!;
  const t = totalsBySide(state);
  const oppSide: Side = inn.battingSide === "host" ? "away" : "host";
  const oppTeam = teamForSide(state, oppSide)!;
  return (
    <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs mb-0.5" style={{ color: C.textMuted }}>Batting</div>
          <div className="text-xl font-black" style={{ color: C.textPrimary }}>{team.name}</div>
          <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>vs {oppTeam.name} ({oppSide === "host" ? t.host : t.away})</div>
        </div>
        <div className="text-right">
          <div className="text-5xl font-black" style={{ color: C.cyan }}>{inn.runs}<span className="text-2xl" style={{ color: C.textMuted }}>/{inn.wickets}</span></div>
          <div className="text-xs" style={{ color: C.textMuted }}>{inn.overNumber}.{inn.ballInOver} overs</div>
        </div>
      </div>
      {state.currentInnings === 4 && (() => {
        const tgt = computeTarget(state);
        if (tgt === null) return null;
        const need = tgt - inn.runs;
        if (need > 0) return <div className="text-sm mt-2 font-semibold" style={{ color: C.amber }}>Need {need} more to win</div>;
        return null;
      })()}
    </div>
  );
}

// ─── Ball Strip ───────────────────────────────────────────────────────────────
function BallStrip({ inn }: { inn: any }) {
  const overBalls = inn.balls.filter((b: any) => b.over === inn.overNumber + 1);
  return (
    <div className="flex gap-2 flex-wrap">
      {overBalls.map((b: any, i: number) => (
        <div key={i} className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black"
          style={{
            background: b.isWicket ? C.red : b.isSquare ? C.violet : b.runs >= 4 ? C.amber : "rgba(255,255,255,0.1)",
            color: b.isWicket || b.isSquare || b.runs >= 4 ? "#0A0E14" : C.textPrimary,
          }}>
          {b.isWicket ? "W" : b.runs}
        </div>
      ))}
      {Array.from({ length: Math.max(0, 6 - overBalls.length) }).map((_, i) => (
        <div key={i} className="w-9 h-9 rounded-full border" style={{ borderColor: C.border }} />
      ))}
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────
function PlayerCard({ title, name, stats, type }: { title: string; name: string | null | undefined; stats?: BatStats | BowlStats; type: "bat" | "bowl" }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="text-xs mb-0.5" style={{ color: C.textMuted }}>{title}</div>
      <div className="font-bold text-sm" style={{ color: C.textPrimary }}>{name ?? "—"}</div>
      {stats && type === "bat" && (
        <div className="text-xs mt-1" style={{ color: C.textMuted }}>
          <span style={{ color: C.cyan }}>{(stats as BatStats).runs}</span> ({(stats as BatStats).balls} balls)
          {(stats as BatStats).dots ? ` · ${(stats as BatStats).dots} dots` : ""}
        </div>
      )}
      {stats && type === "bowl" && (
        <div className="text-xs mt-1" style={{ color: C.textMuted }}>
          {Math.floor((stats as BowlStats).ballsBowled / 6)}.{(stats as BowlStats).ballsBowled % 6}o ·{" "}
          <span style={{ color: C.red }}>{(stats as BowlStats).wickets}w</span> · {(stats as BowlStats).runsConceded}r
        </div>
      )}
    </div>
  );
}

// ─── Numpad ───────────────────────────────────────────────────────────────────
function Numpad({ disabled, onPick, batterMode, batterZerosUsed }: {
  disabled: boolean; onPick: (n: number) => void; batterMode: boolean; batterZerosUsed: number;
}) {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10];
  const shotLabels: Record<number, string> = { 0: "Def", 1: "Dab", 2: "Cut", 3: "Cov", 4: "Drv", 5: "Flk", 6: "Pul", 7: "Swp", 8: "Lft", 9: "Slg", 10: "Rev" };
  const delivLabels: Record<number, string> = { 1: "Gd", 2: "Ful", 3: "Back", 4: "Slot", 5: "In", 6: "Out", 7: "Shrt", 8: "Wide", 9: "Slw", 10: "Yrk" };
  return (
    <div className="grid grid-cols-4 gap-2">
      {keys.map((n) => {
        const isZero = n === 0;
        const zeroDisabledForBatter = batterMode && isZero && batterZerosUsed >= 3;
        const zeroDisabledForBowler = !batterMode && isZero;
        const off = disabled || zeroDisabledForBatter || zeroDisabledForBowler;
        const label = batterMode ? shotLabels[n] : (n === 0 ? "—" : delivLabels[n]);
        return (
          <button
            key={n}
            onClick={() => onPick(n)}
            disabled={off}
            className="aspect-square rounded-2xl text-xl font-black border-2 transition-all hover:scale-105 active:scale-95 flex flex-col items-center justify-center"
            style={{
              background: off ? "rgba(255,255,255,0.03)" : batterMode ? "rgba(57,198,230,0.12)" : "rgba(167,139,250,0.12)",
              borderColor: off ? C.border : batterMode ? C.cyan : C.violet,
              color: off ? C.textMuted : batterMode ? C.cyan : C.violet,
            }}
          >
            <span>{n}</span>
            <span className="text-xs font-normal opacity-60" style={{ fontSize: "0.55rem" }}>{!off && label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Blocking Overlay ─────────────────────────────────────────────────────────
function BlockingOverlay({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="rounded-2xl p-8 text-center max-w-md" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="animate-pulse text-4xl mb-3">⏳</div>
        <div className="font-bold text-lg" style={{ color: C.textPrimary }}>{text}</div>
        <div className="text-sm mt-2" style={{ color: C.textMuted }}>Your numpad is disabled.</div>
      </div>
    </div>
  );
}

// ─── Selection screens ────────────────────────────────────────────────────────
function OpenersSelect({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const inn = state.innings[state.currentInnings]!;
  const team = teamForSide(state, inn.battingSide)!;
  const eligible = getEligibleBatters(team);
  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const ready = striker && nonStriker && striker !== nonStriker;
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-black mb-1" style={{ color: C.cyan }}>Choose Openers</h2>
      <p className="text-sm mb-6" style={{ color: C.textMuted }}>{team.name} — only the top 5 squad members can bat.</p>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-bold mb-2" style={{ color: C.textMuted }}>STRIKER</div>
          {eligible.map((p) => (
            <button key={p.name} onClick={() => setStriker(p.name)}
              className="w-full text-left px-4 py-3 rounded-xl mb-2 border-2 transition-all"
              style={{ background: striker === p.name ? `${C.cyan}15` : C.card, borderColor: striker === p.name ? C.cyan : C.border, color: C.textPrimary }}>
              {p.name} <span className="text-xs" style={{ color: C.textMuted }}>({p.role})</span>
            </button>
          ))}
        </div>
        <div>
          <div className="text-sm font-bold mb-2" style={{ color: C.textMuted }}>NON-STRIKER</div>
          {eligible.map((p) => (
            <button key={p.name} onClick={() => setNonStriker(p.name)} disabled={p.name === striker}
              className="w-full text-left px-4 py-3 rounded-xl mb-2 border-2 transition-all disabled:opacity-30"
              style={{ background: nonStriker === p.name ? `${C.cyan}15` : C.card, borderColor: nonStriker === p.name ? C.cyan : C.border, color: C.textPrimary }}>
              {p.name} <span className="text-xs" style={{ color: C.textMuted }}>({p.role})</span>
            </button>
          ))}
        </div>
      </div>
      <button disabled={!ready}
        onClick={() => send({ type: "select", kind: "openers", payload: { striker, nonStriker }, from: mySide })}
        className="mt-6 w-full py-4 rounded-2xl font-black text-lg transition-all disabled:opacity-30"
        style={{ background: C.cyan, color: "#0A1520" }}>
        Confirm Openers
      </button>
    </div>
  );
}

function BowlerSelect({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const inn = state.innings[state.currentInnings]!;
  const bowlingSide: Side = inn.battingSide === "host" ? "away" : "host";
  const team = teamForSide(state, bowlingSide)!;
  const eligible = getEligibleBowlers(team);
  const [pick, setPick] = useState("");
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-black mb-1" style={{ color: C.violet }}>Choose Next Bowler</h2>
      <p className="text-sm mb-6" style={{ color: C.textMuted }}>{team.name} · Cannot bowl same as last over{inn.prevBowler ? ` (${inn.prevBowler})` : ""}.</p>
      <div className="grid grid-cols-2 gap-2">
        {eligible.map((p) => {
          const same = p.name === inn.prevBowler;
          return (
            <button key={p.name} disabled={same} onClick={() => setPick(p.name)}
              className="px-4 py-3 rounded-xl text-left border-2 transition-all disabled:opacity-30"
              style={{ background: pick === p.name ? `${C.violet}15` : C.card, borderColor: pick === p.name ? C.violet : C.border, color: C.textPrimary }}>
              {p.name} <span className="text-xs" style={{ color: C.textMuted }}>({p.role})</span>
            </button>
          );
        })}
      </div>
      <button disabled={!pick}
        onClick={() => send({ type: "select", kind: "bowler", payload: { bowler: pick }, from: mySide })}
        className="mt-6 w-full py-4 rounded-2xl font-black text-lg transition-all disabled:opacity-30"
        style={{ background: C.violet, color: "#0A0E14" }}>
        Confirm Bowler
      </button>
    </div>
  );
}

function NewBatterSelect({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const inn = state.innings[state.currentInnings]!;
  const team = teamForSide(state, inn.battingSide)!;
  const remaining = getEligibleBatters(team).filter((p) => inn.yetToBat.includes(p.name));
  const [pick, setPick] = useState("");
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6 p-4 rounded-2xl text-center" style={{ background: `${C.red}15`, border: `1px solid ${C.red}44` }}>
        <div className="text-4xl mb-2">🔴</div>
        <div className="text-2xl font-black" style={{ color: C.red }}>WICKET!</div>
        <div className="text-sm mt-1" style={{ color: C.textMuted }}>
          {inn.wickets} down · {inn.wickets === 4 ? "LMS begins!" : `${5 - inn.wickets} wicket${5 - inn.wickets === 1 ? "" : "s"} remaining`}
        </div>
      </div>
      <h2 className="text-2xl font-black mb-1" style={{ color: C.cyan }}>Next Batter — {team.name}</h2>
      <p className="text-sm mb-4" style={{ color: C.textMuted }}>Select your next batter from the available players.</p>
      <div className="grid grid-cols-2 gap-2">
        {remaining.map((p) => (
          <button key={p.name} onClick={() => setPick(p.name)}
            className="px-4 py-3 rounded-xl text-left border-2 transition-all"
            style={{ background: pick === p.name ? `${C.cyan}15` : C.card, borderColor: pick === p.name ? C.cyan : C.border, color: C.textPrimary }}>
            {p.name} <span className="text-xs" style={{ color: C.textMuted }}>({p.role})</span>
          </button>
        ))}
      </div>
      <button disabled={!pick}
        onClick={() => send({ type: "select", kind: "batter", payload: { batter: pick }, from: mySide })}
        className="mt-6 w-full py-4 rounded-2xl font-black text-lg transition-all disabled:opacity-30"
        style={{ background: C.cyan, color: "#0A1520" }}>
        Send In
      </button>
    </div>
  );
}

// ─── Innings Break ────────────────────────────────────────────────────────────
function InningsBreak({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const nextInnings = (state.currentInnings + 1) as 2 | 3 | 4;
  let nextSide: Side;
  if (nextInnings === 2) nextSide = state.innings[1]!.battingSide === "host" ? "away" : "host";
  else if (nextInnings === 3) nextSide = state.firstInningsBattingSide ?? state.innings[1]!.battingSide;
  else { const inn3Side = state.innings[3]!.battingSide; nextSide = inn3Side === "host" ? "away" : "host"; }

  const t = totalsBySide(state);
  return (
    <div className="p-8 max-w-2xl mx-auto text-center">
      <div className="text-5xl mb-4">🏟️</div>
      <h2 className="text-3xl font-black mb-2" style={{ color: C.cyan }}>End of Innings {state.currentInnings}</h2>
      <div className="text-sm mb-6" style={{ color: C.textMuted }}>
        {getTeam(state.hostTeamId!)?.name} <span style={{ color: C.cyan }}>{t.host}</span> · {getTeam(state.awayTeamId!)?.name} <span style={{ color: C.amber }}>{t.away}</span>
      </div>
      {state.lastBall && (
        <div className="mb-6 mx-auto max-w-md rounded-2xl p-4 text-left" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs mb-2 font-semibold" style={{ color: C.textMuted }}>LAST BALL OF INNINGS</div>
          <div className="font-semibold">
            {state.lastBall.striker} — bat <b>{state.lastBall.bat}</b> vs bowl <b>{state.lastBall.bowl}</b> →{" "}
            {state.lastBall.isWicket ? <span style={{ color: C.red }}>WICKET</span> : <span style={{ color: C.cyan }}>{state.lastBall.runs} runs</span>}
          </div>
        </div>
      )}
      <div className="mb-8 text-lg">
        Innings {nextInnings} → <b style={{ color: C.amber }}>{teamForSide(state, nextSide)!.name}</b> bats next.
      </div>
      {mySide === "host" ? (
        <button onClick={() => send({ type: "next_innings_choice", battingSide: nextSide })}
          className="px-8 py-4 rounded-2xl font-black text-lg"
          style={{ background: C.cyan, color: "#0A1520" }}>
          Start Innings {nextInnings}
        </button>
      ) : (
        <div style={{ color: C.textMuted }}>Waiting for host to start next innings…</div>
      )}
    </div>
  );
}

// ─── Follow-on decision ───────────────────────────────────────────────────────
function FollowOnDecision({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const teamASide = state.innings[1]!.battingSide;
  const teamA = teamForSide(state, teamASide)!;
  const teamB = teamForSide(state, teamASide === "host" ? "away" : "host")!;
  const t = totalsBySide(state);
  const deficit = (teamASide === "host" ? t.host : t.away) - (teamASide === "host" ? t.away : t.host);
  return (
    <div className="p-8 max-w-2xl mx-auto text-center">
      <div className="text-4xl mb-4">⚔️</div>
      <h2 className="text-2xl font-black mb-2" style={{ color: C.amber }}>Follow-On Available</h2>
      <p className="mb-8" style={{ color: C.textMuted }}>
        <span style={{ color: C.textPrimary }}>{teamA.name}</span> leads by <span style={{ color: C.amber }}>{deficit} runs</span>. They may enforce the follow-on on {teamB.name}.
      </p>
      {mySide === teamASide ? (
        <div className="flex justify-center gap-4">
          <button onClick={() => send({ type: "follow_on", enforce: true })}
            className="px-6 py-4 rounded-2xl font-bold"
            style={{ background: C.amber, color: "#1A0A00" }}>
            ENFORCE Follow-On
          </button>
          <button onClick={() => send({ type: "next_innings_choice", battingSide: teamASide })}
            className="px-6 py-4 rounded-2xl font-bold border"
            style={{ borderColor: C.cyan, color: C.cyan }}>
            Bat Again
          </button>
        </div>
      ) : (
        <div style={{ color: C.textMuted }}>Waiting for {teamA.name} to decide…</div>
      )}
    </div>
  );
}

// ─── Scorecard ────────────────────────────────────────────────────────────────
function Scorecard({ state, code: _code, isHost: _isHost }: { state: GameState; code: string; isHost: boolean }) {
  const result = state.result ?? finalizeResult(state);
  const t = totalsBySide(state);
  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Result banner */}
      <div className="rounded-3xl p-8 mb-8 text-center" style={{ background: `linear-gradient(135deg, ${C.card}, #1A2535)`, border: `1px solid ${C.cyan}44` }}>
        <div className="text-4xl mb-4">🏆</div>
        <div className="text-sm mb-2" style={{ color: C.textMuted }}>MATCH RESULT</div>
        <div className="text-3xl font-black" style={{ color: C.cyan }}>{result}</div>
        <div className="mt-4 flex justify-center gap-8 text-sm">
          <div><div style={{ color: C.textMuted }}>Host</div><div className="font-black text-xl" style={{ color: C.cyan }}>{t.host}</div></div>
          <div className="text-2xl self-center" style={{ color: C.textMuted }}>vs</div>
          <div><div style={{ color: C.textMuted }}>Away</div><div className="font-black text-xl" style={{ color: C.amber }}>{t.away}</div></div>
        </div>
      </div>

      {state.lastBall && (
        <div className="mb-6 mx-auto max-w-md rounded-2xl p-4 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs mb-1 font-semibold" style={{ color: C.textMuted }}>FINAL BALL</div>
          <div className="font-semibold">
            {state.lastBall.striker} — bat <b>{state.lastBall.bat}</b> vs bowl <b>{state.lastBall.bowl}</b> →{" "}
            {state.lastBall.isWicket ? <span style={{ color: C.red }}>WICKET</span> : <span style={{ color: C.cyan }}>{state.lastBall.runs} runs</span>}
          </div>
        </div>
      )}

      {[1, 2, 3, 4].map((i) => {
        const inn = state.innings[i];
        if (!inn) return null;
        const team = teamForSide(state, inn.battingSide)!;
        return (
          <div key={i} className="rounded-2xl p-5 mb-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <h3 className="font-black text-lg mb-4" style={{ color: C.textPrimary }}>
              Innings {i} — <span style={{ color: C.cyan }}>{team.name}</span>{" "}
              <span style={{ color: C.amber }}>{inn.runs}/{inn.wickets}</span>
              {inn.declared ? <span className="text-sm ml-2" style={{ color: C.textMuted }}>(decl.)</span> : ""}
            </h3>
            <BattingTable inn={inn} />
            <h4 className="font-bold mt-5 mb-3" style={{ color: C.textMuted }}>BOWLING</h4>
            <BowlingTable inn={inn} />
          </div>
        );
      })}
      <TimersPanel state={state} />
    </div>
  );
}

function TimersPanel({ state }: { state: GameState }) {
  const hostName = teamForSide(state, "host")?.name ?? "Host";
  const awayName = teamForSide(state, "away")?.name ?? "Away";
  const players = Object.entries(state.playerThinkMs ?? {}).filter(([, ms]) => ms > 0);
  players.sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-2xl p-5 mb-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <h3 className="font-bold mb-4" style={{ color: C.textMuted }}>⏱ MATCH TIME</h3>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        {[
          { label: "Total match time", val: formatClock(matchElapsedMs(state)) },
          { label: `${hostName} playing time`, val: formatClock(state.thinkMs?.host ?? 0) },
          { label: `${awayName} playing time`, val: formatClock(state.thinkMs?.away ?? 0) },
        ].map((x) => (
          <div key={x.label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="text-xs mb-1" style={{ color: C.textMuted }}>{x.label}</div>
            <div className="font-mono text-xl" style={{ color: C.cyan }}>{x.val}</div>
          </div>
        ))}
      </div>
      {players.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr><th className="text-left py-1" style={{ color: C.textMuted }}>Player</th><th className="text-right py-1" style={{ color: C.textMuted }}>Think time</th></tr></thead>
          <tbody>
            {players.map(([name, ms]) => (
              <tr key={name} className="border-t" style={{ borderColor: C.border }}>
                <td className="py-1">{name}</td>
                <td className="py-1 text-right font-mono" style={{ color: C.textMuted }}>{formatClock(ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BattingTable({ inn }: { inn: any }) {
  const perPlayer: Record<string, { normal: any; crazy: any }> = {};
  const ensure = (name: string) => {
    if (!perPlayer[name]) perPlayer[name] = { normal: { r: 0, b: 0, d: 0, sq: {} as any }, crazy: { r: 0, b: 0, d: 0, sq: {} as any } };
    return perPlayer[name];
  };
  for (const ball of inn.balls) {
    const p = ensure(ball.striker);
    const bucket = ball.phase === "NORMAL" ? p.normal : p.crazy;
    bucket.b += 1;
    if (!ball.isWicket) { bucket.r += ball.runs; if (ball.runs === 0) bucket.d += 1; if (ball.isSquare) bucket.sq[ball.runs] = (bucket.sq[ball.runs] ?? 0) + 1; }
  }
  const groups = [{ label: "Low (1²-4²)", keys: [1, 4, 9, 16] }, { label: "Basic (5²-7²)", keys: [25, 36, 49] }, { label: "High (8²-9²)", keys: [64, 81] }, { label: "100", keys: [100] }];
  const sumGroup = (sq: Record<number, number>, keys: number[]) => keys.reduce((a, k) => a + (sq[k] ?? 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: C.textMuted }}>
            <th className="text-left p-1">Batter</th>
            <th className="text-left p-1">Phase</th>
            <th>R</th><th>B</th><th>Dots</th>
            {groups.map((g) => <th key={g.label}>{g.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {Object.entries(perPlayer).map(([name, p]) => {
            const out = inn.batStats[name]?.out;
            return (
              <Fragment key={name}>
                <tr className="border-t" style={{ borderColor: C.border }}>
                  <td className="p-1 font-semibold" rowSpan={2} style={{ color: C.textPrimary }}>{name} {out ? "" : "*"}</td>
                  <td className="text-xs" style={{ color: C.cyan }}>NORMAL</td>
                  <td className="text-center">{p.normal.r}</td><td className="text-center">{p.normal.b}</td><td className="text-center">{p.normal.d}</td>
                  {groups.map((g) => <td key={g.label} className="text-center">{sumGroup(p.normal.sq, g.keys)}</td>)}
                </tr>
                <tr className="border-t" style={{ borderColor: "rgba(255,255,255,0.03)" }}>
                  <td className="text-xs" style={{ color: C.violet }}>CRAZY</td>
                  <td className="text-center">{p.crazy.r}</td><td className="text-center">{p.crazy.b}</td><td className="text-center">{p.crazy.d}</td>
                  {groups.map((g) => <td key={g.label} className="text-center">{sumGroup(p.crazy.sq, g.keys)}</td>)}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BowlingTable({ inn }: { inn: any }) {
  const split: Record<string, { NORMAL: { b: number; r: number; w: number }; CRAZY: { b: number; r: number; w: number; maidens: number } }> = {};
  const ensure = (n: string) => { if (!split[n]) split[n] = { NORMAL: { b: 0, r: 0, w: 0 }, CRAZY: { b: 0, r: 0, w: 0, maidens: 0 } }; return split[n]; };
  for (const b of inn.balls as any[]) {
    const s = ensure(b.bowler);
    const grp = b.phase === "CRAZY" ? s.CRAZY : s.NORMAL;
    grp.b += 1; grp.r += b.runs; if (b.isWicket) grp.w += 1;
  }
  const byOver: Record<string, { phase: string; balls: any[] }> = {};
  for (const b of inn.balls as any[]) {
    const k = `${b.bowler}#${b.over}`;
    if (!byOver[k]) byOver[k] = { phase: b.phase, balls: [] };
    byOver[k].balls.push(b);
  }
  for (const k of Object.keys(byOver)) {
    const o = byOver[k];
    if (o.phase === "CRAZY" && o.balls.length === 6 && o.balls.every((b) => !b.isSquare)) { ensure(k.split("#")[0]).CRAZY.maidens += 1; }
  }
  const ov = (n: number) => `${Math.floor(n / 6)}.${n % 6}`;
  const econ = (r: number, b: number) => (b ? ((r / b) * 6).toFixed(2) : "—");
  const names = Object.keys(inn.bowlStats);
  return (
    <table className="w-full text-xs">
      <thead>
        <tr style={{ color: C.textMuted }}>
          <th rowSpan={2} className="text-left p-1">Bowler</th>
          <th colSpan={4} className="border-b text-xs pb-1" style={{ borderColor: C.cyan, color: C.cyan }}>Normal</th>
          <th colSpan={5} className="border-b text-xs pb-1" style={{ borderColor: C.violet, color: C.violet }}>Crazy</th>
          <th rowSpan={2}>Total</th>
        </tr>
        <tr style={{ color: C.textMuted }}>
          <th>O</th><th>R</th><th>W</th><th>Econ</th>
          <th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th>
        </tr>
      </thead>
      <tbody>
        {names.map((name) => {
          const s = ensure(name);
          const total = s.NORMAL.b + s.CRAZY.b;
          const totalR = s.NORMAL.r + s.CRAZY.r;
          const totalW = s.NORMAL.w + s.CRAZY.w;
          return (
            <tr key={name} className="border-t" style={{ borderColor: C.border }}>
              <td className="p-1 font-semibold">{name}</td>
              <td className="text-center">{ov(s.NORMAL.b)}</td><td className="text-center">{s.NORMAL.r}</td><td className="text-center">{s.NORMAL.w}</td><td className="text-center">{econ(s.NORMAL.r, s.NORMAL.b)}</td>
              <td className="text-center">{ov(s.CRAZY.b)}</td><td className="text-center">{s.CRAZY.maidens}</td><td className="text-center">{s.CRAZY.r}</td><td className="text-center">{s.CRAZY.w}</td><td className="text-center">{econ(s.CRAZY.r, s.CRAZY.b)}</td>
              <td className="text-center" style={{ color: C.textMuted }}>{ov(total)} · {totalR}/{totalW}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function ChatBox({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [lastSeen, setLastSeen] = useState(state.chat.length);
  const recent = state.chat.slice(-30);
  const unread = state.chat.slice(lastSeen).filter((m) => m.side !== mySide).length;
  useEffect(() => { if (open) setLastSeen(state.chat.length); }, [open, state.chat.length]);
  return (
    <div className="fixed bottom-6 right-4 z-50">
      {open ? (
        <div className="w-72 h-80 rounded-2xl flex flex-col shadow-2xl" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="px-3 py-2 flex justify-between text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
            <span className="font-bold" style={{ color: C.cyan }}>Match Chat</span>
            <button onClick={() => { setOpen(false); setLastSeen(state.chat.length); }} style={{ color: C.textMuted }}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 text-xs space-y-1">
            {recent.map((m, i) => (
              <div key={i}>
                <b style={{ color: m.side === "host" ? C.cyan : C.violet }}>{m.side === "host" ? "Host" : "Away"}:</b>{" "}{m.text}
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; send({ type: "chat", side: mySide, text: text.trim() }); setText(""); }}
            className="flex" style={{ borderTop: `1px solid ${C.border}` }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="say something…"
              className="flex-1 px-2 py-2 bg-transparent text-xs outline-none" style={{ color: C.textPrimary }} />
            <button className="px-3 text-xs font-bold" style={{ color: C.cyan }}>Send</button>
          </form>
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="relative rounded-full px-4 py-2 text-sm font-bold shadow-lg"
          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }}>
          💬 {state.chat.length}
          {unread > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse" style={{ background: C.red, border: `2px solid ${C.bg}` }} />}
        </button>
      )}
    </div>
  );
}

// ─── Pause Overlay ────────────────────────────────────────────────────────────
function PauseOverlay({ state, mySide, send }: { state: GameState; mySide: Side; send: (e: RoomEvent) => void }) {
  const [showCard, setShowCard] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "rgba(21,25,35,0.92)", backdropFilter: "blur(4px)" }}>
      <div className="flex-1 overflow-y-auto">
        {showCard ? (
          <div>
            <div className="p-4 sticky top-0 flex justify-between items-center" style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
              <h2 className="text-lg font-bold">⏸ Match Paused — Scorecard</h2>
              <button onClick={() => setShowCard(false)} className="px-3 py-1 rounded text-sm" style={{ background: "rgba(255,255,255,0.08)" }}>Back</button>
            </div>
            <Scorecard state={state} code="" isHost={false} />
          </div>
        ) : (() => {
          const isDisc = state.pausedReason === "disconnect";
          const discSide = state.disconnectedSide;
          const discTeam = discSide ? teamForSide(state, discSide)?.name : "Opponent";
          const remainMs = isDisc && state.pausedAt ? Math.max(0, 5 * 60 * 1000 - (Date.now() - state.pausedAt)) : 0;
          const mm = Math.floor(remainMs / 60000);
          const ss = Math.floor((remainMs % 60000) / 1000);
          return (
            <div className="min-h-full flex flex-col items-center justify-center p-6">
              <div className="text-6xl mb-4">{isDisc ? "🔌" : "⏸"}</div>
              <div className="text-3xl font-black mb-2">{isDisc ? `${discTeam} disconnected` : "Match Paused"}</div>
              <div className="text-sm mb-6 text-center" style={{ color: C.textMuted }}>
                {isDisc ? `Waiting for ${discTeam} to return…` : state.pausedReason === "idle" ? "Paused due to inactivity. Either side can resume." : "Timer is frozen. Either side can resume."}
              </div>
              {isDisc && (
                <div className="font-mono text-2xl mb-6" style={{ color: C.amber }}>
                  {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                  <span className="text-sm ml-2" style={{ color: C.textMuted }}>until forfeit</span>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                <button onClick={() => setShowCard(true)} className="flex-1 py-3 rounded-2xl font-bold" style={{ background: `${C.violet}22`, color: C.violet, border: `1px solid ${C.violet}44` }}>📊 View Scorecard</button>
                {!isDisc && (
                  <button onClick={() => send({ type: "resume" })} className="flex-1 py-3 rounded-2xl font-bold" style={{ background: C.cyan, color: "#0A1520" }}>▶ Resume Match</button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
