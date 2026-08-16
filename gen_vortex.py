# -*- coding: utf-8 -*-
"""Genere une texture de vortex SVG (portail) autonome : un vrai ruban en
spirale (pas des cercles concentriques) qui s'enroule ~3 fois du centre
vers le bord, plus lumineux au centre, avec un filet lumineux qui longe
la courbe interieure de chaque tour -- comme sur TIMELINE/Cartes/LOGOV1.png.
C'est le SEUL calque qui tourne dans le logo ; texte/anneau/mini-cartes
restent fixes par-dessus en CSS."""
import math
import random

random.seed(7)
CX, CY = 100, 100

def spiral_point(r0, k, theta):
    r = r0 + k * theta
    return CX + r * math.cos(theta), CY + r * math.sin(theta), r


def build_ribbon(r0, r_max, turns, theta_offset, n=140):
    theta_max = turns * 2 * math.pi
    k = (r_max - r0) / theta_max
    pts = []
    for i in range(n + 1):
        theta = theta_offset + theta_max * i / n
        x, y, r = spiral_point(r0, k, theta - theta_offset)
        pts.append((x, y, i / n))
    return pts


DARK = (13, 58, 32)     # vert tres sombre (fond de bande)
MID = (46, 143, 82)     # vert moyen
LIGHT = (150, 232, 150) # vert clair
HILITE = (232, 255, 210)  # filet lumineux presque blanc


def lerp(a, b, t):
    return a + (b - a) * t


def col(c):
    return f"rgb({int(c[0])},{int(c[1])},{int(c[2])})"


parts = []
parts.append('<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">')
parts.append('<defs>')
parts.append(
    '<radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">'
    '<stop offset="0%" stop-color="#f2ffd8" stop-opacity="0.95"/>'
    '<stop offset="45%" stop-color="#a6ffb4" stop-opacity="0.55"/>'
    '<stop offset="100%" stop-color="#a6ffb4" stop-opacity="0"/>'
    '</radialGradient>'
)
parts.append(
    '<radialGradient id="fieldGlow" cx="50%" cy="50%" r="50%">'
    '<stop offset="0%" stop-color="#1c6b3b" stop-opacity="0.45"/>'
    '<stop offset="70%" stop-color="#0d3a22" stop-opacity="0.18"/>'
    '<stop offset="100%" stop-color="#0d3a22" stop-opacity="0"/>'
    '</radialGradient>'
)
parts.append('<filter id="blurSoft" x="-60%" y="-60%" width="220%" height="220%">'
              '<feGaussianBlur stdDeviation="1.1"/></filter>')
parts.append('<filter id="blurWide" x="-60%" y="-60%" width="220%" height="220%">'
              '<feGaussianBlur stdDeviation="2.6"/></filter>')
parts.append(
    '<radialGradient id="ribbonFade" gradientUnits="userSpaceOnUse" '
    f'cx="{CX}" cy="{CY}" r="92">'
    '<stop offset="0%" stop-color="#c9f7b8" stop-opacity="0.98"/>'
    '<stop offset="35%" stop-color="#5fbd7c" stop-opacity="0.9"/>'
    '<stop offset="100%" stop-color="#123a24" stop-opacity="0.55"/>'
    '</radialGradient>'
)
parts.append('</defs>')

parts.append(f'<circle cx="{CX}" cy="{CY}" r="96" fill="url(#fieldGlow)"/>')

# --- Ruban principal en spirale : UN SEUL <path> continu par bras, stroke
#     colore par un radialGradient (clair au centre -> sombre au bord). Un
#     stroke unique = zero jointure, donc zero effet "chapelet de perles".
#     La texture en bandes vient d'un second trace fin en pointilles
#     (stroke-dasharray) qui suit exactement la meme courbe. ---
def draw_ribbon(r0, r_max, turns, theta_offset, width, n, hilite=True):
    pts = build_ribbon(r0, r_max, turns, theta_offset, n)
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y, _ in pts)
    parts.append(
        f'<path d="{d}" fill="none" stroke="url(#ribbonFade)" stroke-width="{width}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
    )
    if hilite:
        # filet lumineux fin et continu qui longe le bord interieur du ruban
        parts.append(
            f'<path d="{d}" fill="none" stroke="{col(HILITE)}" stroke-width="{width * 0.22:.2f}" '
            f'stroke-linecap="round" stroke-linejoin="round" opacity="0.6" '
            f'filter="url(#blurSoft)"/>'
        )

# bras principal : du centre au bord, ~3.1 tours
draw_ribbon(r0=10, r_max=94, turns=3.15, theta_offset=0.0, width=8.5, n=220)
# second bras plus fin, en retrait, pour epaissir le feuillete visuel
draw_ribbon(r0=24, r_max=90, turns=2.55, theta_offset=math.pi * 0.55, width=3.6, n=180, hilite=False)

# --- Volutes floues (traits de lumiere elliptiques) ---
wisp_specs = [
    (34, 60, 20, 6, 0.28),
    (58, 210, 26, 7, 0.22),
    (74, 300, 30, 6, 0.18),
    (46, 140, 18, 5, 0.24),
    (86, 20, 24, 5, 0.14),
]
for r, ang, rx, ry, op in wisp_specs:
    x = CX + r * math.cos(math.radians(ang))
    y = CY + r * math.sin(math.radians(ang))
    parts.append(
        f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{rx}" ry="{ry}" '
        f'fill="#d3ffd0" opacity="{op}" filter="url(#blurWide)" '
        f'transform="rotate({ang + 90:.1f} {x:.2f} {y:.2f})"/>'
    )

# --- Coeur lumineux ---
parts.append(f'<circle cx="{CX}" cy="{CY}" r="17" fill="url(#coreGlow)"/>')

# --- Etoiles eparpillees ---
for _ in range(16):
    r = random.uniform(58, 96)
    ang = random.uniform(0, 360)
    x = CX + r * math.cos(math.radians(ang))
    y = CY + r * math.sin(math.radians(ang))
    size = random.uniform(0.5, 1.4)
    op = random.uniform(0.4, 0.95)
    color = random.choice(["#ffffff", "#d9ffe0", "#ffffff"])
    parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{size:.2f}" fill="{color}" opacity="{op:.2f}"/>')
for _ in range(8):
    r = random.uniform(16, 50)
    ang = random.uniform(0, 360)
    x = CX + r * math.cos(math.radians(ang))
    y = CY + r * math.sin(math.radians(ang))
    size = random.uniform(0.4, 0.9)
    op = random.uniform(0.25, 0.6)
    parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{size:.2f}" fill="#ffffff" opacity="{op:.2f}"/>')

parts.append('</svg>')

svg = "\n".join(parts)
out_path = r"C:\PROJETS CODE\TIMELINE\v3\images\logo-vortex.svg"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(svg)
print("Ecrit:", out_path, "-", len(svg), "octets,", svg.count("<line"), "segments")
