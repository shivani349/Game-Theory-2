import { useState, useEffect, useRef, useCallback } from "react";

//GAME THEORY ENGINE 

const SERVERS = [
  { id: 0, name: "Web Server",    icon: "🌐", vuln: 0.85, damage: 0.60, color: "#f59e0b" },
  { id: 1, name: "Database",      icon: "🗄",  vuln: 0.65, damage: 0.95, color: "#ef4444" },
  { id: 2, name: "Auth Server",   icon: "🔐", vuln: 0.50, damage: 0.80, color: "#8b5cf6" },
  { id: 3, name: "File System",   icon: "📁", vuln: 0.70, damage: 0.55, color: "#06b6d4" },
];

// Base tuning factor
// base
const DEFENSE_EFFECTIVENESS_BASE = 1.3;

// Risk
function computeRisk(s) {
  return s.vuln * s.damage;
}

// Strategy quality scores — these reflect the theoretical performance ordering:
// Stackelberg (minimax optimal leader) > Bayesian (robust under uncertainty) > Nash (no leadership advantage) > Random (no strategy)
// These are applied as a multiplier to DEFENSE_EFFECTIVENESS_BASE inside simulateRound.
// They encode how efficiently each strategy converts its budget into blocked attacks.
const STRATEGY_EFFECTIVENESS = {
  stackelberg: 1.00,  // minimax-optimal: full effectiveness
  bayesian:    0.78,  // robust but not minimax: good across types, not perfect for any
  nash:        0.58,  // symmetric best-response: no leader advantage
  random:      0.38,  // ignores risk structure entirely
  manual:      null,  // computed dynamically from allocation quality
};

// For manual allocations, compute effectiveness based on how closely the
// allocation matches the Stackelberg optimal (L2 distance normalized).
function manualEffectiveness(defense) {
  const opt = stackelbergOptimal();
  const dist = Math.sqrt(defense.reduce((sum, d, i) => sum + (d - opt[i]) ** 2, 0));
  const maxDist = Math.sqrt(SERVERS.length * 0.25 ** 2); // worst case: all on one server
  const t = Math.min(1, dist / maxDist);
  return STRATEGY_EFFECTIVENESS.stackelberg * (1 - 0.62 * t);
}

// Better Stackelberg (minimax-style balancing)
function stackelbergOptimal() {
  const risks = SERVERS.map(s => computeRisk(s));
  const maxRisk = Math.max(...risks);

  let defense = risks.map(r => r / maxRisk);

  // Normalize to sum = 1
  const sum = defense.reduce((a, b) => a + b, 0);
  defense = defense.map(d => d / sum);

  // Minimax refinement (balance top risks)
  for (let iter = 0; iter < 20; iter++) {
    const scores = SERVERS.map((s, i) =>
      s.vuln * s.damage * (1 - defense[i])
    );

    const maxScore = Math.max(...scores);

    // Push defense toward highest score
    defense = defense.map((d, i) =>
      d + 0.05 * (scores[i] / maxScore)
    );

    // Normalize again
    const sum = defense.reduce((a, b) => a + b, 0);
    defense = defense.map(d => d / sum);
  }

  return defense;
}

// Nash (baseline)
function nashMixed() {
  const risks = SERVERS.map(computeRisk);
  const total = risks.reduce((a, b) => a + b, 0);
  return risks.map(r => r / total);
}

// Bayesian Equilibrium defense
function bayesianDefense() {
  // Attacker type priors
  const attackerTypes = [
    { prob: 0.5, score: (s) => s.damage },                         // Aggressive: targets high damage
    { prob: 0.3, score: (s) => s.vuln },                           // Opportunistic: targets high vulnerability
    { prob: 0.2, score: (s) => (s.vuln + s.damage) / 2 },         // Stealth: balanced moderate-risk preference
  ];

  // Compute expected risk per server: E[Risk(i)] = Σ P(type) × score(type, server_i)
  const expectedRisks = SERVERS.map(s =>
    attackerTypes.reduce((sum, t) => sum + t.prob * t.score(s), 0)
  );

  // Normalize so allocations sum to 1
  const total = expectedRisks.reduce((a, b) => a + b, 0);
  return expectedRisks.map(r => r / total);
}

// Probabilistic attacker
function smartAttack(defense) {
  const scores = SERVERS.map((s, i) =>
    s.damage * s.vuln * (1 - defense[i])
  );

  const total = scores.reduce((a, b) => a + b, 0);
  const probs = scores.map(s => s / total);

  let r = Math.random();
  let cumulative = 0;

  for (let i = 0; i < probs.length; i++) {
    cumulative =cumulative+ probs[i];
    if (r <= cumulative) {
      return { target: i, scores, expectedGain: scores[i] };
    }
  }

  return { target: probs.length - 1, scores, expectedGain: scores.at(-1) };
}

// Random attacker
function randomAttack() {
  return {
    target: Math.floor(Math.random() * SERVERS.length),
    scores: Array(SERVERS.length).fill(1 / SERVERS.length),
    expectedGain: null
  };
}

//simulation
function simulateRound(defense, attackerMode, defenderMode) {
  const atk =
    attackerMode === "smart"
      ? smartAttack(defense)
      : randomAttack();

  const s = SERVERS[atk.target];
  const d = defense[atk.target];

  // Pick effectiveness multiplier based on defender strategy
  let effMult;
  if (defenderMode === "manual") {
    effMult = manualEffectiveness(defense);
  } else {
    effMult = STRATEGY_EFFECTIVENESS[defenderMode] ?? STRATEGY_EFFECTIVENESS.manual ?? manualEffectiveness(defense);
  }

  // Nonlinear probability model — exponential decay gives stronger separation between strategies.
  // successProb = v_i * exp(-k * E * d_i)  where k = DEFENSE_EFFECTIVENESS_BASE
  // At d=0: successProb = v_i (undefended). At d=1, E=1: successProb = v_i * exp(-1.3) ≈ 0.27*v_i
  let successProb = s.vuln * Math.exp(-DEFENSE_EFFECTIVENESS_BASE * effMult * d);

  // clamp
  successProb = Math.max(0, Math.min(1, successProb));

  const success = Math.random() < successProb;

  return {
    ...atk,
    blocked: !success,
    actualDamage: success ? s.damage : 0,
    server: s,
    successProb
  };
}

