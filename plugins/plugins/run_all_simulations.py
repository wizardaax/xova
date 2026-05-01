"""
Master simulation runner — all 8 wizardaax repos.
Generates visualizations and saves them to D:/github/wizardaax/sim_outputs/
"""
import sys
import os
import math
import subprocess
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from scipy.constants import golden

OUT = "D:/github/wizardaax/sim_outputs"
os.makedirs(OUT, exist_ok=True)

PHI = golden
ZETA_ZEROS = [14.1347, 21.0220, 25.0109, 30.4249, 32.9351, 37.5862, 40.9187, 43.3271, 48.0052, 49.7738]

outputs = []  # list of saved PNG paths

# ─────────────────────────────────────────────────────────────────────────────
# 1. ZILTRIX-SCH-CORE — Riemann Spiral Field (riemann_spiral.py)
# ─────────────────────────────────────────────────────────────────────────────
print("[1/7] Riemann Spiral Field (ziltrix-sch-core) ...")
n_values = np.arange(1, 1001)
r_values = 3 * np.sqrt(n_values)
theta_values = n_values * PHI

fig = plt.figure(figsize=(12, 12), facecolor='black')
ax = plt.subplot(111, projection='polar')
ax.set_facecolor('black')
colors = plt.cm.viridis(np.linspace(0, 1, len(n_values)))
ax.scatter(theta_values, r_values, c=colors, s=6, alpha=0.7)
resonant = np.array([int(z) for z in ZETA_ZEROS])
rr, rt = 3*np.sqrt(resonant), resonant * PHI
ax.scatter(rt, rr, c='red', s=80, marker='x', zorder=5, label='Zeta Zero Resonances')
ax.set_title("Riemann-Spiral Field Theory\n(ziltrix-sch-core)", color='white', fontsize=14, pad=20)
ax.tick_params(colors='white')
ax.grid(color='gray', alpha=0.3)
ax.legend(loc='upper right', labelcolor='white', facecolor='#111')
path1 = f"{OUT}/1_riemann_spiral.png"
plt.savefig(path1, dpi=200, bbox_inches='tight', facecolor='black')
plt.close()
outputs.append(path1)
print(f"   -> {path1}")

# ─────────────────────────────────────────────────────────────────────────────
# 2. RECURSIVE-FIELD-MATH — Phyllotaxis Golden Angle Field
# ─────────────────────────────────────────────────────────────────────────────
print("[2/7] Phyllotaxis Golden Angle Field (recursive-field-math) ...")
GOLDEN_ANGLE_DEG = 180.0 * (3.0 - math.sqrt(5.0))
GOLDEN_ANGLE_RAD = math.radians(GOLDEN_ANGLE_DEG)

N = 800
ns = np.arange(1, N + 1)
radii = 3.0 * np.sqrt(ns)
angles_rad = (ns * GOLDEN_ANGLE_DEG % 360.0) * math.pi / 180.0
xs = radii * np.cos(angles_rad)
ys = radii * np.sin(angles_rad)

fig, axes = plt.subplots(1, 2, figsize=(16, 8), facecolor='#0a0a0a')
ax = axes[0]
ax.set_facecolor('#0a0a0a')
sc = ax.scatter(xs, ys, c=ns, cmap='plasma', s=8, alpha=0.8)
ax.set_title("Phyllotaxis Pattern\nr=3√n, θ=n×137.508°", color='white', fontsize=13)
ax.set_aspect('equal')
ax.tick_params(colors='white')
for spine in ax.spines.values(): spine.set_color('#333')
plt.colorbar(sc, ax=ax, label='n', shrink=0.8).ax.yaxis.set_tick_params(color='white')

# Lucas ratio convergence
ax2 = axes[1]
ax2.set_facecolor('#0a0a0a')
psi = 1 - PHI
max_n = 30
ns2 = np.arange(1, max_n)
ratios = []
for n in ns2:
    Ln = round(PHI**n + psi**n)
    Ln1 = round(PHI**(n+1) + psi**(n+1))
    ratios.append(Ln1 / Ln if Ln != 0 else 0)
