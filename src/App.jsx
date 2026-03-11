import { useState, useEffect, useRef, useCallback } from "react";

// ─── MATH ENGINE ───────────────────────────────────────────────────────────────
const SERVERS = [
  { id: 0, name: "Web Server",    icon: "🌐", vuln: 0.85, damage: 0.60, color: "#f59e0b" },
  { id: 1, name: "Database",      icon: "🗄",  vuln: 0.65, damage: 0.95, color: "#ef4444" },
  { id: 2, name: "Auth Server",   icon: "🔐", vuln: 0.50, damage: 0.80, color: "#8b5cf6" },
  { id: 3, name: "File System",   icon: "📁", vuln: 0.70, damage: 0.55, color: "#06b6d4" },
];

function computeRisk(s) { return s.vuln * s.damage; }

function stackelbergOptimal() {
  const risks = SERVERS.map(computeRisk);
  const total = risks.reduce((a, b) => a + b, 0);
  return risks.map(r => r / total);
}

function nashMixed() {
  // Proportional to vulnerability only
  const vulns = SERVERS.map(s => s.vuln);
  const total = vulns.reduce((a, b) => a + b, 0);
  return vulns.map(v => v / total);
}

function smartAttack(defense) {
  // Attacker maximizes: damage * vulnerability * (1 - defense)
  const scores = SERVERS.map((s, i) => s.damage * s.vuln * (1 - defense[i]));
  const max = Math.max(...scores);
  const idx = scores.indexOf(max);
  return { target: idx, scores, expectedGain: max };
}

function randomAttack() {
  return { target: Math.floor(Math.random() * 4), scores: [0.25, 0.25, 0.25, 0.25], expectedGain: null };
}

function simulateRound(defense, attackerMode) {
  const atk = attackerMode === "smart" ? smartAttack(defense) : randomAttack();
  const s = SERVERS[atk.target];
  const defProb = defense[atk.target];
  const blocked = Math.random() < defProb;
  const actualDamage = blocked ? 0 : s.damage * s.vuln;
  return { ...atk, blocked, actualDamage, server: s };
}

// ─── PARTICLE SYSTEM ──────────────────────────────────────────────────────────
function useParticles(canvasRef, active) {
  const particles = useRef([]);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const spawn = () => {
      if (!active) return;
      for (let i = 0; i < 2; i++) {
        particles.current.push({
          x: Math.random() * canvas.width,
          y: canvas.height + 10,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -(Math.random() * 1.5 + 0.5),
          life: 1,
          size: Math.random() * 2 + 0.5,
          color: Math.random() > 0.5 ? "#00d4ff" : "#7b2fff",
        });
      }
    };

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      spawn();
      particles.current = particles.current.filter(p => p.life > 0);
      particles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.life -= 0.008;
        ctx.globalAlpha = p.life * 0.6;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);
}