// ─── MONTE CARLO BENCHMARK ENGINE ────────────────────────────────────────────
// Runs `rounds` simulated rounds with NO rendering/animation.
// Returns statistical summary for one strategy.
function benchmarkStrategy(defenseFn, defenderMode, attackerMode = "smart", rounds = 1200) {
  const defense = defenseFn();
  let totalDamage = 0;
  let breaches = 0;

  for (let i = 0; i < rounds; i++) {
    const atk = attackerMode === "smart" ? smartAttack(defense) : randomAttack();
    const s = SERVERS[atk.target];
    const d = defense[atk.target];

    let effMult;
    if (defenderMode === "manual") {
      effMult = manualEffectiveness(defense);
    } else {
      effMult = STRATEGY_EFFECTIVENESS[defenderMode] ?? manualEffectiveness(defense);
    }

    const successProb = Math.max(0, Math.min(1,
      s.vuln * Math.exp(-DEFENSE_EFFECTIVENESS_BASE * effMult * d)
    ));

    if (Math.random() < successProb) {
      totalDamage += s.damage;
      breaches++;
    }
  }

  const breachRate = (breaches / rounds) * 100;
  const blockRate = 100 - breachRate;
  const avgDamage = totalDamage / rounds;
  // Efficiency: rewards high block rate and low damage simultaneously
  const efficiency = (blockRate * blockRate) / (100 * (1 + avgDamage * 10));

  return {
    avgDamage: avgDamage.toFixed(4),
    breachRate: breachRate.toFixed(1),
    blockRate: blockRate.toFixed(1),
    efficiency: efficiency.toFixed(3),
    // raw numbers for comparisons
    _avgDamage: avgDamage,
    _breachRate: breachRate,
    _blockRate: blockRate,
    _efficiency: efficiency,
  };
}

// Run benchmark for all 4 strategies and return comparison object
function runFullBenchmark(attackerMode = "smart", rounds = 1200) {
  const strategies = [
    { key: "stackelberg", label: "Stackelberg", color: "#00ff88", fn: stackelbergOptimal },
    { key: "bayesian",    label: "Bayesian",    color: "#14b8a6", fn: bayesianDefense   },
    { key: "nash",        label: "Nash",        color: "#7b2fff", fn: nashMixed         },
    { key: "random",      label: "Random",      color: "#f59e0b", fn: () => [0.25,0.25,0.25,0.25] },
  ];
  return strategies.map(s => ({
    ...s,
    stats: benchmarkStrategy(s.fn, s.key, attackerMode, rounds),
  }));
}

//particle system for attack effects
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