ax2.plot(ns2, ratios, 'o-', color='#00d4ff', linewidth=2, markersize=5, label='L(n+1)/L(n)')
ax2.axhline(PHI, color='gold', linestyle='--', linewidth=1.5, label=f'φ = {PHI:.6f}')
ax2.set_title("Lucas Ratio Convergence to φ\n(recursive-field-math)", color='white', fontsize=13)
ax2.set_xlabel("n", color='white')
ax2.set_ylabel("Ratio", color='white')
ax2.tick_params(colors='white')
ax2.legend(facecolor='#1a1a1a', labelcolor='white')
ax2.set_facecolor('#0a0a0a')
for spine in ax2.spines.values(): spine.set_color('#333')

plt.tight_layout()
path2 = f"{OUT}/2_recursive_field_math.png"
plt.savefig(path2, dpi=200, bbox_inches='tight', facecolor='#0a0a0a')
plt.close()
outputs.append(path2)
print(f"   -> {path2}")

# ─────────────────────────────────────────────────────────────────────────────
# 3. RECURSIVE-FIELD-MATH-PRO — Codex Entropy Pump (golden refraction)
# ─────────────────────────────────────────────────────────────────────────────
print("[3/7] Codex Entropy Pump (recursive-field-math-pro) ...")

def rank_to_phase(x):
    n = len(x)
    order = np.argsort(x)
    ranks = np.empty(n, dtype=float)
    ranks[order] = np.arange(1, n + 1)
    u = ranks / (n + 1)
    return np.pi * (u - 0.5)

def golden_refraction(theta, n=PHI):
    s = np.clip(np.sin(theta) / n, -1, 1)
    return np.arcsin(s)

np.random.seed(42)
evals = np.cumsum(np.random.randn(60) * 50)
deltas = np.diff(evals)
theta_before = rank_to_phase(deltas)
theta_after = golden_refraction(theta_before)

fig, axes = plt.subplots(2, 2, figsize=(14, 10), facecolor='#0a0a0a')
fig.suptitle("Codex Entropy Pump — Golden Refraction\n(recursive-field-math-pro)", color='white', fontsize=14)

axes[0,0].set_facecolor('#0a0a0a')
axes[0,0].plot(evals, color='#00d4ff', linewidth=2)
axes[0,0].set_title("Eval Series", color='white')
axes[0,0].tick_params(colors='white')
for spine in axes[0,0].spines.values(): spine.set_color('#333')

axes[0,1].set_facecolor('#0a0a0a')
axes[0,1].plot(deltas, color='#ff6b35', linewidth=1.5, alpha=0.8)
axes[0,1].set_title("Deltas (Chaos)", color='white')
axes[0,1].tick_params(colors='white')
for spine in axes[0,1].spines.values(): spine.set_color('#333')

axes[1,0].set_facecolor('#0a0a0a')
axes[1,0].hist(theta_before, bins=20, color='#7b2d8b', alpha=0.8, edgecolor='white', linewidth=0.5)
axes[1,0].set_title("θ Before Refraction", color='white')
axes[1,0].tick_params(colors='white')
for spine in axes[1,0].spines.values(): spine.set_color('#333')

phi_clamp = math.asin(1.0 / PHI)
axes[1,1].set_facecolor('#0a0a0a')
axes[1,1].hist(theta_after, bins=20, color='#00d4ff', alpha=0.8, edgecolor='white', linewidth=0.5)
axes[1,1].axvline(phi_clamp, color='gold', linestyle='--', linewidth=1.5, label=f'φ-clamp ±{phi_clamp:.3f}')
axes[1,1].axvline(-phi_clamp, color='gold', linestyle='--', linewidth=1.5)
axes[1,1].set_title("θ After φ-Refraction", color='white')
axes[1,1].tick_params(colors='white')
axes[1,1].legend(facecolor='#1a1a1a', labelcolor='white')
for spine in axes[1,1].spines.values(): spine.set_color('#333')

plt.tight_layout()
path3 = f"{OUT}/3_codex_entropy_pump.png"
plt.savefig(path3, dpi=200, bbox_inches='tight', facecolor='#0a0a0a')
plt.close()
outputs.append(path3)
print(f"   -> {path3}")

