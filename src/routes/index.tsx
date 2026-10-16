import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { TEAMS, PRACTICE_HOME_ID, PRACTICE_AWAY_ID } from "@/lib/teams";
import { saveSide } from "@/lib/storage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HCC — Hand Cricket Championship" },
      { name: "description", content: "Real-time multiplayer 4-innings hand cricket." },
      { property: "og:title", content: "HCC — Hand Cricket Championship" },
      { property: "og:description", content: "Real-time multiplayer 4-innings hand cricket." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lobby,
});

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

function genRoom(prefix: string = "") {
  return (prefix ? prefix + "-" : "") + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function Lobby() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"practice" | "tournament">("practice");
  const [selectedTeam, setSelectedTeam] = useState<string>("TUXI");

  // Single player vs AI with real HCC squads
  const startAIPractice = () => {
    const code = genRoom("AI");
    saveSide(code, "host", selectedTeam);
    navigate({ to: "/room/$code", params: { code } });
  };

  // Create 2-player room
  const createTwoPlayer = () => {
    const code = genRoom();
    saveSide(code, "host", selectedTeam);
    navigate({ to: "/room/$code", params: { code } });
  };

  // Join room
  const join = () => {
    if (!joinCode.trim()) return;
    const code = joinCode.trim().toUpperCase();
    saveSide(code, "away", selectedTeam);
    navigate({ to: "/room/$code", params: { code } });
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }} className="flex flex-col text-white">
      {/* Header */}
      <header
        className="px-6 py-4 flex items-center justify-between"
        style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black" style={{ color: C.cyan }}>
            🏏 HCC
          </span>
          <span className="text-xs font-bold tracking-wider px-2 py-0.5 rounded" style={{ background: "rgba(57,198,230,0.12)", color: C.cyan }}>
            CHAMPIONSHIP ENGINE
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/players"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all hover:bg-white/5"
            style={{ borderColor: C.border, color: C.textPrimary }}
          >
            Players & Stats
          </Link>
          <Link
            to="/auth"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all hover:bg-white/5"
            style={{ borderColor: C.border, color: C.textMuted }}
          >
            Admin
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-6 py-8 max-w-5xl mx-auto w-full">
        <h2 className="text-xl font-black mb-4" style={{ color: C.textPrimary }}>
          Choose Match Mode
        </h2>

        {/* Mode Selector */}
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => setMode("practice")}
            className="rounded-2xl p-4 text-left border-2 transition-all hover:scale-[1.01]"
            style={{
              background: mode === "practice" ? "rgba(57,198,230,0.12)" : C.card,
              borderColor: mode === "practice" ? C.cyan : C.border,
            }}
          >
            <div className="font-black text-base flex items-center gap-2" style={{ color: mode === "practice" ? C.cyan : C.textPrimary }}>
              <span>🏏 Practice Matches</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${C.cyan}25`, color: C.cyan }}>
                Single & Multiplayer
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: C.textMuted }}>
              Play vs AI bot or friends using real HCC Dream Team squads. Independent of tournament standings.
            </div>
          </button>

          <button
            onClick={() => setMode("tournament")}
            className="rounded-2xl p-4 text-left border-2 transition-all hover:scale-[1.01]"
            style={{
              background: mode === "tournament" ? "rgba(255,180,84,0.12)" : C.card,
              borderColor: mode === "tournament" ? C.amber : C.border,
            }}
          >
            <div className="font-black text-base flex items-center gap-2" style={{ color: mode === "tournament" ? C.amber : C.textPrimary }}>
              <span>🏆 Official Tournament</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${C.amber}25`, color: C.amber }}>
                Official
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: C.textMuted }}>
              Authenticated fixtures with official scorecard persistence, standings, and player ratings.
            </div>
          </button>
        </div>

        {mode === "tournament" ? (
          <div className="rounded-3xl p-6 space-y-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <h3 className="font-bold text-lg" style={{ color: C.amber }}>
              Tournament Player Sign-in
            </h3>
            <ol className="text-sm list-decimal pl-5 space-y-1.5" style={{ color: C.textMuted }}>
              <li>Claim your assigned player identity using the code given by the admin.</li>
              <li>Set a secure PIN to authenticate for scheduled fixtures.</li>
              <li>Enter the official fixture room code to participate.</li>
            </ol>
            <p className="text-xs" style={{ color: C.textMuted }}>
              Tournament identities and team assignments are managed strictly by tournament admins.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 pt-2">
              <button disabled className="py-3 rounded-xl font-bold text-sm disabled:opacity-40" style={{ background: C.amber, color: "#1A1000" }}>
                I have a claim code
              </button>
              <button disabled className="py-3 rounded-xl border font-bold text-sm disabled:opacity-40" style={{ borderColor: C.border, color: C.textPrimary }}>
                Sign in with PIN
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Squad Selector with Real Dream Teams (Section 10) */}
            <div className="rounded-3xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: C.cyan }}>
                1. Select Your HCC Squad
              </div>
              <p className="text-xs mb-3" style={{ color: C.textMuted }}>
                Choose any official Dream Team squad for practice:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {TEAMS.map((t) => {
                  const isPicked = selectedTeam === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTeam(t.id)}
                      className="p-3 rounded-xl border-2 text-left transition-all hover:scale-105 active:scale-95"
                      style={{
                        background: isPicked ? `linear-gradient(135deg, ${t.color}AA, ${t.accent}AA)` : "rgba(255,255,255,0.03)",
                        borderColor: isPicked ? C.cyan : C.border,
                      }}
                    >
                      <div className="font-black text-sm flex items-center justify-between">
                        <span>{t.id}</span>
                        {isPicked && <span style={{ color: C.cyan }}>✓</span>}
                      </div>
                      <div className="text-[10px] opacity-75 truncate mt-0.5">{t.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Launch Options */}
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Option A: Play vs AI (Section 10) */}
              <div className="rounded-3xl p-6 flex flex-col justify-between" style={{ background: C.card, border: `2px solid ${C.violet}50` }}>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">🤖</span>
                    <h3 className="font-black text-base" style={{ color: C.violet }}>
                      Play vs Computer AI
                    </h3>
                  </div>
                  <p className="text-xs mb-4" style={{ color: C.textMuted }}>
                    Instant single-player match against the automated HCC game engine. The computer picks tactical shots and deliveries with weighted realism.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={startAIPractice}
                  className="w-full py-3.5 rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-95 shadow-lg"
                  style={{ background: C.violet, color: "#0A0E14" }}
                >
                  Start Match vs AI ⚡
                </button>
              </div>

              {/* Option B: Multiplayer Room */}
              <div className="rounded-3xl p-6 flex flex-col justify-between" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">👥</span>
                    <h3 className="font-bold text-base" style={{ color: C.cyan }}>
                      Play vs Friend Online
                    </h3>
                  </div>
                  <p className="text-xs mb-3" style={{ color: C.textMuted }}>
                    Host a private 2-player match or join using an opponent's room code.
                  </p>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="ENTER CODE"
                      className="flex-1 px-3 py-2 rounded-xl text-xs uppercase tracking-widest outline-none border"
                      style={{ background: "rgba(0,0,0,0.3)", borderColor: C.border, color: C.textPrimary }}
                    />
                    <button
                      type="button"
                      disabled={!joinCode.trim()}
                      onClick={join}
                      className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-30"
                      style={{ background: C.amber, color: "#1A1000" }}
                    >
                      Join
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={createTwoPlayer}
                  className="w-full py-3 rounded-xl font-bold text-xs border transition-all hover:bg-white/5 active:scale-95"
                  style={{ borderColor: C.cyan, color: C.cyan }}
                >
                  Create 2-Player Room
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