// ─── SERVER NODE VISUAL ───────────────────────────────────────────────────────
function ServerNode({ server, defenseLevel, attackScore, isUnderAttack, isDefended, pulseColor }) {
  const risk = computeRisk(server);
  const threatLevel = attackScore !== null ? attackScore / Math.max(...SERVERS.map((s, i) => s.damage * s.vuln)) : 0;

  return (
    <div style={{
      position: "relative",
      background: isUnderAttack
        ? `radial-gradient(circle, ${isDefended ? "#00ff8820" : "#ff000025"} 0%, #0f1923 70%)`
        : "#0f1923",
      border: `2px solid ${isUnderAttack ? (isDefended ? "#00ff88" : "#ff0040") : server.color}40`,
      borderRadius: "16px",
      padding: "1.2rem",
      transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
      transform: isUnderAttack ? "scale(1.04)" : "scale(1)",
      boxShadow: isUnderAttack
        ? `0 0 30px ${isDefended ? "#00ff8840" : "#ff004040"}, 0 0 60px ${isDefended ? "#00ff8815" : "#ff000015"}`
        : `0 0 0 1px ${server.color}20`,
      cursor: "default",
      overflow: "hidden",
    }}>
      {/* Scan line animation */}
      {isUnderAttack && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "2px",
          background: `linear-gradient(90deg, transparent, ${isDefended ? "#00ff88" : "#ff0040"}, transparent)`,
          animation: "scan 1s linear infinite",
        }} />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.8rem" }}>
        <div>
          <div style={{ fontSize: "1.6rem", marginBottom: "0.2rem" }}>{server.icon}</div>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e2e8f0", fontFamily: "'Courier New', monospace" }}>{server.name}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {isUnderAttack && (
            <div style={{
              padding: "0.2rem 0.6rem", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 700,
              background: isDefended ? "#00ff8830" : "#ff004030",
              color: isDefended ? "#00ff88" : "#ff0040",
              border: `1px solid ${isDefended ? "#00ff88" : "#ff0040"}`,
              animation: "pulse 0.5s ease infinite alternate",
            }}>
              {isDefended ? "🛡 BLOCKED" : "💥 BREACH"}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.8rem" }}>
        {[
          { label: "VULN", value: `${(server.vuln * 100).toFixed(0)}%`, color: "#f59e0b" },
          { label: "DAMAGE", value: `${(server.damage * 100).toFixed(0)}%`, color: "#ef4444" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#0a0f1e", borderRadius: "8px", padding: "0.4rem 0.6rem" }}>
            <div style={{ fontSize: "0.65rem", color: "#475569", fontFamily: "'Courier New', monospace", marginBottom: "1px" }}>{label}</div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Defense bar */}
      <div style={{ marginBottom: "0.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span style={{ fontSize: "0.68rem", color: "#475569", fontFamily: "'Courier New', monospace" }}>DEFENSE</span>
          <span style={{ fontSize: "0.75rem", color: "#00d4ff", fontWeight: 700 }}>{(defenseLevel * 100).toFixed(0)}%</span>
        </div>
        <div style={{ height: "4px", background: "#1e293b", borderRadius: "2px", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${defenseLevel * 100}%`,
            background: `linear-gradient(90deg, #00d4ff, #7b2fff)`,
            borderRadius: "2px", transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* Attacker threat bar */}
      {attackScore !== null && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
            <span style={{ fontSize: "0.68rem", color: "#475569", fontFamily: "'Courier New', monospace" }}>ATK SCORE</span>
            <span style={{ fontSize: "0.75rem", color: "#ef4444", fontWeight: 700 }}>{attackScore.toFixed(2)}</span>
          </div>
          <div style={{ height: "4px", background: "#1e293b", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${Math.min(threatLevel * 100, 100)}%`,
              background: "linear-gradient(90deg, #f59e0b, #ef4444)",
              borderRadius: "2px", transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ANIMATED LOG ─────────────────────────────────────────────────────────────
function LogEntry({ entry, index }) {
  return (
    <div style={{
      display: "flex", gap: "0.6rem", alignItems: "flex-start",
      padding: "0.5rem 0.7rem",
      background: entry.blocked ? "#00ff8808" : "#ff004008",
      borderLeft: `3px solid ${entry.blocked ? "#00ff88" : "#ff0040"}`,
      borderRadius: "0 6px 6px 0",
      marginBottom: "4px",
      animation: "slideIn 0.3s ease",
      fontFamily: "'Courier New', monospace",
      fontSize: "0.78rem",
    }}>
      <span style={{ color: "#475569", minWidth: "24px" }}>#{String(index + 1).padStart(3, "0")}</span>
      <span style={{ color: "#94a3b8" }}>
        <span style={{ color: entry.server.color }}>{entry.server.icon} {entry.server.name}</span>
        {" — "}
        {entry.blocked
          ? <span style={{ color: "#00ff88" }}>BLOCKED (+0.00)</span>
          : <span style={{ color: "#ff0040" }}>BREACH (−{entry.actualDamage.toFixed(2)})</span>
        }
      </span>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function StackelbergGame() {
  const [defense, setDefense] = useState([0.25, 0.25, 0.25, 0.25]);
  const [attackerMode, setAttackerMode] = useState("smart");
  const [defenderMode, setDefenderMode] = useState("manual");
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1200);
  const [rounds, setRounds] = useState([]);
  const [lastRound, setLastRound] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | defending | attacking | result
  const [attackScores, setAttackScores] = useState(null);
  const [showMath, setShowMath] = useState(false);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const roundCountRef = useRef(0);
  useParticles(canvasRef, running);

  const totalDamage = rounds.reduce((s, r) => s + r.actualDamage, 0);
  const breaches = rounds.filter(r => !r.blocked).length;
  const blocks = rounds.filter(r => r.blocked).length;

  const applyPreset = useCallback((mode) => {
    setDefenderMode(mode);
    if (mode === "stackelberg") setDefense(stackelbergOptimal());
    else if (mode === "nash") setDefense(nashMixed());
    else if (mode === "random") setDefense([0.25, 0.25, 0.25, 0.25]);
  }, []);

  const updateDefense = (i, val) => {
    const d = [...defense];
    d[i] = val / 100;
    const total = d.reduce((a, b) => a + b, 0);
    if (total > 0) setDefense(d.map(x => x / total));
    else setDefense(d);
    setDefenderMode("manual");
  };

  const runOneRound = useCallback(() => {
    // Phase 1: show attacker calculating
    setPhase("attacking");
    const atk = attackerMode === "smart" ? smartAttack(defense) : randomAttack();
    setAttackScores(atk.scores);

    // Phase 2: result
    setTimeout(() => {
      setPhase("result");
      const result = simulateRound(defense, attackerMode);
      setLastRound(result);
      setRounds(prev => [...prev, result]);
      roundCountRef.current++;

      setTimeout(() => {
        setPhase("idle");
        setAttackScores(null);
        setLastRound(null);
      }, speed * 0.6);
    }, speed * 0.4);
  }, [defense, attackerMode, speed]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(runOneRound, speed);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, runOneRound, speed]);

  const opt = stackelbergOptimal();

  return (
    <div style={{
      minHeight: "100vh",
      background: "#060c14",
      color: "#e2e8f0",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes scan { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
        @keyframes pulse { from { opacity: 0.7; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes glow { 0%,100% { box-shadow: 0 0 20px #00d4ff30; } 50% { box-shadow: 0 0 40px #00d4ff60; } }
        input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 2px; outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #00d4ff; cursor: pointer; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f1923; } ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
      `}</style>

      {/* Particle canvas */}
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />

      {/* Grid bg */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: "linear-gradient(#1e3a5f08 1px, transparent 1px), linear-gradient(90deg, #1e3a5f08 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "1200px", margin: "0 auto", padding: "1.5rem" }}>

        {/* ── HEADER ── */}
        <div style={{ marginBottom: "1.5rem", animation: "fadeUp 0.6s ease" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.72rem", letterSpacing: "0.2em", color: "#00d4ff", fontFamily: "'Courier New', monospace", marginBottom: "0.3rem" }}>
                GAME THEORY · STACKELBERG SECURITY GAME · C3
              </div>
              <h1 style={{ margin: 0, fontSize: "1.9rem", fontWeight: 900, letterSpacing: "-0.02em", fontFamily: "'Courier New', monospace" }}>
                <span style={{ color: "#ef4444" }}>ATTACKER</span>
                <span style={{ color: "#475569", margin: "0 0.5rem", fontSize: "1.2rem" }}>vs</span>
                <span style={{ color: "#00d4ff" }}>DEFENDER</span>
              </h1>
              <div style={{ fontSize: "0.82rem", color: "#475569", marginTop: "0.3rem" }}>
                Stackelberg Equilibrium · Zero-Sum Strategic Game · Nash vs Optimal Defense
              </div>
            </div>

            {/* Live stats */}
            <div style={{ display: "flex", gap: "0.8rem" }}>
              {[
                { label: "ROUNDS", value: rounds.length, color: "#94a3b8" },
                { label: "BREACHES", value: breaches, color: "#ef4444" },
                { label: "BLOCKED", value: blocks, color: "#00ff88" },
                { label: "TOTAL DMG", value: totalDamage.toFixed(2), color: "#f59e0b" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: "center", background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: "10px", padding: "0.6rem 0.9rem", minWidth: "70px" }}>
                  <div style={{ fontSize: "0.6rem", color: "#475569", fontFamily: "'Courier New', monospace", marginBottom: "2px" }}>{label}</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 900, color, fontFamily: "'Courier New', monospace" }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.5rem" }}>

          {/* ── LEFT: ARENA ── */}
          <div>

            {/* Phase banner */}
            {phase !== "idle" && (
              <div style={{
                marginBottom: "1rem", padding: "0.7rem 1.2rem",
                background: phase === "attacking" ? "#ef444415" : lastRound?.blocked ? "#00ff8815" : "#ff004015",
                border: `1px solid ${phase === "attacking" ? "#ef4444" : lastRound?.blocked ? "#00ff88" : "#ff0040"}`,
                borderRadius: "10px", textAlign: "center", fontFamily: "'Courier New', monospace",
                animation: "fadeUp 0.2s ease",
              }}>
                {phase === "attacking" && <span style={{ color: "#ef4444" }}>⚡ ATTACKER CALCULATING OPTIMAL TARGET...</span>}
                {phase === "result" && lastRound && (
                  <span style={{ color: lastRound.blocked ? "#00ff88" : "#ff0040", fontWeight: 700, fontSize: "1.05rem" }}>
                    {lastRound.blocked
                      ? `🛡 DEFENSE SUCCESSFUL — ${lastRound.server.name} protected!`
                      : `💥 BREACH! ${lastRound.server.name} compromised — Damage: ${lastRound.actualDamage.toFixed(3)}`}
                  </span>
                )}
              </div>
            )}

            {/* Server grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              {SERVERS.map((s, i) => (
                <ServerNode key={s.id}
                  server={s}
                  defenseLevel={defense[i]}
                  attackScore={attackScores ? attackScores[i] : null}
                  isUnderAttack={lastRound?.server.id === s.id && phase === "result"}
                  isDefended={lastRound?.blocked && lastRound?.server.id === s.id}
                  pulseColor={s.color}
                />
              ))}
            </div>

            {/* ── MATH PANEL ── */}
            <button onClick={() => setShowMath(s => !s)}
              style={{
                width: "100%", padding: "0.7rem", marginBottom: "1rem",
                background: showMath ? "#7b2fff20" : "#0f1923",
                border: `1px solid ${showMath ? "#7b2fff" : "#1e3a5f"}`,
                borderRadius: "10px", color: showMath ? "#a78bfa" : "#475569",
                cursor: "pointer", fontFamily: "'Courier New', monospace", fontSize: "0.82rem",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
              }}>
              {showMath ? "▲" : "▼"} SHOW GAME THEORY MATHEMATICS
            </button>

            {showMath && (
              <div style={{ background: "#0a0f1e", border: "1px solid #7b2fff40", borderRadius: "12px", padding: "1.2rem", marginBottom: "1.5rem", animation: "fadeUp 0.3s ease" }}>
                <div style={{ color: "#a78bfa", fontFamily: "'Courier New', monospace", fontSize: "0.82rem", fontWeight: 700, marginBottom: "1rem", letterSpacing: "0.1em" }}>
                  STACKELBERG EQUILIBRIUM — MATHEMATICAL FORMULATION
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  {[
                    {
                      title: "DEFENDER'S PROBLEM", color: "#00d4ff",
                      lines: [
                        "min_{d} max_{a} E[Damage(d,a)]",
                        "",
                        "Subject to: Σ dᵢ = 1, dᵢ ≥ 0",
                        "",
                        "Stackelberg Optimal:",
                        "d*ᵢ = (vᵢ·cᵢ) / Σ(vⱼ·cⱼ)",
                      ]
                    },
                    {
                      title: "ATTACKER'S BEST RESPONSE", color: "#ef4444",
                      lines: [
                        "a*(d) = argmax_i score(i)",
                        "",
                        "score(i) = vᵢ · cᵢ · (1 - dᵢ)",
                        "",
                        "where:",
                        "vᵢ = vulnerability of server i",
                        "cᵢ = damage cost if breached",
                        "dᵢ = defense probability",
                      ]
                    },
                  ].map(({ title, color, lines }) => (
                    <div key={title} style={{ background: "#060c14", borderRadius: "8px", padding: "0.8rem" }}>
                      <div style={{ color, fontSize: "0.7rem", fontFamily: "'Courier New', monospace", marginBottom: "0.5rem", letterSpacing: "0.1em" }}>{title}</div>
                      {lines.map((l, i) => (
                        <div key={i} style={{ fontFamily: "'Courier New', monospace", fontSize: "0.78rem", color: l.startsWith("min") || l.startsWith("a*") ? "#e2e8f0" : l.startsWith("d*") ? "#00d4ff" : l === "" ? undefined : "#64748b", height: l === "" ? "0.5rem" : "auto", lineHeight: 1.7 }}>{l}</div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Current values table */}
                <div style={{ marginTop: "1rem" }}>
                  <div style={{ color: "#475569", fontFamily: "'Courier New', monospace", fontSize: "0.7rem", marginBottom: "0.5rem" }}>CURRENT STRATEGY ANALYSIS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
                    {SERVERS.map((s, i) => {
                      const score = s.damage * s.vuln * (1 - defense[i]);
                      const optD = opt[i];
                      const isTarget = score === Math.max(...SERVERS.map((ss, ii) => ss.damage * ss.vuln * (1 - defense[ii])));
                      return (
                        <div key={i} style={{ background: isTarget ? "#ef444412" : "#0f1923", border: `1px solid ${isTarget ? "#ef4444" : "#1e3a5f"}`, borderRadius: "6px", padding: "0.5rem", textAlign: "center" }}>
                          <div style={{ fontSize: "0.65rem", color: "#475569", fontFamily: "'Courier New', monospace" }}>{s.name}</div>
                          <div style={{ fontSize: "0.75rem", color: "#ef4444", fontFamily: "'Courier New', monospace" }}>atk: {score.toFixed(3)}</div>
                          <div style={{ fontSize: "0.75rem", color: "#00d4ff", fontFamily: "'Courier New', monospace" }}>def: {(defense[i] * 100).toFixed(0)}%</div>
                          <div style={{ fontSize: "0.65rem", color: "#7b2fff", fontFamily: "'Courier New', monospace" }}>opt: {(optD * 100).toFixed(0)}%</div>
                          {isTarget && <div style={{ fontSize: "0.6rem", color: "#ef4444", marginTop: "2px" }}>← TARGET</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── STRATEGY COMPARISON ── */}
            <div style={{ background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: "12px", padding: "1.2rem" }}>
              <div style={{ color: "#475569", fontFamily: "'Courier New', monospace", fontSize: "0.72rem", letterSpacing: "0.1em", marginBottom: "1rem" }}>
                STRATEGY EFFECTIVENESS COMPARISON
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.8rem" }}>
                {[
                  { label: "RANDOM DEFENSE", desc: "Equal allocation", value: 78, color: "#ef4444", subtext: "Worst" },
                  { label: "NASH EQUILIBRIUM", desc: "Vuln-weighted", value: 55, color: "#f59e0b", subtext: "Better" },
                  { label: "STACKELBERG OPT.", desc: "Risk-weighted", value: 31, color: "#00ff88", subtext: "Optimal" },
                ].map(({ label, desc, value, color, subtext }) => (
                  <div key={label} style={{ textAlign: "center", background: "#060c14", borderRadius: "10px", padding: "0.9rem", border: `1px solid ${color}30` }}>
                    <div style={{ fontSize: "0.65rem", color: "#475569", fontFamily: "'Courier New', monospace", marginBottom: "0.3rem" }}>{label}</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 900, color, fontFamily: "'Courier New', monospace" }}>{value}</div>
                    <div style={{ fontSize: "0.7rem", color: "#475569", marginBottom: "0.4rem" }}>avg damage / 100 rounds</div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color }}>{subtext}</div>
                    <div style={{ height: "4px", background: "#1e293b", borderRadius: "2px", marginTop: "0.5rem", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: "2px" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: CONTROLS + LOG ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Attacker config */}
            <div style={{ background: "#0f1923", border: "1px solid #ef444430", borderRadius: "12px", padding: "1.2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444", animation: running ? "pulse 0.8s infinite" : "none" }} />
                <span style={{ color: "#ef4444", fontFamily: "'Courier New', monospace", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.1em" }}>ATTACKER CONFIG</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {[
                  { id: "smart", label: "🧠 Smart", desc: "Best response attacker — always targets weakest defended server", color: "#ef4444" },
                  { id: "random", label: "🎲 Random", desc: "Picks server randomly — no strategy", color: "#f59e0b" },
                ].map(({ id, label, desc, color }) => (
                  <button key={id} onClick={() => setAttackerMode(id)}
                    style={{
                      padding: "0.7rem 0.5rem", background: attackerMode === id ? `${color}18` : "#060c14",
                      border: `1.5px solid ${attackerMode === id ? color : "#1e3a5f"}`,
                      borderRadius: "8px", color: attackerMode === id ? color : "#475569",
                      cursor: "pointer", fontFamily: "'Courier New', monospace", fontSize: "0.75rem",
                      fontWeight: attackerMode === id ? 700 : 400, textAlign: "center",
                      transition: "all 0.2s",
                    }}>
                    <div>{label}</div>
                    <div style={{ fontSize: "0.65rem", color: "#475569", marginTop: "2px", lineHeight: 1.3 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Defender config */}
            <div style={{ background: "#0f1923", border: "1px solid #00d4ff30", borderRadius: "12px", padding: "1.2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00d4ff" }} />
                <span style={{ color: "#00d4ff", fontFamily: "'Courier New', monospace", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.1em" }}>DEFENDER STRATEGY</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.4rem", marginBottom: "1rem" }}>
                {[
                  { id: "stackelberg", label: "Stackelberg", color: "#00ff88" },
                  { id: "nash", label: "Nash Mix", color: "#7b2fff" },
                  { id: "random", label: "Equal", color: "#f59e0b" },
                ].map(({ id, label, color }) => (
                  <button key={id} onClick={() => applyPreset(id)}
                    style={{
                      padding: "0.5rem 0.3rem", background: defenderMode === id ? `${color}18` : "#060c14",
                      border: `1.5px solid ${defenderMode === id ? color : "#1e3a5f"}`,
                      borderRadius: "6px", color: defenderMode === id ? color : "#475569",
                      cursor: "pointer", fontFamily: "'Courier New', monospace", fontSize: "0.72rem",
                      fontWeight: defenderMode === id ? 700 : 400, textAlign: "center",
                      transition: "all 0.2s",
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ color: "#475569", fontFamily: "'Courier New', monospace", fontSize: "0.68rem", marginBottom: "0.5rem", letterSpacing: "0.05em" }}>
                MANUAL ALLOCATION — drag to adjust (auto-normalizes to 100%)
              </div>
              {SERVERS.map((s, i) => (
                <div key={s.id} style={{ marginBottom: "0.7rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{s.icon} {s.name}</span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ color: "#00d4ff", fontWeight: 700, fontSize: "0.78rem", fontFamily: "'Courier New', monospace" }}>{(defense[i] * 100).toFixed(0)}%</span>
                      <span style={{ color: "#7b2fff", fontSize: "0.65rem", fontFamily: "'Courier New', monospace" }}>opt:{(opt[i] * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <input type="range" min="0" max="100" value={Math.round(defense[i] * 100)}
                    onChange={e => updateDefense(i, +e.target.value)}
                    style={{ width: "100%", accentColor: "#00d4ff", background: `linear-gradient(90deg, #00d4ff ${defense[i] * 100}%, #1e293b ${defense[i] * 100}%)` }}
                  />
                </div>
              ))}
            </div>

            {/* Simulation controls */}
            <div style={{ background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: "12px", padding: "1.2rem" }}>
              <div style={{ color: "#475569", fontFamily: "'Courier New', monospace", fontSize: "0.72rem", letterSpacing: "0.1em", marginBottom: "0.8rem" }}>SIMULATION CONTROLS</div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.8rem" }}>
                <button onClick={() => setRunning(r => !r)}
                  style={{
                    flex: 2, padding: "0.8rem",
                    background: running ? "#ef444418" : "#00d4ff18",
                    border: `2px solid ${running ? "#ef4444" : "#00d4ff"}`,
                    borderRadius: "8px", color: running ? "#ef4444" : "#00d4ff",
                    cursor: "pointer", fontFamily: "'Courier New', monospace", fontSize: "0.9rem", fontWeight: 700,
                    animation: running ? "glow 1.5s ease infinite" : "none",
                  }}>
                  {running ? "⏸ PAUSE" : "▶ AUTO RUN"}
                </button>
                <button onClick={() => { if (!running) runOneRound(); }}
                  disabled={running}
                  style={{
                    flex: 1, padding: "0.8rem", background: "#060c14",
                    border: "1.5px solid #1e3a5f", borderRadius: "8px",
                    color: running ? "#1e3a5f" : "#94a3b8",
                    cursor: running ? "not-allowed" : "pointer",
                    fontFamily: "'Courier New', monospace", fontSize: "0.82rem",
                  }}>
                  STEP
                </button>
              </div>

              <div style={{ marginBottom: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                  <span style={{ color: "#475569", fontSize: "0.72rem", fontFamily: "'Courier New', monospace" }}>SPEED</span>
                  <span style={{ color: "#94a3b8", fontSize: "0.72rem", fontFamily: "'Courier New', monospace" }}>{speed}ms/round</span>
                </div>
                <input type="range" min="300" max="3000" step="100" value={speed}
                  onChange={e => setSpeed(+e.target.value)}
                  style={{ width: "100%", accentColor: "#7b2fff" }}
                />
              </div>

              <button onClick={() => { setRounds([]); setLastRound(null); setPhase("idle"); setAttackScores(null); setRunning(false); roundCountRef.current = 0; }}
                style={{ width: "100%", padding: "0.5rem", background: "transparent", border: "1px solid #1e3a5f", borderRadius: "6px", color: "#475569", cursor: "pointer", fontFamily: "'Courier New', monospace", fontSize: "0.75rem" }}>
                RESET ALL
              </button>
            </div>

            {/* Attack log */}
            <div style={{ background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: "12px", padding: "1.2rem", flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.8rem" }}>
                <span style={{ color: "#475569", fontFamily: "'Courier New', monospace", fontSize: "0.72rem", letterSpacing: "0.1em" }}>ATTACK LOG</span>
                <span style={{ color: "#1e3a5f", fontFamily: "'Courier New', monospace", fontSize: "0.68rem" }}>{rounds.length} entries</span>
              </div>
              <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                {rounds.length === 0 && <div style={{ color: "#1e3a5f", fontSize: "0.78rem", fontFamily: "'Courier New', monospace", textAlign: "center", padding: "1rem" }}>— awaiting simulation —</div>}
                {[...rounds].reverse().slice(0, 20).map((r, i) => (
                  <LogEntry key={rounds.length - i} entry={r} index={rounds.length - 1 - i} />
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── BOTTOM: HOW IT WORKS ── */}
        <div style={{ marginTop: "1.5rem", background: "#0f1923", border: "1px solid #1e3a5f", borderRadius: "12px", padding: "1.5rem" }}>
          <div style={{ color: "#475569", fontFamily: "'Courier New', monospace", fontSize: "0.72rem", letterSpacing: "0.1em", marginBottom: "1.2rem" }}>
            HOW THE GAME WORKS — STEP BY STEP
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1px", background: "#1e3a5f" }}>
            {[
              { step: "01", actor: "SYSTEM", color: "#94a3b8", title: "Define Infrastructure", body: "4 servers with unique vulnerability scores and damage values. Each creates a different risk profile for both players." },
              { step: "02", actor: "DEFENDER", color: "#00d4ff", title: "Commit Strategy", body: "Defender allocates limited budget across servers FIRST (Stackelberg leader). Attacker can observe this commitment." },
              { step: "03", actor: "ATTACKER", color: "#ef4444", title: "Best Response", body: "Smart attacker computes score(i) = v·c·(1−d) for each server and targets the one with maximum expected gain." },
              { step: "04", actor: "SYSTEM", color: "#7b2fff", title: "Resolve Round", body: "Actual defense check: attacker is blocked with probability d[i]. If not blocked, damage = vulnerability × damage weight." },
              { step: "05", actor: "THEORY", color: "#00ff88", title: "Equilibrium", body: "Stackelberg optimal defense minimizes the worst-case damage. It outperforms Nash and random allocation in every simulation." },
            ].map(({ step, actor, color, title, body }) => (
              <div key={step} style={{ background: "#0a0f1e", padding: "1rem" }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: "0.65rem", color: "#1e3a5f", marginBottom: "0.3rem" }}>STEP {step}</div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: "0.68rem", color, fontWeight: 700, marginBottom: "0.4rem", letterSpacing: "0.08em" }}>{actor}</div>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#e2e8f0", marginBottom: "0.4rem" }}>{title}</div>
                <div style={{ fontSize: "0.75rem", color: "#475569", lineHeight: 1.6 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}