# ─────────────────────────────────────────────────────────────────────────────
# 4. SNELL-VERN-HYBRID-DRIVE-MATRIX — Drive Matrix Field Analysis
# ─────────────────────────────────────────────────────────────────────────────
print("[4/7] Snell-Vern Drive Matrix (Snell-Vern-Hybrid-Drive-Matrix) ...")

fig, axes = plt.subplots(2, 2, figsize=(14, 12), facecolor='#0a0a0a')
fig.suptitle("Snell-Vern Hybrid Drive Matrix\nField Analysis", color='white', fontsize=14)

# r-theta field
ns3 = np.arange(1, 300)
rs = 3.0 * np.sqrt(ns3)
thetas = ns3 * PHI  # radians, NOT mod 2pi
xs3 = rs * np.cos(thetas)
ys3 = rs * np.sin(thetas)
ax = axes[0,0]
ax.set_facecolor('#0a0a0a')
sc = ax.scatter(xs3, ys3, c=ns3, cmap='inferno', s=5, alpha=0.7)
ax.set_title("r-θ Field (φ radians, continuous)", color='white', fontsize=11)
ax.set_aspect('equal')
ax.tick_params(colors='white')
for spine in ax.spines.values(): spine.set_color('#333')

# Fibonacci vs Lucas
ax2 = axes[0,1]
ax2.set_facecolor('#0a0a0a')
fib = [0, 1]
for _ in range(28): fib.append(fib[-1] + fib[-2])
luc = [2, 1]
for _ in range(28): luc.append(luc[-1] + luc[-2])
ax2.semilogy(range(len(fib)), fib, 'o-', color='#00d4ff', markersize=4, linewidth=1.5, label='Fibonacci')
ax2.semilogy(range(len(luc)), luc, 's-', color='gold', markersize=4, linewidth=1.5, label='Lucas')
ax2.set_title("Fibonacci vs Lucas Sequences\n(log scale)", color='white', fontsize=11)
ax2.tick_params(colors='white')
ax2.legend(facecolor='#1a1a1a', labelcolor='white')
for spine in ax2.spines.values(): spine.set_color('#333')

# Generating functions
ax3 = axes[1,0]
ax3.set_facecolor('#0a0a0a')
xs_gf = np.linspace(0.01, 0.59, 400)
GF_F_vals = xs_gf / (1 - xs_gf - xs_gf**2)
GF_L_vals = (2 - xs_gf) / (1 - xs_gf - xs_gf**2)
ax3.plot(xs_gf, GF_F_vals, color='#00d4ff', linewidth=2, label='G_F(x) = x/(1-x-x²)')
ax3.plot(xs_gf, GF_L_vals, color='#ff6b35', linewidth=2, label='G_L(x) = (2-x)/(1-x-x²)')
ax3.set_ylim(-1, 20)
ax3.set_title("Generating Functions", color='white', fontsize=11)
ax3.tick_params(colors='white')
ax3.legend(facecolor='#1a1a1a', labelcolor='white', fontsize=9)
for spine in ax3.spines.values(): spine.set_color('#333')

# Egyptian fraction 4-7-11 signature
ax4 = axes[1,1]
ax4.set_facecolor('#0a0a0a')
labels = ['1/4', '1/7', '1/11', 'Sum\n(149/308)']
values = [1/4, 1/7, 1/11, 149/308]
colors_bar = ['#7b2d8b', '#00d4ff', '#ff6b35', 'gold']
bars = ax4.bar(labels, values, color=colors_bar, edgecolor='white', linewidth=0.8)
for bar, val in zip(bars, values):
    ax4.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
             f'{val:.4f}', ha='center', va='bottom', color='white', fontsize=10)
ax4.set_title("Lucas 4-7-11 Egyptian Fractions\n1/4 + 1/7 + 1/11 = 149/308", color='white', fontsize=11)
ax4.tick_params(colors='white')
for spine in ax4.spines.values(): spine.set_color('#333')

plt.tight_layout()
path4 = f"{OUT}/4_snell_vern_drive_matrix.png"
plt.savefig(path4, dpi=200, bbox_inches='tight', facecolor='#0a0a0a')
plt.close()
outputs.append(path4)
print(f"   -> {path4}")