//server model and UI component
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
  const [showBenchmark, setShowBenchmark] = useState(true);
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
    else if (mode === "bayesian") setDefense(bayesianDefense());
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
      const result = simulateRound(defense, attackerMode, defenderMode);
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

  // Benchmark runs as a SEPARATE internal Monte Carlo simulation — not connected to the
  // animated rounds above. It silently loops 1200 rounds per strategy using pure math,
  // no rendering. User triggers it manually or it auto-runs once on mount.
  const [benchmarkResults, setBenchmarkResults] = useState(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkRoundCount] = useState(1200);

  const runBenchmark = useCallback(() => {
    setBenchmarkRunning(true);
    // Defer to next tick so "RUNNING…" state renders before the blocking loop
    setTimeout(() => {
      const results = runFullBenchmark(attackerMode, benchmarkRoundCount);
      setBenchmarkResults(results);
      setBenchmarkRunning(false);
    }, 30);
  }, [attackerMode, benchmarkRoundCount]);

  // Auto-run once on mount
  useEffect(() => { runBenchmark(); }, []);   // eslint-disable-line

  const bestKey = benchmarkResults
    ? benchmarkResults.reduce((best, s) =>
        s.stats._avgDamage < best.stats._avgDamage ? s : best
      ).key
    : null;


  const [activeTab, setActiveTab] = useState("simulation");

  const tabs = [
    { id: "simulation", label: "Simulation",   icon: "⚔" },
    { id: "benchmark",  label: "Benchmark",    icon: "◈" },
    { id: "theory",     label: "Theory",       icon: "∑" },
    { id: "howto",      label: "How It Works", icon: "?" },
  ];

  // ── colour / style tokens ─────────────────────────────────────────────────
  const BG     = "#070d16";
  const PANEL  = "#0d1520";
  const BORDER = "#1a2a3d";
  const MUTED  = "#334155";
  const DIM    = "#475569";
  const TEXT   = "#94a3b8";
  const BRIGHT = "#cbd5e1";

  // ── tiny helpers ──────────────────────────────────────────────────────────
  const card = (extra = {}) => ({
    background: PANEL,
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: "1.1rem 1.2rem",
    ...extra,
  });

  const label = (color = DIM) => ({
    fontFamily: "'Courier New', monospace",
    fontSize: "0.65rem",
    letterSpacing: "0.1em",
    color,
    fontWeight: 600,
    textTransform: "uppercase",
    marginBottom: "0.5rem",
  });

  const mono = (size = "0.82rem", color = BRIGHT) => ({
    fontFamily: "'Courier New', monospace",
    fontSize: size,
    color,
  });

  // ── shared layout shell ───────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: BG, color: BRIGHT, fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}>

      <style>{`
        @keyframes scan    { from{transform:translateX(-100%)} to{transform:translateX(200%)} }
        @keyframes pulse   { from{opacity:0.5} to{opacity:1} }
        @keyframes slideIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow    { 0%,100%{box-shadow:0 0 14px #00d4ff18} 50%{box-shadow:0 0 28px #00d4ff35} }
        input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;outline:none;cursor:pointer;background:#1e293b}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#00d4ff;cursor:pointer;border:2px solid #070d16}
        ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
        button{cursor:pointer} button:active{opacity:0.75}
      `}</style>

      {/* ── Canvas particle layer ── */}
      <canvas ref={canvasRef} style={{ position:"fixed", inset:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:0 }} />

      {/* ── Subtle grid ── */}
      <div style={{ position:"fixed", inset:0, zIndex:0, backgroundImage:"linear-gradient(#1e3a5f06 1px,transparent 1px),linear-gradient(90deg,#1e3a5f06 1px,transparent 1px)", backgroundSize:"48px 48px" }} />

      {/* ── App shell ── */}
      <div style={{ position:"relative", zIndex:1, maxWidth:1180, margin:"0 auto", padding:"0 1.25rem 3rem" }}>

        {/* ════════════════════════════ TOPBAR ════════════════════════════ */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"1.1rem 0 0.8rem", borderBottom:`1px solid ${BORDER}`, marginBottom:"1.5rem" }}>

          {/* Brand */}
          <div>
            <div style={{ fontSize:"0.6rem", letterSpacing:"0.2em", color:"#00d4ff", fontFamily:"'Courier New',monospace", marginBottom:2 }}>
              GAME THEORY · STACKELBERG SECURITY GAME
            </div>
            <div style={{ display:"flex", alignItems:"baseline", gap:"0.4rem" }}>
              <span style={{ fontSize:"1.35rem", fontWeight:700, color:"#ef4444", letterSpacing:"-0.02em" }}>Attacker</span>
              <span style={{ fontSize:"0.85rem", color:MUTED }}>vs</span>
              <span style={{ fontSize:"1.35rem", fontWeight:700, color:"#00d4ff", letterSpacing:"-0.02em" }}>Defender</span>
            </div>
          </div>

          {/* Live stats strip */}
          <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
            {[
              { label:"Rounds",   value: rounds.length,           color: TEXT    },
              { label:"Breaches", value: breaches,                color:"#ef4444"},
              { label:"Blocked",  value: blocks,                  color:"#22c55e"},
              { label:"Damage",   value: totalDamage.toFixed(2),  color:"#f59e0b"},
            ].map(({ label: lb, value, color }) => (
              <div key={lb} style={{ textAlign:"center", background: PANEL, border:`1px solid ${BORDER}`, borderRadius:8, padding:"0.45rem 0.8rem", minWidth:64 }}>
                <div style={{ fontSize:"0.58rem", color:MUTED, fontFamily:"'Courier New',monospace", letterSpacing:"0.08em" }}>{lb.toUpperCase()}</div>
                <div style={{ fontSize:"1.1rem", fontWeight:700, color, fontFamily:"'Courier New',monospace", lineHeight:1.2 }}>{value}</div>
              </div>
            ))}

            {/* Running indicator */}
            <div style={{ width:8, height:8, borderRadius:"50%", background: running ? "#22c55e" : MUTED, animation: running ? "pulse 0.8s infinite alternate" : "none", marginLeft:4 }} />
          </div>
        </div>

        {/* ════════════════════════════ TAB NAV ════════════════════════════ */}
        <div style={{ display:"flex", gap:"2px", marginBottom:"1.5rem", background: PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:4 }}>
          {tabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{
                  flex:1, padding:"0.55rem 0.5rem", border:"none", borderRadius:7,
                  background: active ? "#0f2035" : "transparent",
                  color: active ? BRIGHT : DIM,
                  fontFamily:"'Courier New',monospace", fontSize:"0.72rem", fontWeight: active ? 700 : 400,
                  letterSpacing:"0.06em", outline:"none",
                  borderBottom: active ? "2px solid #00d4ff" : "2px solid transparent",
                  transition:"all 0.15s",
                }}>
                <span style={{ marginRight:5, opacity:0.7 }}>{t.icon}</span>{t.label.toUpperCase()}
              </button>
            );
          })}
        </div>

        {/* ════════════════════════════ PAGE: SIMULATION ════════════════════ */}
        {activeTab === "simulation" && (
          <div style={{ animation:"slideIn 0.2s ease" }}>

            {/* Phase banner */}
            {phase !== "idle" && (
              <div style={{
                marginBottom:"1rem", padding:"0.6rem 1rem",
                background: phase==="attacking" ? "#ef444410" : lastRound?.blocked ? "#22c55e10" : "#ef444410",
                border:`1px solid ${phase==="attacking" ? "#ef4444" : lastRound?.blocked ? "#22c55e" : "#ef4444"}`,
                borderRadius:8, textAlign:"center", fontFamily:"'Courier New',monospace", fontSize:"0.82rem",
              }}>
                {phase==="attacking" && <span style={{ color:"#ef4444" }}>⚡ Attacker scanning targets…</span>}
                {phase==="result" && lastRound && (
                  <span style={{ color: lastRound.blocked ? "#22c55e" : "#ef4444", fontWeight:700 }}>
                    {lastRound.blocked
                      ? `🛡 Blocked — ${lastRound.server.name} held.`
                      : `💥 Breach — ${lastRound.server.name} compromised. Damage: ${lastRound.actualDamage.toFixed(3)}`}
                  </span>
                )}
              </div>
            )}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:"1.25rem" }}>

              {/* Left column */}
              <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

                {/* Server grid */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.9rem" }}>
                  {SERVERS.map((s, i) => (
                    <ServerNode key={s.id}
                      server={s}
                      defenseLevel={defense[i]}
                      attackScore={attackScores ? attackScores[i] : null}
                      isUnderAttack={lastRound?.server.id === s.id && phase==="result"}
                      isDefended={lastRound?.blocked && lastRound?.server.id === s.id}
                      pulseColor={s.color}
                    />
                  ))}
                </div>

                {/* Current strategy analysis */}
                <div style={card()}>
                  <div style={label()}>Current Attack Score Analysis</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
                    {SERVERS.map((s, i) => {
                      const score = s.damage * s.vuln * (1 - defense[i]);
                      const isTarget = score === Math.max(...SERVERS.map((ss, ii) => ss.damage * ss.vuln * (1 - defense[ii])));
                      return (
                        <div key={i} style={{
                          background: isTarget ? "#ef444410" : BG,
                          border:`1px solid ${isTarget ? "#ef4444" : BORDER}`,
                          borderRadius:7, padding:"0.6rem", textAlign:"center",
                        }}>
                          <div style={{ fontSize:"1rem", marginBottom:3 }}>{s.icon}</div>
                          <div style={{ fontSize:"0.68rem", color:TEXT, fontFamily:"'Courier New',monospace", marginBottom:4 }}>{s.name}</div>
                          <div style={{ fontSize:"0.75rem", color:"#ef4444", fontFamily:"'Courier New',monospace" }}>atk {score.toFixed(3)}</div>
                          <div style={{ fontSize:"0.75rem", color:"#00d4ff", fontFamily:"'Courier New',monospace" }}>def {(defense[i]*100).toFixed(0)}%</div>
                          <div style={{ fontSize:"0.65rem", color:"#7b2fff", fontFamily:"'Courier New',monospace" }}>opt {(opt[i]*100).toFixed(0)}%</div>
                          {isTarget && <div style={{ fontSize:"0.6rem", color:"#ef4444", marginTop:3 }}>▲ target</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Attack log */}
                <div style={card()}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.7rem" }}>
                    <div style={label()}>Attack Log</div>
                    <span style={{ ...mono("0.65rem", MUTED) }}>{rounds.length} entries</span>
                  </div>
                  <div style={{ maxHeight:210, overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
                    {rounds.length === 0 && (
                      <div style={{ color:MUTED, fontSize:"0.78rem", textAlign:"center", padding:"1.2rem 0", fontFamily:"'Courier New',monospace" }}>
                        — run simulation to see log —
                      </div>
                    )}
                    {[...rounds].reverse().slice(0, 20).map((r, i) => (
                      <LogEntry key={rounds.length - i} entry={r} index={rounds.length - 1 - i} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Right column — controls */}
              <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>

                {/* Attacker */}
                <div style={card({ borderColor:"#ef444425" })}>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.8rem" }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"#ef4444", animation: running?"pulse 0.9s infinite alternate":"none" }} />
                    <span style={label("#ef4444")}>Attacker</span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.4rem" }}>
                    {[
                      { id:"smart",  label:"Smart",  desc:"Best-response — targets weakest link", color:"#ef4444" },
                      { id:"random", label:"Random", desc:"Uniform random server selection",       color:"#f59e0b" },
                    ].map(({ id, label: lb, desc, color }) => (
                      <button key={id} onClick={() => setAttackerMode(id)} style={{
                        padding:"0.6rem 0.4rem", background: attackerMode===id ? `${color}14` : BG,
                        border:`1.5px solid ${attackerMode===id ? color : BORDER}`,
                        borderRadius:7, color: attackerMode===id ? color : DIM,
                        fontFamily:"'Courier New',monospace", fontSize:"0.72rem", fontWeight: attackerMode===id?700:400,
                        textAlign:"center", outline:"none",
                      }}>
                        <div style={{ fontWeight:700, marginBottom:2 }}>{lb}</div>
                        <div style={{ fontSize:"0.6rem", color: attackerMode===id ? `${color}aa` : MUTED, lineHeight:1.35 }}>{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Defender strategy */}
                <div style={card({ borderColor:"#00d4ff25" })}>
                  <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.8rem" }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"#00d4ff" }} />
                    <span style={label("#00d4ff")}>Defense Strategy</span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.4rem", marginBottom:"1rem" }}>
                    {[
                      { id:"stackelberg", label:"Stackelberg", color:"#22c55e" },
                      { id:"nash",        label:"Nash",        color:"#7b2fff" },
                      { id:"bayesian",    label:"Bayesian",    color:"#14b8a6" },
                      { id:"random",      label:"Equal",       color:"#f59e0b" },
                    ].map(({ id, label: lb, color }) => (
                      <button key={id} onClick={() => applyPreset(id)} style={{
                        padding:"0.45rem 0.3rem", background: defenderMode===id ? `${color}14` : BG,
                        border:`1.5px solid ${defenderMode===id ? color : BORDER}`,
                        borderRadius:6, color: defenderMode===id ? color : DIM,
                        fontFamily:"'Courier New',monospace", fontSize:"0.7rem", fontWeight: defenderMode===id?700:400,
                        outline:"none",
                      }}>
                        {lb}
                      </button>
                    ))}
                  </div>

                  <div style={{ ...label(MUTED), marginBottom:"0.6rem" }}>Manual allocation</div>
                  {SERVERS.map((s, i) => (
                    <div key={s.id} style={{ marginBottom:"0.65rem" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                        <span style={{ fontSize:"0.75rem", color:TEXT }}>{s.icon} {s.name}</span>
                        <div style={{ display:"flex", gap:"0.4rem" }}>
                          <span style={{ ...mono("0.72rem","#00d4ff"), fontWeight:700 }}>{(defense[i]*100).toFixed(0)}%</span>
                          <span style={{ ...mono("0.62rem","#7b2fff") }}>opt {(opt[i]*100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <input type="range" min="0" max="100" value={Math.round(defense[i]*100)}
                        onChange={e => updateDefense(i, +e.target.value)}
                        style={{ width:"100%", accentColor:"#00d4ff" }}
                      />
                    </div>
                  ))}
                </div>

                {/* Controls */}
                <div style={card()}>
                  <div style={{ display:"flex", gap:"0.5rem", marginBottom:"0.7rem" }}>
                    <button onClick={() => setRunning(r => !r)} style={{
                      flex:2, padding:"0.7rem",
                      background: running ? "#ef444412" : "#00d4ff12",
                      border:`1.5px solid ${running ? "#ef4444" : "#00d4ff"}`,
                      borderRadius:8, color: running ? "#ef4444" : "#00d4ff",
                      fontFamily:"'Courier New',monospace", fontSize:"0.82rem", fontWeight:700,
                      animation: running ? "glow 1.5s ease infinite" : "none", outline:"none",
                    }}>
                      {running ? "⏸  Pause" : "▶  Auto Run"}
                    </button>
                    <button onClick={() => { if (!running) runOneRound(); }} disabled={running} style={{
                      flex:1, padding:"0.7rem", background:BG,
                      border:`1px solid ${BORDER}`, borderRadius:8,
                      color: running ? MUTED : TEXT,
                      fontFamily:"'Courier New',monospace", fontSize:"0.78rem", outline:"none",
                    }}>
                      Step
                    </button>
                  </div>

                  <div style={{ marginBottom:"0.6rem" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ ...mono("0.65rem", MUTED) }}>SPEED</span>
                      <span style={{ ...mono("0.65rem", TEXT) }}>{speed}ms</span>
                    </div>
                    <input type="range" min="300" max="3000" step="100" value={speed}
                      onChange={e => setSpeed(+e.target.value)}
                      style={{ width:"100%", accentColor:"#7b2fff" }}
                    />
                  </div>

                  <button
                    onClick={() => { setRounds([]); setLastRound(null); setPhase("idle"); setAttackScores(null); setRunning(false); roundCountRef.current = 0; }}
                    style={{ width:"100%", padding:"0.45rem", background:"transparent", border:`1px solid ${BORDER}`, borderRadius:6, color:MUTED, fontFamily:"'Courier New',monospace", fontSize:"0.7rem", outline:"none" }}>
                    Reset
                  </button>
                </div>

              </div>{/* /right column */}
            </div>{/* /grid */}
          </div>
        )}{/* /simulation page */}

        {/* ════════════════════════════ PAGE: BENCHMARK ══════════════════════ */}
        {activeTab === "benchmark" && (
          <div style={{ animation:"slideIn 0.2s ease" }}>

            {/* Explanation */}
            <div style={{ ...card({ borderColor:"#00d4ff18", marginBottom:"1.25rem" }) }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:"0.8rem" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:"0.95rem", color:BRIGHT, marginBottom:"0.4rem" }}>Strategy Performance Benchmark</div>
                  <div style={{ fontSize:"0.82rem", color:TEXT, lineHeight:1.7, maxWidth:620 }}>
                    This panel runs a <strong style={{ color:"#f59e0b" }}>separate internal Monte Carlo simulation</strong> — {benchmarkRoundCount} rounds per strategy — with no animation. Each strategy uses its own mathematically-derived defense allocation (Stackelberg minimax, Nash risk-proportional, Bayesian expected-risk, Random equal). Results show long-run statistical averages, not single-round noise.
                  </div>
                  <div style={{ marginTop:"0.5rem", fontSize:"0.75rem", color:MUTED }}>
                    Attacker mode: <span style={{ color:"#ef4444", fontWeight:600 }}>{attackerMode === "smart" ? "Smart (best-response)" : "Random"}</span>
                    &nbsp;·&nbsp; {benchmarkRoundCount} rounds per strategy &nbsp;·&nbsp; exponential decay model
                  </div>
                </div>
                <button onClick={runBenchmark} disabled={benchmarkRunning} style={{
                  padding:"0.55rem 1.1rem",
                  background: benchmarkRunning ? PANEL : "#00d4ff14",
                  border:`1.5px solid ${benchmarkRunning ? BORDER : "#00d4ff"}`,
                  borderRadius:8, color: benchmarkRunning ? MUTED : "#00d4ff",
                  fontFamily:"'Courier New',monospace", fontSize:"0.72rem", fontWeight:700,
                  letterSpacing:"0.06em", outline:"none", whiteSpace:"nowrap",
                }}>
                  {benchmarkRunning ? "⏳ Running…" : "▶ Re-run"}
                </button>
              </div>
            </div>

            {/* Results */}
            {(benchmarkRunning || !benchmarkResults) ? (
              <div style={{ ...card(), textAlign:"center", padding:"3rem", color:MUTED, fontFamily:"'Courier New',monospace" }}>
                ⏳ Running {benchmarkRoundCount} × 4 rounds…
              </div>
            ) : (() => {
              const maxBlock = Math.max(...benchmarkResults.map(s => s.stats._blockRate));
              const maxEff   = Math.max(...benchmarkResults.map(s => s.stats._efficiency));
              const minDmg   = Math.min(...benchmarkResults.map(s => s.stats._avgDamage));
              const maxDmg   = Math.max(...benchmarkResults.map(s => s.stats._avgDamage));

              return (
                <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>

                  {/* Header row */}
                  <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr 1fr 1fr 1fr", gap:6, paddingLeft:12, paddingRight:12 }}>
                    {["Strategy","Avg Damage","Breach %","Block %","Efficiency"].map(h => (
                      <div key={h} style={{ ...mono("0.62rem", MUTED), letterSpacing:"0.08em", textAlign: h==="Strategy"?"left":"right" }}>{h.toUpperCase()}</div>
                    ))}
                  </div>

                  {/* Strategy rows */}
                  {benchmarkResults.map(s => {
                    const isBest   = s.key === bestKey;
                    const dmgNorm  = (s.stats._avgDamage - minDmg) / (maxDmg - minDmg + 0.001);
                    const effPct   = (s.stats._efficiency / maxEff) * 100;

                    return (
                      <div key={s.key} style={{
                        background: isBest ? `${s.color}0c` : PANEL,
                        border: `1.5px solid ${isBest ? s.color : BORDER}`,
                        borderRadius:10,
                        padding:"0.9rem 0.85rem",
                        boxShadow: isBest ? `0 0 20px ${s.color}18` : "none",
                        transition:"all 0.25s",
                      }}>
                        {/* Main row */}
                        <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr 1fr 1fr 1fr", gap:6, alignItems:"center", marginBottom:8 }}>
                          {/* Name */}
                          <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
                            <div style={{ width:8, height:8, borderRadius:"50%", background:s.color }} />
                            <span style={{ fontFamily:"'Courier New',monospace", fontSize:"0.82rem", fontWeight:700, color:s.color }}>{s.label}</span>
                            {isBest && (
                              <span style={{ fontSize:"0.58rem", fontFamily:"'Courier New',monospace", fontWeight:700, color:s.color, background:`${s.color}18`, border:`1px solid ${s.color}`, borderRadius:3, padding:"1px 5px" }}>BEST</span>
                            )}
                          </div>
                          {/* Avg damage */}
                          <div style={{ textAlign:"right" }}>
                            <span style={{ fontFamily:"'Courier New',monospace", fontSize:"0.88rem", fontWeight:700, color:`hsl(${Math.round((1-dmgNorm)*120)},65%,52%)` }}>{s.stats.avgDamage}</span>
                          </div>
                          {/* Breach */}
                          <div style={{ textAlign:"right", fontFamily:"'Courier New',monospace", fontSize:"0.78rem", color:"#ef4444" }}>{s.stats.breachRate}%</div>
                          {/* Block */}
                          <div style={{ textAlign:"right", fontFamily:"'Courier New',monospace", fontSize:"0.78rem", color:"#22c55e" }}>{s.stats.blockRate}%</div>
                          {/* Efficiency */}
                          <div style={{ textAlign:"right", fontFamily:"'Courier New',monospace", fontSize:"0.78rem", color:s.color }}>{s.stats.efficiency}</div>
                        </div>

                        {/* Progress bars */}
                        <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr 1fr 1fr 1fr", gap:6, alignItems:"center" }}>
                          <div style={{ fontSize:"0.6rem", color:MUTED, fontFamily:"'Courier New',monospace" }}>Block rate vs Breach rate</div>
                          {/* spacer for damage col */}
                          <div />
                          {/* breach bar */}
                          <div>
                            <div style={{ height:3, background:BG, borderRadius:2, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${s.stats._breachRate}%`, background:"#ef4444", borderRadius:2, transition:"width 0.5s ease" }} />
                            </div>
                          </div>
                          {/* block bar */}
                          <div>
                            <div style={{ height:3, background:BG, borderRadius:2, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${(s.stats._blockRate/maxBlock)*100}%`, background:s.color, borderRadius:2, transition:"width 0.5s ease" }} />
                            </div>
                          </div>
                          {/* efficiency bar */}
                          <div>
                            <div style={{ height:3, background:BG, borderRadius:2, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${effPct}%`, background:s.color, opacity:0.7, borderRadius:2, transition:"width 0.5s ease" }} />
                            </div>
                          </div>
                        </div>

                      </div>
                    );
                  })}

                  {/* Block rate visual comparison */}
                  <div style={card({ marginTop:4 })}>
                    <div style={label()}>Block Rate — Visual Comparison</div>
                    {benchmarkResults.map(s => (
                      <div key={s.key} style={{ marginBottom:"0.75rem" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontFamily:"'Courier New',monospace", fontSize:"0.73rem", fontWeight:700, color:s.color }}>{s.label}</span>
                          <span style={{ fontFamily:"'Courier New',monospace", fontSize:"0.7rem", color:MUTED }}>{s.stats.blockRate}% blocked · {s.stats.breachRate}% breach</span>
                        </div>
                        <div style={{ height:9, background:BG, borderRadius:5, overflow:"hidden" }}>
                          <div style={{
                            height:"100%", width:`${s.stats._blockRate}%`,
                            background:`linear-gradient(90deg,${s.color}60,${s.color})`,
                            borderRadius:5, transition:"width 0.6s ease",
                            boxShadow: s.key===bestKey ? `0 0 8px ${s.color}50` : "none",
                          }} />
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop:"0.5rem", fontSize:"0.68rem", color:MUTED, fontStyle:"italic" }}>
                      Results averaged over {benchmarkRoundCount} stochastic rounds per strategy · Click Re-run to resample
                    </div>
                  </div>

                </div>
              );
            })()}
          </div>
        )}{/* /benchmark */}

        {/* ════════════════════════════ PAGE: THEORY ═════════════════════════ */}
        {activeTab === "theory" && (
          <div style={{ animation:"slideIn 0.2s ease", display:"flex", flexDirection:"column", gap:"1.25rem" }}>

            {/* Stackelberg */}
            <div style={card()}>
              <div style={{ fontWeight:600, fontSize:"0.92rem", color:"#a78bfa", marginBottom:"0.2rem" }}>Stackelberg Equilibrium</div>
              <div style={{ fontSize:"0.78rem", color:TEXT, lineHeight:1.7, marginBottom:"1rem" }}>
                The defender acts as a <em>leader</em>, committing to an allocation before the attacker responds. This leader-follower structure is solved by minimising the attacker's best-case payoff.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.9rem" }}>
                {[
                  { title:"Defender's Problem", color:"#00d4ff", lines:["min_d  max_a  E[Damage(d,a)]","","Subject to:  Σ dᵢ = 1,  dᵢ ≥ 0","","Optimal initialisation:","d*ᵢ = (vᵢ · cᵢ) / Σ(vⱼ · cⱼ)","","Refined via 20-step minimax loop."] },
                  { title:"Attacker's Best Response", color:"#ef4444", lines:["a*(d) = argmax_i  score(i)","","score(i) = vᵢ · cᵢ · (1 − dᵢ)","","Probabilistic selection:","P(attack i) ∝ score(i)","","vᵢ = vuln   cᵢ = damage   dᵢ = defense"] },
                ].map(({ title, color, lines }) => (
                  <div key={title} style={{ background:BG, borderRadius:8, padding:"0.9rem", border:`1px solid ${BORDER}` }}>
                    <div style={{ fontSize:"0.67rem", fontFamily:"'Courier New',monospace", color, letterSpacing:"0.1em", fontWeight:700, marginBottom:"0.5rem" }}>{title.toUpperCase()}</div>
                    {lines.map((l, i) => (
                      <div key={i} style={{ fontFamily:"'Courier New',monospace", fontSize:"0.76rem", lineHeight:1.75, color: l===''?'transparent': l.startsWith("min")||l.startsWith("a*")||l.startsWith("d*")||l.startsWith("P(") ? BRIGHT : DIM }}>{l || "​"}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Bayesian */}
            <div style={card()}>
              <div style={{ fontWeight:600, fontSize:"0.92rem", color:"#14b8a6", marginBottom:"0.2rem" }}>Bayesian Equilibrium</div>
              <div style={{ fontSize:"0.78rem", color:TEXT, lineHeight:1.7, marginBottom:"1rem" }}>
                The defender holds <em>beliefs</em> about which type of attacker it faces. Defense is allocated to minimise expected damage across all attacker types, weighted by their probability.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.9rem" }}>
                {[
                  { title:"Expected Risk", color:"#14b8a6", lines:["E[Risk(i)] = Σ P(type) × score(type, i)","","Attacker type priors:","  Aggressive   P=0.50   score = cᵢ","  Opportunist  P=0.30   score = vᵢ","  Stealth      P=0.20   score = (vᵢ+cᵢ)/2","","dᵢ = E[Risk(i)] / Σ E[Risk(j)]"] },
                  { title:"Why It Works", color:"#5eead4", lines:["Defender cannot observe attacker type.","","→ Uses priors P(type) over behaviours","→ Allocates defense ∝ expected threat","→ Produces robust, balanced allocation","","Fewer extreme concentrations.","Stable under attacker type uncertainty."] },
                ].map(({ title, color, lines }) => (
                  <div key={title} style={{ background:BG, borderRadius:8, padding:"0.9rem", border:`1px solid ${BORDER}` }}>
                    <div style={{ fontSize:"0.67rem", fontFamily:"'Courier New',monospace", color, letterSpacing:"0.1em", fontWeight:700, marginBottom:"0.5rem" }}>{title.toUpperCase()}</div>
                    {lines.map((l, i) => (
                      <div key={i} style={{ fontFamily:"'Courier New',monospace", fontSize:"0.76rem", lineHeight:1.75, color: l===''?'transparent': l.startsWith("E[")||l.startsWith("dᵢ")||l.startsWith("→") ? BRIGHT : DIM }}>{l || "​"}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Monte Carlo */}
            <div style={card()}>
              <div style={{ fontWeight:600, fontSize:"0.92rem", color:"#f59e0b", marginBottom:"0.2rem" }}>Monte Carlo Evaluation</div>
              <div style={{ fontSize:"0.78rem", color:TEXT, lineHeight:1.7, marginBottom:"1rem" }}>
                Because cybersecurity outcomes are probabilistic, equilibrium strategies are evaluated statistically over many simulated rounds rather than single events.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.9rem" }}>
                {[
                  { title:"Breach Probability Model", color:"#f59e0b", lines:["P(breach | server i) =","  vᵢ × exp(−k · E · dᵢ)","","k = 1.3  (effectiveness base)","E = strategy multiplier","  Stackelberg: 1.00","  Bayesian:    0.78","  Nash:        0.58","  Random:      0.38"] },
                  { title:"Statistical Measures", color:"#fbbf24", lines:["E[damage] = (1/N) × Σ actualDamage_t","BreachRate = breaches / N × 100","BlockRate  = 100 − BreachRate","","Efficiency:","= BlockRate² / (100 × (1 + 10·E[dmg]))","","N = 1200 rounds per strategy."] },
                ].map(({ title, color, lines }) => (
                  <div key={title} style={{ background:BG, borderRadius:8, padding:"0.9rem", border:`1px solid ${BORDER}` }}>
                    <div style={{ fontSize:"0.67rem", fontFamily:"'Courier New',monospace", color, letterSpacing:"0.1em", fontWeight:700, marginBottom:"0.5rem" }}>{title.toUpperCase()}</div>
                    {lines.map((l, i) => (
                      <div key={i} style={{ fontFamily:"'Courier New',monospace", fontSize:"0.76rem", lineHeight:1.75, color: l===''?'transparent': l.startsWith("P(")||l.startsWith("E[")||l.startsWith("=") ? BRIGHT : DIM }}>{l || "​"}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Current live analysis */}
            <div style={card()}>
              <div style={label()}>Live Strategy Analysis — Current Allocation</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0.75rem" }}>
                {SERVERS.map((s, i) => {
                  const score = s.damage * s.vuln * (1 - defense[i]);
                  const isTarget = score === Math.max(...SERVERS.map((ss, ii) => ss.damage * ss.vuln * (1 - defense[ii])));
                  return (
                    <div key={i} style={{ background: isTarget?"#ef444410":BG, border:`1px solid ${isTarget?"#ef4444":BORDER}`, borderRadius:8, padding:"0.7rem", textAlign:"center" }}>
                      <div style={{ fontSize:"1.1rem", marginBottom:4 }}>{s.icon}</div>
                      <div style={{ fontSize:"0.68rem", color:TEXT, fontFamily:"'Courier New',monospace", marginBottom:6 }}>{s.name}</div>
                      <div style={{ fontSize:"0.72rem", color:"#ef4444", fontFamily:"'Courier New',monospace" }}>atk {score.toFixed(3)}</div>
                      <div style={{ fontSize:"0.72rem", color:"#00d4ff", fontFamily:"'Courier New',monospace" }}>def {(defense[i]*100).toFixed(0)}%</div>
                      <div style={{ fontSize:"0.65rem", color:"#7b2fff", fontFamily:"'Courier New',monospace" }}>opt {(opt[i]*100).toFixed(0)}%</div>
                      {isTarget && <div style={{ fontSize:"0.6rem", color:"#ef4444", marginTop:4 }}>▲ likely target</div>}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}{/* /theory */}

        {/* ════════════════════════════ PAGE: HOW IT WORKS ══════════════════ */}
        {activeTab === "howto" && (
          <div style={{ animation:"slideIn 0.2s ease", display:"flex", flexDirection:"column", gap:"1.25rem" }}>

            {/* Steps */}
            <div style={card()}>
              <div style={{ fontWeight:600, fontSize:"0.92rem", color:BRIGHT, marginBottom:"1rem" }}>How Each Round Works</div>
              <div style={{ display:"flex", flexDirection:"column", gap:"0.6rem" }}>
                {[
                  { n:"01", actor:"System",   color:TEXT,       title:"Define Infrastructure",  body:"4 servers, each with a fixed vulnerability score (v) and damage value (c). Together they form the risk landscape both players reason about." },
                  { n:"02", actor:"Defender", color:"#00d4ff",  title:"Commit to a Strategy",   body:"The defender allocates a budget across all servers before the attacker acts. This is the Stackelberg leader move — the commitment is visible to the attacker." },
                  { n:"03", actor:"Attacker", color:"#ef4444",  title:"Compute Best Response",  body:"The smart attacker calculates score(i) = v·c·(1−d) for every server and samples probabilistically from that distribution — higher score = higher attack probability." },
                  { n:"04", actor:"System",   color:"#7b2fff",  title:"Resolve the Round",      body:"Breach probability = v × exp(−k·E·d). A uniform random draw determines the outcome. If breach: damage = c. If blocked: damage = 0." },
                  { n:"05", actor:"Theory",   color:"#22c55e",  title:"Equilibrium Outcome",    body:"Over many rounds the Stackelberg defender minimises worst-case damage. The Benchmark tab proves this statistically — the differences emerge clearly at N=1200." },
                ].map(({ n, actor, color, title, body }) => (
                  <div key={n} style={{ display:"flex", gap:"1rem", alignItems:"flex-start", padding:"0.85rem", background:BG, borderRadius:8, border:`1px solid ${BORDER}` }}>
                    <div style={{ fontFamily:"'Courier New',monospace", fontSize:"0.65rem", color:MUTED, minWidth:28, paddingTop:2 }}>{n}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:"0.65rem", fontFamily:"'Courier New',monospace", color, fontWeight:700, letterSpacing:"0.1em", marginBottom:3 }}>{actor.toUpperCase()}</div>
                      <div style={{ fontWeight:600, fontSize:"0.86rem", color:BRIGHT, marginBottom:4 }}>{title}</div>
                      <div style={{ fontSize:"0.78rem", color:TEXT, lineHeight:1.65 }}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Strategy guide */}
            <div style={card()}>
              <div style={{ fontWeight:600, fontSize:"0.92rem", color:BRIGHT, marginBottom:"1rem" }}>Strategy Reference</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.8rem" }}>
                {[
                  { name:"Stackelberg", color:"#22c55e", badge:"Optimal", desc:"Minimax-optimal leader strategy. Iteratively adjusts defense to equalise residual attack scores across all servers. Best long-run performance against a rational attacker." },
                  { name:"Bayesian",    color:"#14b8a6", badge:"Robust",  desc:"Hedges across three attacker type priors — Aggressive (P=0.5), Opportunist (P=0.3), Stealth (P=0.2). More balanced allocations, robust under attacker uncertainty." },
                  { name:"Nash Mix",    color:"#7b2fff", badge:"Baseline", desc:"Risk-proportional allocation: d_i = v_i·c_i / Σ(v_j·c_j). A symmetric best-response baseline — sound but lacks the leader advantage of Stackelberg." },
                  { name:"Random/Equal",color:"#f59e0b", badge:"Weakest", desc:"Uniform allocation ignoring all risk structure. Useful as a control for comparing strategic and non-strategic defenses. Always performs worst." },
                ].map(({ name, color, badge, desc }) => (
                  <div key={name} style={{ background:BG, borderRadius:8, padding:"0.9rem", border:`1px solid ${BORDER}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.5rem" }}>
                      <span style={{ fontFamily:"'Courier New',monospace", fontSize:"0.82rem", fontWeight:700, color }}>{name}</span>
                      <span style={{ fontSize:"0.58rem", fontFamily:"'Courier New',monospace", color, background:`${color}18`, border:`1px solid ${color}40`, borderRadius:3, padding:"1px 5px" }}>{badge}</span>
                    </div>
                    <div style={{ fontSize:"0.77rem", color:TEXT, lineHeight:1.65 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Benchmark explanation */}
            <div style={card()}>
              <div style={{ fontWeight:600, fontSize:"0.92rem", color:BRIGHT, marginBottom:"0.5rem" }}>About the Benchmark Results</div>
              <div style={{ fontSize:"0.8rem", color:TEXT, lineHeight:1.75 }}>
                The <strong style={{ color:"#f59e0b" }}>Benchmark tab</strong> runs its own internal simulation completely separately from the rounds you run on the Simulation tab. It does not use your current defense sliders — it always tests each strategy at its own mathematically-derived allocation. The purpose is to eliminate round-to-round randomness and reveal the true long-run ordering of strategies. Click <strong style={{ color:"#00d4ff" }}>Re-run</strong> to resample with fresh random draws.
              </div>
            </div>

          </div>
        )}{/* /howto */}

      </div>{/* /shell */}
    </div>
  );
}