# ─────────────────────────────────────────────────────────────────────────────
# 5. GLYPH-PHASE-ENGINE — Phase State Transitions
# ─────────────────────────────────────────────────────────────────────────────
print("[5/7] Glyph Phase Engine (glyph_phase_engine) ...")

fig, axes = plt.subplots(1, 2, figsize=(14, 7), facecolor='#0a0a0a')
fig.suptitle("Glyph Phase Engine — State Dynamics\n(glyph_phase_engine)", color='white', fontsize=14)

# Phase state machine diagram
ax = axes[0]
ax.set_facecolor('#0a0a0a')
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
ax.set_aspect('equal')
ax.axis('off')
states = {'INITIAL': (5, 8.5), 'PROCESSING': (5, 6.5),
          'DELTA_ADJ': (5, 4.5), 'STABILIZED': (2, 2.5), 'ERROR': (8, 2.5)}
state_colors = {'INITIAL': '#555', 'PROCESSING': '#00d4ff',
                'DELTA_ADJ': '#7b2d8b', 'STABILIZED': '#00aa44', 'ERROR': '#cc2222'}
for name, (x, y) in states.items():
    circle = plt.Circle((x, y), 0.9, color=state_colors[name], ec='white', lw=1.5, zorder=5)
    ax.add_patch(circle)
    ax.text(x, y, name, ha='center', va='center', color='white', fontsize=7.5, fontweight='bold', zorder=6)
edges = [('INITIAL','PROCESSING'), ('PROCESSING','DELTA_ADJ'),
         ('DELTA_ADJ','STABILIZED'), ('DELTA_ADJ','ERROR')]
for s1, s2 in edges:
    x1,y1 = states[s1]; x2,y2 = states[s2]
    ax.annotate('', xy=(x2,y2), xytext=(x1,y1),
                arrowprops=dict(arrowstyle='->', color='white', lw=1.5))
ax.set_title("Phase State Machine", color='white', fontsize=12)

# Delta convergence simulation
ax2 = axes[1]
ax2.set_facecolor('#0a0a0a')
np.random.seed(7)
deltas_sim = [0.8 * (0.7**i) + np.random.randn()*0.02 for i in range(20)]
converged = [d < 0.1 for d in deltas_sim]
ax2.plot(deltas_sim, 'o-', color='#00d4ff', linewidth=2, markersize=6)
ax2.axhline(0.1, color='gold', linestyle='--', linewidth=1.5, label='Convergence threshold (0.1)')
ax2.axhline(1.0, color='red', linestyle='--', linewidth=1.5, label='Divergence threshold (1.0)')
conv_idx = next((i for i, v in enumerate(converged) if v), None)
if conv_idx:
    ax2.axvline(conv_idx, color='#00aa44', linestyle=':', linewidth=2, label=f'Stabilized at step {conv_idx}')
ax2.fill_between(range(len(deltas_sim)), deltas_sim, 0.1,
                 where=[d > 0.1 for d in deltas_sim], alpha=0.2, color='#7b2d8b', label='DELTA_ADJ zone')
ax2.set_title("Phase Delta Convergence Simulation", color='white', fontsize=12)
ax2.set_xlabel("Step", color='white')
ax2.set_ylabel("|delta|", color='white')
ax2.tick_params(colors='white')
ax2.legend(facecolor='#1a1a1a', labelcolor='white', fontsize=8)
for spine in ax2.spines.values(): spine.set_color('#333')

plt.tight_layout()
path5 = f"{OUT}/5_glyph_phase_engine.png"
plt.savefig(path5, dpi=200, bbox_inches='tight', facecolor='#0a0a0a')
plt.close()
outputs.append(path5)
print(f"   -> {path5}")

# ─────────────────────────────────────────────────────────────────────────────
# 6. CODEX-AEON-RESONATOR — Extraction Topology + Voynich Flora
# ─────────────────────────────────────────────────────────────────────────────
print("[6/7] Codex AEON Resonator (extraction topology + Voynich flora) ...")
import networkx as nx

fig, axes = plt.subplots(1, 2, figsize=(16, 8), facecolor='#0a0a0a')
fig.suptitle("Codex AEON Resonator\n(Codex-AEON-Resonator)", color='white', fontsize=14)

# Extraction topology graph
ax = axes[0]
ax.set_facecolor('#0a0a0a')
G = nx.DiGraph()
G.add_nodes_from(['LEADER', 'MID_TIER', 'BASE'])
G.add_edges_from([
    ('LEADER',   'MID_TIER', {'label': 'hierarchy/command'}),
    ('LEADER',   'BASE',     {'label': 'oversight/insulation'}),
    ('MID_TIER', 'BASE',     {'label': 'ritual extraction'}),
    ('BASE',     'MID_TIER', {'label': 'loyalty signal'}),
])
pos = {'LEADER': (0.5, 1.0), 'MID_TIER': (0.0, 0.3), 'BASE': (1.0, 0.3)}
node_colors = ['#cc2222', '#7b2d8b', '#00aa44']
nx.draw_networkx_nodes(G, pos, node_color=node_colors, node_size=2500, ax=ax)
nx.draw_networkx_labels(G, pos, font_color='white', font_size=10, font_weight='bold', ax=ax)
nx.draw_networkx_edges(G, pos, edge_color='white', arrows=True,
                       arrowsize=20, width=2, ax=ax,
                       connectionstyle='arc3,rad=0.1')
edge_labels = {(u,v): d['label'] for u,v,d in G.edges(data=True)}
nx.draw_networkx_edge_labels(G, pos, edge_labels=edge_labels,
                              font_color='#aaa', font_size=7, ax=ax)
ax.set_title("Extraction Topology\n3 nodes, 4 directed edges, density=0.667", color='white', fontsize=11)
ax.axis('off')

# Voynich morphological distances
ax2 = axes[1]
ax2.set_facecolor('#0a0a0a')
plants = {
    'Kniphofia foliosa': (1.2, 50.0, 2),
    'Arisaema enset': (0.8, 3.5, 4),
    'Lobelia rhynchopetalum': (3.5, 8.0, 1),
    'Echinops kebericho': (0.6, 2.0, 3),
    'Hagenia abyssinica': (15.0, 4.5, 1),
    'Aloe debrana': (0.4, 12.0, 2),
}
voynich_estimates = [
    {'name': 'Folio 2r', 'stem': 0.9, 'lw': 45.0, 'inf': 2},
    {'name': 'Folio 16r', 'stem': 2.8, 'lw': 6.0, 'inf': 1},
    {'name': 'Folio 33v', 'stem': 0.5, 'lw': 11.0, 'inf': 2},
]
data = np.array(list(plants.values()), dtype=float)
mean = data.mean(axis=0); std = data.std(axis=0)
std[std == 0] = 1
for voy in voynich_estimates:
    voy_vec = np.array([voy['stem'], voy['lw'], voy['inf']], dtype=float)
    dists = [np.linalg.norm((voy_vec - mean)/std - (d - mean)/std) / 3 for d in data]
    ax2.barh([f"{n}\n(vs {voy['name']})" for n in plants], dists,
             color=plt.cm.viridis(np.array(dists)/max(dists)), alpha=0.8)
ax2.axvline(0.10, color='red', linestyle='--', linewidth=1.5, label='Strong match (<0.10)')
ax2.set_xlabel("Normalised Distance", color='white')
ax2.set_title("Voynich Flora Morphological\nDistance to Ethiopian Endemics", color='white', fontsize=11)
ax2.tick_params(colors='white')
ax2.legend(facecolor='#1a1a1a', labelcolor='white')
for spine in ax2.spines.values(): spine.set_color('#333')

plt.tight_layout()
path6 = f"{OUT}/6_codex_aeon_resonator.png"
plt.savefig(path6, dpi=200, bbox_inches='tight', facecolor='#0a0a0a')
plt.close()
outputs.append(path6)
print(f"   -> {path6}")

# ─────────────────────────────────────────────────────────────────────────────
# 7. SCE-88 — 22-Level 4-Domain Architecture Map
# ─────────────────────────────────────────────────────────────────────────────
print("[7/7] SCE-88 Architecture Map ...")

LEVELS = [
    "Substrate Constraints", "Signal Transduction", "Temporal Ordering",
    "System Identification", "Actuation Control", "Uncertainty Modelling",
    "Stabilization Mechanisms", "Fault Correction", "Resolution Engine",
    "Constraint Compilation", "Execution Coordination", "Correctness Enforcement",
    "Integrity Assurance", "Structural Topology", "Environmental Awareness",
    "Inter-Instance Coordination", "Semantic Interface", "Adaptive Optimization",
    "Coherence Closure", "Self-Observation", "Intent Continuity", "External Compatibility",
]
DOMAINS = ["Domain A\nPhysical/Substrate", "Domain B\nControl/Computational",
           "Domain C\nSemantic/Interface", "Domain D\nTemporal/Evolutionary"]
BANDS = [
    (0, 4,  '#1a3a5c', 'I. Physical Closure'),
    (5, 8,  '#1a4a2a', 'II. Stability & Correction'),
    (9, 11, '#3a2a1a', 'III. Execution'),
    (12, 15,'#2a1a4a', 'IV. Trust & Structure'),
    (16, 17,'#4a2a1a', 'V. Meaning & Adaptation'),
    (18, 21,'#1a1a4a', 'VI. Coherence & Persistence'),
]

fig, ax = plt.subplots(figsize=(16, 14), facecolor='#080810')
ax.set_facecolor('#080810')
ax.set_xlim(-1, len(DOMAINS) + 0.5)
ax.set_ylim(-0.5, 22.5)
ax.axis('off')
fig.suptitle("SCE-88 — State-Coherent Enforcement Architecture\n4 Domains × 22 Levels = 88",
             color='white', fontsize=15, fontweight='bold', y=0.98)

# Band backgrounds
for start, end, color, label in BANDS:
    ax.fill_betweenx([start - 0.45, end + 0.45], -0.8, len(DOMAINS) - 0.5,
                     alpha=0.35, color=color)
    ax.text(-0.85, (start + end) / 2, label, color='#aaa', fontsize=7.5,
            va='center', ha='right', style='italic')

# Domain headers
for di, dname in enumerate(DOMAINS):
    ax.text(di, 22.2, dname, ha='center', va='bottom', color='#00d4ff',
            fontsize=9, fontweight='bold')

# Level cells
for li, lname in enumerate(LEVELS):
    y = 21 - li
    # Level number on left
    ax.text(-0.45, y, f"{li+1:2d}", ha='right', va='center', color='#888', fontsize=8)
    for di in range(len(DOMAINS)):
        # Special highlight: Coherence Closure (level 19 = index 18)
        if li == 18:
            facecolor = '#cc2222'
            textcolor = 'white'
            lw = 2
        elif li >= 16:
            facecolor = '#1a1050'
            textcolor = '#aad4ff'
            lw = 1
        else:
            facecolor = '#0e0e1a'
            textcolor = '#cccccc'
            lw = 0.5
        rect = plt.Rectangle((di - 0.45, y - 0.42), 0.9, 0.84,
                              facecolor=facecolor, edgecolor='#333', linewidth=lw)
        ax.add_patch(rect)
        ax.text(di, y, lname if di == 0 else '·', ha='center', va='center',
                color=textcolor, fontsize=6.5 if di == 0 else 10)

# Coherence closure label
ax.annotate("← COHERENCE CLOSURE\n   Simultaneous enforcement\n   across all 4 domains",
            xy=(3.45, 21 - 18), xytext=(3.6, 21 - 14),
            color='#ff4444', fontsize=8,
            arrowprops=dict(arrowstyle='->', color='#ff4444', lw=1.5))

plt.tight_layout()
path7 = f"{OUT}/7_sce88_architecture.png"
plt.savefig(path7, dpi=200, bbox_inches='tight', facecolor='#080810')
plt.close()
outputs.append(path7)
print(f"   -> {path7}")

# ─────────────────────────────────────────────────────────────────────────────
# OPEN ALL OUTPUTS
# ─────────────────────────────────────────────────────────────────────────────
print("\n=== All simulations complete. Opening visualizations... ===")
for p in outputs:
    subprocess.Popen(["cmd", "/c", "start", "", p.replace("/", "\\")])
    print(f"   Opened: {p}")
