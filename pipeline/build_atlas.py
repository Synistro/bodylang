"""Turns Z-Anatomy's organs and vessels into one file per body, in the frame of the Anny reference bodies.

Every organ is rewrapped into one closed surface in Z-Anatomy's frame at a pitch fine enough to keep its shape,
decimated, then moved by the same warp as the muscles and bones, so all of it stays in register. Vessels and tubes come
from Z-Anatomy's curves, whose radii are real calibres. The stomach is not a mesh here: it has to change shape with what
is in it, so this writes the sections that src/scene/stomach.ts lofts.

Usage: build_atlas.py <folder fetch_zanatomy.sh wrote> <cache folder> <folder build_female_organs.py wrote>
"""
import json, re, sys, warnings
from pathlib import Path
import numpy as np, trimesh
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import measure
from skimage.graph import route_through_array

from body_warp import OUT, JOINT_NAMES, contain, decimate, fit_bodies, scan_solid, taubin, unit
from zanatomy import ZAnatomy

warnings.filterwarnings("ignore")
rng = np.random.default_rng(7)
Q = 32767 / 2.5  # same quantisation as body.json

# A structure ships only if the model drives it or an explanation names it.
# name: (Z-Anatomy objects, wrap pitch in metres, closing iterations, blur sigma in voxels, target triangles).
ORGANS = {
    "heart": (["Right atrium", "Right ventricle", "Left atrium", "Left ventricle"], 0.0012, 3, 1.6, 7000),
    "liver": (["Liver"], 0.0014, 1, 1.4, 7000),
    "lung_L": (["Superior lobe of left lung", "Inferior lobe of left lung"], 0.0016, 1, 0.8, 6000),
    "lung_R": (["Superior lobe of right lung", "Middle lobe of right lung", "Inferior lobe of right lung"], 0.0016, 1, 0.8, 6000),
    "kidney_L": (["Kidney.l"], 0.001, 1, 0.8, 2800),
    "kidney_R": (["Kidney.r"], 0.001, 1, 0.8, 2800),
    "pancreas": (["Pancreas"], 0.001, 1, 0.8, 3000),
    "spleen": (["Spleen"], 0.001, 1, 0.8, 2200),
    "duodenum": (["Duodenum"], 0.001, 1, 0.8, 2500),
    "large_intestine": (["Ascending colon", "Transverse colon", "Descending colon", "Sigmoid colon", "Vermiform appendix"], 0.0016, 2, 1.4, 9000),
    "bladder": (["Urinary bladder"], 0.001, 1, 0.8, 1400),
    "spinal_cord": (["White matter of spinal cord", "Anterior horn of spinal cord", "Posterior horn of spinal cord"], 0.0012, 2, 0.8, 1600),
    "thymus": (["Left lobe of thymus", "Right lobe of thymus"], 0.001, 1, 0.8, 1600),
    "prostate": (["Prostate"], 0.0008, 1, 0.8, 1600),
    "thyroid": (["Thyroid gland"], 0.0007, 3, 0.9, 1200),
    "adrenal_L": (["Suprarenal gland.l"], 0.0006, 1, 0.9, 900),
    "adrenal_R": (["Suprarenal gland.r"], 0.0006, 1, 0.9, 900),
    "gallbladder": (["Gallbladder"], 0.0008, 1, 0.9, 900),
}
ONLY_MALE = ("prostate",)
# Shapes in more than one piece, which keep every piece.
SEVERAL_PIECES = ("thymus", "lung_L", "lung_R", "heart", "spinal_cord", "thyroid")

# Coils and folds so fine that decimating leaves little facets, which would shade as flecks, take this many passes.
SMOOTHING_PASSES = {"large_intestine": 24, "heart": 16}

# Folds this fine shade as flecks if they stay this deep, so the wrap is blurred until they are broad grooves.
BRAIN = dict(pitch=0.0012, close=1, sigma=1.5, target=24000, taubin=12)
BRAIN_PARTS = re.compile(
    r"(gyr|lobule|pole\b|cuneus|insula|uncus|white matter of telencephalon|^pons|midbrain|medulla oblongata|tonsil of cerebellum|flocculus|lingula of cerebellum|central lobule|nodule|culmen|declive|folium|tuber of|uvula of vermis|pyramid of vermis|base of peduncle|corpus callosum)",
    re.I,
)

AIRWAY = dict(trachea="Trachea", trachea_target=1600, least_radius=0.002, sides=8)
BRONCHI = ["Left main bronchus", "Right main bronchus", "Left superior lobar bronchus", "Left inferior lobar bronchus", "Right superior lobar bronchus", "Right inferior lobar bronchus", "Intermediate bronchus.r", "Middle lobar bronchus.r"]

BOWEL = dict(
    curve="Jejunum",  # one curve for the jejunum and ileum together, drawn from the caecum up
    jejunum_share=0.4,
    spacing=0.005,  # between points while the path relaxes
    apart=1.04,  # strands stay this many summed radii apart
    bending=0.02,
    pull=0.2,
    push=0.25,
    steps=2500,
    largest_move=0.0015,
    ring_spacing=0.0045,
    sides=12,
    tightest_bend=1.1,  # in radii of the tube
    most_easing=60,
)

# Which vessels are drawn. The file also has many small named branches of the face and scalp, which the warp can't place
# on a different head and no explanation names, and everything past the wrist, whose source hand is posed unlike Anny's.
VESSEL_SKIP = re.compile(
    r"(digital|palmar|carpal|metacarp|princeps|radialis indicis|nasal|sphenopalatine|retinal|ophthalmic|maxillary|pharyngeal|labial|supra-?orbital|supratrochlear|infra-?orbital|lacrimal|ethmoid|alveolar|meningeal|cerebr|cerebell|basilar|pontine|choroid|communicating|sigmoid sinus|petrosal|sagittal|cavernous|straight sinus|transverse sinus|diploic|emissary|occipital sinus|basilar venous|lingual|facial|temporal|auricular|occipital|mental|buccal|masseter|pterygoid|palatine|thyroid vein|tympanic|stylomastoid|perforating femoral|descending branch of lateral circumflex|lateral circumflex|medial circumflex)",
    re.I,
)
ONLY_MALE_VESSEL = re.compile(r"(penis|penile|testic|scrot|prostat|ductus deferens|bulb of|cremasteric|urethral)", re.I)
VEIN = re.compile(r"(vein|venous|sinus|vena|venae|plexus)", re.I)
TIER_RADII = [0.004, 0.002]  # metres; the great trunks every view may show, then the branches of the vessels' own page
VESSEL_LEAST_RADIUS = TIER_RADII[-1]  # below this a line can only read as hair, and no view asks for one
SIDES_FOR_RADIUS = [(0.002, 5), (0.004, 6), (0.008, 10), (1.0, 16)]
RING_SPACING = (0.003, 0.009)  # metres, nearest and furthest apart
ARM_ROOT = re.compile(r"^axillary (artery|vein)", re.I)
LEG_ROOT = re.compile(r"^(femoral (artery|vein)|external iliac (artery|vein)|inferior epigastric)", re.I)

# The vessels routes.ts and stage.ts walk, by the names they use, and where each is in Z-Anatomy.
NAMED_VESSELS = {
    "inferior_vena_cava_b": "Inferior vena cava (abdominal part)",
    "inferior_vena_cava_a": "Inferior vena cava (thoracic part)",
    "superior_vena_cava": "Superior vena cava",
    "portal_vein": "Hepatic portal vein",
    "ascending_aorta": "Ascending aorta",
    "aortic_arch": "Aortic arch",
    "descending_aorta_a": "Thoracic aorta",
    "descending_aorta_b": "Abdominal aorta",
    "renal_artery_L": "Left renal artery",
    "renal_artery_R": "Right renal artery",
    "renal_vein_L": "Left renal vein",
    "renal_vein_R": "Right renal vein",
    "brachiocephalic_vein_L": "Left brachiocephalic vein",
    "brachiocephalic_vein_R": "Right brachiocephalic vein",
    "left_common_carotid_artery_a": "Left common carotid artery",
    "internal_carotid_artery_L": "Internal carotid artery.l",
    "superior_mesenteric_artery": "Superior mesenteric artery",
    "superior_mesenteric_vein": "Superior mesenteric vein",
    "pulmonary_trunk": "Bifurcation of pulmonary trunk",
    "pulmonary_artery_L": "Left pulmonary artery",
    "pulmonary_artery_R": "Right pulmonary artery",
    "pulmonary_vein_L_sup": "Left superior pulmonary vein",
    "pulmonary_vein_R_sup": "Right superior pulmonary vein",
    "hepatic_veins": "Hepatic veins",
    "celiac_trunk": "Coeliac trunk",
    "common_hepatic_artery": "Common hepatic artery",
    "proper_hepatic_artery": "Proper hepatic artery",
    "left_subclavian_artery": "Left subclavian artery",
    "brachiocephalic_trunk": "Brachiocephalic trunk",
    "right_subclavian_artery": "Right subclavian artery",
    "internal_jugular_vein_R": "Internal jugular vein.r",
    "ureter_L": "Ureter.l",
    "ureter_R": "Ureter.r",
}
# The way out to each limb, in order from the trunk.
LIMB_ROUTES = {
    "leg_L": ["Common iliac artery.l", "External iliac artery.l", "Femoral artery.l", "Popliteal artery.l", "Posterior tibial artery.l"],
    "leg_R": ["Common iliac artery.r", "External iliac artery.r", "Femoral artery.r", "Popliteal artery.r", "Posterior tibial artery.r"],
    "arm_L": ["Left subclavian artery", "Axillary artery.l", "Brachial artery.l", "Radial artery.l"],
    "arm_R": ["Brachiocephalic trunk", "Right subclavian artery", "Axillary artery.r", "Brachial artery.r", "Radial artery.r"],
}
# Vessels named when an injury's line crosses them are the ones this wide.
NAMED_FOR_INJURY_RADIUS = 0.0035

STOMACH = dict(
    pixel=0.0015,
    outline_smoothing=6,  # steps of the outline, which would otherwise wrinkle the narrow outlet
    section_at=[0.015, 0.07, 0.15, 0.25, 0.37, 0.49, 0.61, 0.72, 0.82, 0.9, 0.955, 0.985],  # along each curvature
    # These sections hold the stomach at full stretch, which the outer curve reaches at this much past the part-filled
    # mesh. Volume grows with its square, and at this value the smaller female stomach still holds 1.5 L, past the 1 L
    # the model calls full (STOMACH.fullnessMl).
    full_stretch=1.9,
)

LEAST_SOLID_SHARE = 0.8  # of the source's own volume, below which a wrap has come out hollow
LONGEST_EDGE = 0.05  # metres; an edge this long on a decimated organ is a spike
# How much of each thing has to land inside the skin, or the build stops.
LEAST_INSIDE = {"organ": 0.99, "vessel": 0.97, "gut": 0.99}


def surface_points(V, F, spacing):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    counts = np.minimum(np.ceil(areas / (spacing**2 * 0.4)).astype(int) + 1, 400)
    idx = np.repeat(np.arange(len(F)), counts)
    u, v = rng.random(len(idx)), rng.random(len(idx))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[idx] + (b[idx] - a[idx]) * u[:, None] + (c[idx] - a[idx]) * v[:, None]


def capped(V, F):
    """Open holes closed with a fan, so a tube with open ends, like the duodenum, has an inside to fill."""
    mesh = trimesh.Trimesh(V, F, process=False)
    mesh.merge_vertices(digits_vertex=6)
    V, F = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    sorted_edges = np.sort(np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    unique, counts = np.unique(sorted_edges, axis=0, return_counts=True)
    open_edges = unique[counts == 1]
    if not len(open_edges):
        return V, F
    graph = trimesh.graph.connected_components(open_edges, nodes=np.unique(open_edges))
    vs, fans = [V], []
    next_vertex = len(V)
    for loop in graph:
        if len(loop) < 3:
            continue
        inside = np.isin(open_edges, loop).all(axis=1)
        vs.append(V[loop].mean(0, keepdims=True))
        fans.append(np.c_[open_edges[inside], np.full(inside.sum(), next_vertex)])
        next_vertex += 1
    return np.vstack(vs), np.vstack([F, *fans]) if fans else F


def solid_grid(meshes, pitch, close, keep_largest):
    """Which voxels are inside. Scanning each closed piece along all three axes finds its true solid, so a stray gap can't
    drain the fill, and the sampled surface keeps thin sheets that fall between voxel centres."""
    closed = [capped(V, F) for V, F in meshes]
    points = np.vstack([surface_points(V, F, pitch * 0.5) for V, F in closed])
    room = close + 4
    lo = points.min(0) - pitch * room
    dims = np.ceil((points.max(0) - lo) / pitch).astype(int) + room + 1
    grid = np.zeros(dims, bool)
    for V, F in closed:
        grid |= sum(scan_solid(V, F, lo, pitch, dims, axis).astype(np.int8) for axis in range(3)) >= 2
    at = ((points - lo) / pitch).astype(int)
    grid[at[:, 0], at[:, 1], at[:, 2]] = True
    if close:
        grid = ndi.binary_closing(grid, iterations=close)
    grid = ndi.binary_fill_holes(grid)
    if keep_largest:
        labels, n = ndi.label(grid)
        if n > 1:
            grid = labels == (1 + int(np.argmax(ndi.sum(grid, labels, range(1, n + 1)))))
    source_litres = sum(abs(trimesh.Trimesh(V, F, process=False).volume) for V, F in closed) * 1000
    litres = grid.sum() * pitch**3 * 1000
    if litres < source_litres * LEAST_SOLID_SHARE:
        raise SystemExit(f"A solid came out at {litres:.3f} L from a source of {source_litres:.3f} L, so it is hollow. Look at its wrap before shipping this.")
    return grid, lo


def wrap(meshes, pitch, close, sigma, target, keep_largest=True, smoothing=8):
    grid, lo = solid_grid(meshes, pitch, close, keep_largest)
    V, F, _, _ = measure.marching_cubes(ndi.gaussian_filter(grid.astype(np.float32), sigma), 0.5)
    V, F = V * pitch + lo, F[:, ::-1].astype(np.int64)
    V, F = decimate(taubin(V, F, smoothing), F, target)
    edges = np.linalg.norm(V[F] - V[F[:, [1, 2, 0]]], axis=2).max()
    if edges > LONGEST_EDGE:
        raise SystemExit(f"A wrap has a {edges * 1000:.0f} mm edge after decimating, which draws as a spike. Raise its target triangles.")
    print(f"    {grid.sum() * pitch**3 * 1000:.3f} L, {len(F)} triangles, longest edge {edges * 1000:.0f} mm")
    return V, F


# ---------------------------------------------------------------------------------------------
# Lines and tubes
# ---------------------------------------------------------------------------------------------
def walked(path):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]


def resampled(path, spacing, *alongside):
    at = walked(path)
    keep = np.r_[True, np.diff(at) > 1e-9]
    path, at = path[keep], at[keep]
    t = np.linspace(0, at[-1], max(2, int(round(at[-1] / spacing)) + 1))
    out = np.stack([np.interp(t, at, path[:, k]) for k in range(3)], axis=1)
    return (out, *[np.interp(t, at, a[keep]) for a in alongside])


def turning(path):
    before, after = path[1:-1] - path[:-2], path[2:] - path[1:-1]
    cosine = (before * after).sum(1) / (np.linalg.norm(before, axis=1) * np.linalg.norm(after, axis=1)).clip(1e-9)
    return np.arccos(np.clip(cosine, -1, 1))


def tube(path, radii, sides, spacing, capped_ends=True):
    """A tube round a path, closed unless it meets another. Also gives each vertex's distance along the path."""
    centre, r = resampled(path, spacing, radii)
    at = walked(centre)
    tangent = unit(np.gradient(centre, axis=0))
    up = np.cross(tangent[0], [0.0, 1.0, 0.0] if abs(tangent[0, 1]) < 0.9 else [1.0, 0.0, 0.0])
    up = unit(up)
    angles = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    rings = []
    for k in range(len(centre)):
        up = unit(up - tangent[k] * (up @ tangent[k]))
        side = np.cross(tangent[k], up)
        rings.append(centre[k] + r[k] * (np.cos(angles)[:, None] * up + np.sin(angles)[:, None] * side))
    n = len(centre)
    V = np.vstack(rings + [centre[:1], centre[-1:]])
    a = np.arange(n - 1)[:, None] * sides + np.arange(sides)
    b = np.arange(n - 1)[:, None] * sides + (np.arange(sides) + 1) % sides
    F = np.vstack([np.stack([a, b, a + sides], -1).reshape(-1, 3), np.stack([b, b + sides, a + sides], -1).reshape(-1, 3)])
    first, last = n * sides, n * sides + 1
    j = np.arange(sides)
    caps = np.vstack([np.c_[np.full(sides, first), (j + 1) % sides, j], np.c_[np.full(sides, last), (n - 1) * sides + j, (n - 1) * sides + (j + 1) % sides]])
    along = np.r_[np.repeat(at, sides), at[0], at[-1]]
    return V, (np.vstack([F, caps]) if capped_ends else F).astype(np.int64), along


def relaxed_bowel(path, radii):
    """Z-Anatomy's tube packs the belly the way a real gut does, but a little under half of its length runs through its
    neighbours. The strands push each other apart and stiffness keeps the loops round. Nothing moves further than the
    gap between strands, so nothing can cross, and the ends stay where they join the duodenum and the colon."""
    spacing = BOWEL["spacing"]
    path, r = resampled(path, spacing, radii)
    n = len(path)
    skip = int(np.ceil(0.05 / spacing))
    gaps = 0
    for step in range(BOWEL["steps"]):
        force = np.zeros_like(path)
        along = path[1:] - path[:-1]
        lengths = np.linalg.norm(along, axis=1, keepdims=True).clip(1e-6)
        pull = BOWEL["pull"] * (lengths - spacing) * along / lengths
        force[:-1] += pull
        force[1:] -= pull
        force[2:-2] += BOWEL["bending"] * (4 * (path[1:-3] + path[3:-1]) - 6 * path[2:-2] - path[:-4] - path[4:])
        pairs = cKDTree(path).query_pairs(float(r.max()) * 2 * BOWEL["apart"], output_type="ndarray")
        pairs = pairs[np.abs(pairs[:, 0] - pairs[:, 1]) > skip]
        gaps = 0
        if len(pairs):
            gap = path[pairs[:, 0]] - path[pairs[:, 1]]
            d = np.linalg.norm(gap, axis=1, keepdims=True).clip(1e-6)
            wanted = ((r[pairs[:, 0]] + r[pairs[:, 1]]) * BOWEL["apart"])[:, None]
            close = (d < wanted)[:, 0]
            gaps = int(close.sum())
            push = BOWEL["push"] * (wanted[close] - d[close]) * gap[close] / d[close]
            np.add.at(force, pairs[close, 0], push)
            np.add.at(force, pairs[close, 1], -push)
        size = np.linalg.norm(force, axis=1, keepdims=True).clip(1e-9)
        force *= np.minimum(1, BOWEL["largest_move"] / size)
        force[0] = force[-1] = 0
        path = path + force
    # Bends sharper than the tube itself would turn its inner wall inside out.
    for _ in range(BOWEL["most_easing"]):
        tight = np.r_[False, turning(path) > spacing / (r[1:-1].min() * BOWEL["tightest_bend"]), False]
        if not tight.any():
            break
        around = ndi.binary_dilation(tight, iterations=3)
        between = np.zeros_like(path)
        between[1:-1] = 0.5 * (path[:-2] + path[2:]) - path[1:-1]
        path = path + 0.5 * around[:, None] * between
    print(f"  bowel: {walked(path)[-1]:.2f} m, {n} points, {gaps} sample pairs still touching, tightest bend {spacing / turning(path).max() / r.min():.2f} radii")
    return path, r


def inside_path(mesh, start_near, end_near, pitch=0.001):
    """A path down the middle of a closed part: hugging a wall costs a lot, so the cheapest way runs along the centre."""
    grid, lo = solid_grid([mesh], pitch, 1, True)
    depth = ndi.distance_transform_edt(grid) * pitch
    solid = np.argwhere(grid)
    centres = (solid + 0.5) * pitch + lo

    def deepest_near(point):
        distance = np.linalg.norm(centres - point, axis=1)
        near = distance < distance.min() + 0.012
        return tuple(solid[near][np.argmax(depth[tuple(solid[near].T)])])

    cost = np.where(grid, 1 / (depth + pitch) ** 2, 1e9)
    line, _ = route_through_array(cost, deepest_near(start_near), deepest_near(end_near), fully_connected=True, geometric=True)
    line = (np.array(line) + 0.5) * pitch + lo
    return ndi.gaussian_filter1d(line, 4, axis=0, mode="nearest")


# ---------------------------------------------------------------------------------------------
# The stomach's sections
# ---------------------------------------------------------------------------------------------
def stomach_sections(V, cardia, pylorus, esophagus):
    """The real shape as sections from the lesser to the greater curvature, for the loft in stomach.ts."""
    centred = V - V.mean(0)
    axes = np.linalg.svd(centred, full_matrices=False)[2]
    across = axes[0] * np.sign(axes[0, 0])
    lift = axes[2] * np.sign(axes[2, 2])
    down = np.cross(lift, across)
    down = down * np.sign(-down[1])
    lift = unit(np.cross(across, down))
    lift = lift * np.sign(lift[2])
    a, b, w = (V - cardia) @ across, (V - cardia) @ down, (V - cardia) @ lift
    pixel = STOMACH["pixel"]
    lo = np.array([a.min(), b.min()]) - pixel * 6
    mask = np.zeros((int((a.max() - lo[0]) / pixel) + 8, int((b.max() - lo[1]) / pixel) + 8), bool)
    at = ((np.c_[a, b] - lo) / pixel).astype(int)
    mask[at[:, 0], at[:, 1]] = True
    mask = ndi.binary_fill_holes(ndi.binary_closing(mask, iterations=4))
    outline = max(measure.find_contours(mask.astype(float), 0.5), key=len)[:-1] * pixel + lo
    outline = ndi.gaussian_filter1d(outline, STOMACH["outline_smoothing"], axis=0, mode="wrap")
    in_plane = lambda p: np.array([(p - cardia) @ across, (p - cardia) @ down])
    i_cardia = int(np.argmin(np.linalg.norm(outline - in_plane(cardia), axis=1)))
    outline = np.roll(outline, -i_cardia, axis=0)
    i_pylorus = int(np.argmin(np.linalg.norm(outline - in_plane(pylorus), axis=1)))
    arcs = outline[: i_pylorus + 1], np.vstack([outline[i_pylorus:], outline[:1]])[::-1]
    arc_length = lambda arc: np.r_[0, np.cumsum(np.linalg.norm(np.diff(arc, axis=0), axis=1))]
    lesser, greater = sorted(arcs, key=lambda arc: arc_length(arc)[-1])
    ts = np.array(STOMACH["section_at"])

    def on(arc):
        length = arc_length(arc)
        return np.stack([np.interp(ts * length[-1], length, arc[:, k]) for k in range(2)], axis=1)

    inner, outer = on(lesser), on(greater)
    outer = inner + (outer - inner) * np.interp(ts, [0, 0.12, 0.8, 1], [1, STOMACH["full_stretch"], STOMACH["full_stretch"], 1])[:, None]
    mids = (inner + outer) / 2
    lifts = []
    for mid in mids:
        near = np.linalg.norm(np.c_[a, b] - mid, axis=1) < 0.03
        lifts.append(float(np.median(w[near])) if near.any() else 0.0)
    return dict(
        origin=np.round(cardia, 5).tolist(),
        across=np.round(across, 5).tolist(),
        down=np.round(down, 5).tolist(),
        lift=np.round(lift, 5).tolist(),
        sections=[dict(inner=np.round(inner[i], 5).tolist(), outer=np.round(outer[i], 5).tolist(), lift=round(lifts[i], 5)) for i in range(len(ts))],
        center=np.round([float(a.mean()), float(b.mean())], 5).tolist(),
        esophagus=np.round(resampled(esophagus, 0.03)[0], 4).tolist(),
    )


# ---------------------------------------------------------------------------------------------
# Vessels
# ---------------------------------------------------------------------------------------------
def limb_of(source, name):
    """Which limb a vessel belongs to, from the tree the file keeps of what branches from what."""
    for ancestor in [name, *source.ancestors(name)]:
        side = ancestor[-1].upper() if ancestor[-2:] in (".l", ".r") else None
        if side and ARM_ROOT.search(ancestor):
            return f"arm.{side}"
        if side and LEG_ROOT.search(ancestor):
            return f"leg.{side}"
    return None


def clipped_at_wrist(P, r, sk):
    """Keeps a line up to where it passes into the hand, whose source pose the warp can't follow."""
    for side in "RL":
        W, E = sk.joint("wrist", side), sk.joint("elbow", side)
        axis = unit(W - E)
        past = (P - W) @ axis > 0.0
        near = np.linalg.norm(P - W, axis=1) < 0.25
        if (past & near).any():
            first = int(np.argmax(past & near))
            return P[:first], r[:first]
    return P, r


def vessel_lines(source, sk, sex):
    lines = []
    for name in source.curves_in("5:"):
        if VESSEL_SKIP.search(name) or (sex == "female" and ONLY_MALE_VESSEL.search(name)):
            continue
        for P, r in source.splines(name):
            limb = limb_of(source, name)
            if limb and limb.startswith("arm"):
                P, r = clipped_at_wrist(P, r, sk)
            if len(P) < 2 or r.max() < VESSEL_LEAST_RADIUS:
                continue
            lines.append(dict(name=name, P=P, r=r, vein=bool(VEIN.search(name)), limb=limb))
    return lines


def skin_for(P, limb, ref, cache):
    """How each point follows the skeleton. A vessel in the trunk stays with the organs, which ride on the hips. One in a
    limb follows that limb's joints, and takes the skin's weights so it blends where the limb meets the trunk."""
    n = len(P)
    hips = JOINT_NAMES.index("hips")
    if limb is None:
        index, weight = np.zeros((n, 4), np.uint8), np.zeros((n, 4), np.uint8)
        index[:, 0] = hips
        weight[:, 0] = 255
        return index, weight
    kind, side = limb.split(".")
    joints = {"arm": ["arm", "forearm", "hand"], "leg": ["thigh", "shin", "foot"]}[kind]
    allowed = [JOINT_NAMES.index(f"{j}.{side}") for j in joints]
    if limb not in cache:
        cache[limb] = cKDTree(ref.V)
    d, near = cache[limb].query(P, k=6)
    w = 1 / (d + 0.012) ** 2
    w /= w.sum(1, keepdims=True)
    dense = (ref.dense[near] * w[..., None]).sum(1)
    kept = dense[:, allowed]
    collapsed = np.c_[kept, np.maximum(1 - kept.sum(1), 0)]
    order = np.argsort(-collapsed, axis=1)[:, :4]
    values = np.take_along_axis(collapsed, order, axis=1)
    values /= values.sum(1, keepdims=True).clip(1e-6)
    joint_ids = np.array([*allowed, hips])[order]
    q = np.round(values * 255).astype(int)
    q[:, 0] += 255 - q.sum(1)
    return joint_ids.astype(np.uint8), q.astype(np.uint8)


def tier_of(radius):
    return next((i for i, least in enumerate(TIER_RADII) if radius >= least), len(TIER_RADII) - 1)


def sides_for(radius):
    return next(sides for least, sides in SIDES_FOR_RADIUS if radius < least)


def vessel_meshes(lines, fit, source_lines_warped, ref, add):
    """One mesh for arteries and one for veins, largest vessels first, so a view draws a tier by drawing fewer triangles."""
    out, report = {}, {}
    cache = {}
    for group, vein in (("arteries", False), ("veins", True)):
        rows = [[] for _ in TIER_RADII]
        for line, P in zip(lines, source_lines_warped):
            if line["vein"] != vein:
                continue
            spacing = float(np.clip(np.median(line["r"]) * 2.2, *RING_SPACING))
            radius = float(line["r"].max())
            # Vessels are see-through and overlap where they join, so a cap would draw as a disc.
            V, F, _ = tube(P, np.maximum(line["r"], 0.0004), sides_for(radius), spacing, capped_ends=False)
            index, weight = skin_for(V, line["limb"], ref, cache)
            rows[tier_of(radius)].append((V, F, index, weight))
        Vs, Fs, Is, Ws, offset, counts = [], [], [], [], 0, []
        for tier in rows:
            for V, F, index, weight in tier:
                Vs.append(V)
                Fs.append(F + offset)
                Is.append(index)
                Ws.append(weight)
                offset += len(V)
            counts.append(sum(int(F.size) for _, F, _, _ in tier) + (counts[-1] if counts else 0))
        V, F = np.vstack(Vs), np.vstack(Fs)
        out[group] = entry(add, V, F)
        out[group]["tiers"] = [dict(leastRadius=least, indexCount=count) for least, count in zip(TIER_RADII, counts)]
        out[group]["skinIndex"] = add(np.vstack(Is))
        out[group]["skinWeight"] = add(np.vstack(Ws))
        report[group] = [c // 3 for c in counts]
    print("  vessel triangles by tier", report)
    return out


def entry(add, V, F, along=None):
    row = {
        "pos": add(np.round(V * Q).astype(np.int16)),
        "vertexCount": len(V),
        "index": add(F.astype(np.uint32)),
        "indexCount": int(F.size),
        "center": np.round(V.mean(0), 4).tolist(),
        "min": np.round(V.min(0), 4).tolist(),
        "max": np.round(V.max(0), 4).tolist(),
    }
    if along is not None:
        row["along"] = add(along.astype(np.float32))
    return row


# ---------------------------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------------------------
def nearest(points, to):
    return points[np.argmin(np.linalg.norm(points - to, axis=1))]


def touching(a, b):
    d, i = cKDTree(a).query(b)
    j = int(np.argmin(d))
    return (b[j] + a[i[j]]) / 2


def rounded(p):
    return np.round(p, 4).tolist()


def build_sources(source):
    """Everything that is the same for both bodies, in Z-Anatomy's frame."""
    parts = {}
    for name, (objects, pitch, close, sigma, target) in ORGANS.items():
        print(f"  wrapping {name}")
        parts[name] = wrap([source.mesh(o) for o in objects], pitch, close, sigma, target, name not in SEVERAL_PIECES, SMOOTHING_PASSES.get(name, 8))
    brain_parts = [n for n in source.meshes_in("7:") if BRAIN_PARTS.search(n) and source.mesh(n)[0][:, 1].min() > 1.5]
    print(f"  wrapping brain from {len(brain_parts)} parts")
    parts["brain"] = wrap([source.mesh(n) for n in brain_parts], BRAIN["pitch"], BRAIN["close"], BRAIN["sigma"], BRAIN["target"], smoothing=BRAIN["taubin"])
    trachea = decimate(*source.mesh(AIRWAY["trachea"]), AIRWAY["trachea_target"])
    return parts, trachea


def build(sex, source, parts, trachea, fit, sk, female, cache):
    print(sex)
    chunks, offset = [], 0

    def add(arr):
        nonlocal offset
        data = arr.tobytes()
        pad = (-len(data)) % 4
        chunks.append(data + b"\0" * pad)
        start = offset
        offset += len(data) + pad
        return start

    meta = {"quant": Q, "organs": {}, "landmarks": {}, "centerlines": {}, "vesselRadius": {}}
    placed = {}
    inside = {}
    for name, (V, F) in parts.items():
        if sex == "female" and name in ONLY_MALE:
            continue
        placed[name] = (contain(fit(V), fit.ref)[0], F)
        inside[name] = fit.inside_share(placed[name][0])
        meta["organs"][name] = entry(add, *placed[name])
    if sex == "female":
        for name, (V, F) in female.items():
            placed[name] = (V, F)
            inside[name] = fit.inside_share(V)
            meta["organs"][name] = entry(add, V, F)

    # The airway: the trachea's real surface, and bronchi from their curves.
    pieces = [(fit(trachea[0]), trachea[1])]
    for name in BRONCHI:
        for P, r in source.splines(name):
            V, F, _ = tube(fit(P), np.maximum(r, AIRWAY["least_radius"]), AIRWAY["sides"], 0.004)
            pieces.append((V, F))
    vs, fs, shift = [], [], 0
    for V, F in pieces:
        vs.append(V)
        fs.append(F + shift)
        shift += len(V)
    placed["airway"] = (np.vstack(vs), np.vstack(fs))
    meta["organs"]["airway"] = entry(add, *placed["airway"])

    # The small intestine, starting where the duodenum ends.
    P, r = source.main_spline(BOWEL["curve"])
    bowel_path, bowel_r = relaxed_bowel(fit(P)[::-1], r[::-1])
    V, F, along = tube(bowel_path, bowel_r, BOWEL["sides"], BOWEL["ring_spacing"])
    meta["organs"]["small_intestine"] = entry(add, V, F, along)
    inside["small_intestine"] = fit.inside_share(V)
    halfway = int(len(bowel_path) * BOWEL["jejunum_share"])
    meta["centerlines"]["jejunum"] = rounded(bowel_path[: halfway + 1])
    meta["centerlines"]["ileum"] = rounded(bowel_path[halfway:])

    # Where things join and where stops attach.
    stomach = fit(source.mesh("Stomach")[0])
    esophagus = fit(source.main_spline("Oesophagus")[0])
    if esophagus[0, 1] < esophagus[-1, 1]:
        esophagus = esophagus[::-1]
    cardia = esophagus[-1]
    duodenum_mesh = parts["duodenum"]
    duodenum_top_near = source.mesh("Stomach")[0][np.argmin(source.mesh("Stomach")[0][:, 0])]
    duodenum = fit(inside_path(duodenum_mesh, duodenum_top_near, source.main_spline(BOWEL["curve"])[0][-1]))
    meta["centerlines"]["duodenum_inside"] = rounded(np.vstack([duodenum, bowel_path[:1]]))
    pylorus = duodenum[0]
    meta["stomach"] = stomach_sections(stomach, cardia, pylorus, esophagus)

    colon = {key: fit(source.mesh(name)[0][::5]) for key, name in (("ascending_colon", "Ascending colon"), ("transverse_colon", "Transverse colon"), ("descending_colon", "Descending colon"), ("sigmoid", "Sigmoid colon"))}
    sigmoid = colon.pop("sigmoid")  # its lower end is the rectum and anal canal
    low, high = sigmoid[:, 1].min(), sigmoid[:, 1].max()
    L = meta["landmarks"]
    for key, points in colon.items():
        L[key] = rounded(points.mean(0))
    L["sigmoid_colon"] = rounded(sigmoid[sigmoid[:, 1] > low + (high - low) * 0.6].mean(0))
    L["rectum"] = rounded(sigmoid[sigmoid[:, 1] < low + (high - low) * 0.3].mean(0))
    L["hepatic_flexure_of_colon"] = rounded(touching(colon["ascending_colon"], colon["transverse_colon"]))
    L["splenic_flexure_of_colon"] = rounded(touching(colon["transverse_colon"], colon["descending_colon"]))
    L["ileocecal_valve"] = rounded(bowel_path[-1])
    L["jejunum_end"] = rounded(bowel_path[halfway])
    for key, name in (("right_cardiac_atrium", "Right atrium"), ("left_cardiac_atrium", "Left atrium"), ("heart_left_ventricle", "Left ventricle"), ("heart_right_ventricle", "Right ventricle")):
        L[key] = rounded(fit(source.mesh(name)[0][::9]).mean(0))
    aorta = fit(source.main_spline("Ascending aorta")[0])
    left_ventricle = np.array(L["heart_left_ventricle"])
    L["aortic_valve"] = rounded(nearest(aorta[[0, -1]], left_ventricle))
    portal = fit(source.main_spline("Hepatic portal vein")[0])
    L["porta_hepatis"] = rounded(portal[np.argmax(portal[:, 1])])
    L["body_of_pancreas"] = rounded(np.median(placed["pancreas"][0], axis=0))
    for side, word in (("L", "Left"), ("R", "Right")):
        kidney = placed[f"kidney_{side}"][0].mean(0)
        L[f"hilum_of_kidney_{side}"] = rounded(nearest(fit(source.main_spline(f"{word} renal vein")[0]), kidney))
        ureter = fit(source.main_spline(f"Ureter.{side.lower()}")[0])
        L[f"ureteral_orifice_{side}"] = rounded(ureter[np.argmin(ureter[:, 1])])
    L["trachea"] = rounded(fit(source.mesh("Trachea")[0][::5]).mean(0))
    stomach_centre = stomach.mean(0)
    L["esophageal_impression_of_liver"] = rounded(cardia)
    L["gastric_surface_of_spleen"] = rounded(nearest(placed["spleen"][0], stomach_centre))
    L["gastric_impression_of_liver"] = rounded(nearest(placed["liver"][0], stomach_centre))
    L["duodenum_superior"] = rounded(pylorus)
    splenic = fit(source.main_spline("Splenic artery")[0])
    L["hilum_of_spleen"] = rounded(touching(placed["spleen"][0], splenic))

    # The colon's inside, from the valve to the anal canal.
    sigmoid_source = source.mesh("Sigmoid colon")[0]
    meta["centerlines"]["colon_inside"] = rounded(fit(inside_path(parts["large_intestine"], source.main_spline(BOWEL["curve"])[0][0], sigmoid_source[np.argmin(sigmoid_source[:, 1])], pitch=0.002)))

    # Vessels and the lines through them.
    lines = vessel_lines(source, sk, sex)
    joined = np.vstack([line["P"] for line in lines])
    moved = fit(joined)
    warped, at = [], 0
    for line in lines:
        warped.append(moved[at : at + len(line["P"])])
        at += len(line["P"])
    meta["organs"].update(vessel_meshes(lines, fit, warped, fit.ref, add))
    inside_vessels = {}
    for key, test in (("trunk", lambda l: l["limb"] is None), ("limbs", lambda l: l["limb"] is not None)):
        points = [p for line, p in zip(lines, warped) if test(line)]
        inside_vessels[key] = fit.inside_share(np.vstack(points), samples=4000)
    print("  vessels inside the skin", {k: round(v * 100, 1) for k, v in inside_vessels.items()})

    for key, name in NAMED_VESSELS.items():
        meta["centerlines"][key] = rounded(fit(source.main_spline(name)[0])[::2])
        meta["vesselRadius"][key] = round(float(np.median(source.main_spline(name)[1])), 4)
    meta["centerlines"]["hepatic_portal_vein"] = meta["centerlines"]["portal_vein"]
    for name in source.curves_in("5:"):
        P, r = source.main_spline(name) if source.splines(name) else (None, None)
        if P is None or np.median(r) < NAMED_FOR_INJURY_RADIUS or (sex == "female" and ONLY_MALE_VESSEL.search(name)):
            continue
        if not VESSEL_SKIP.search(name) and name not in NAMED_VESSELS.values():
            key = re.sub(r"[^a-z0-9]+", "_", re.sub(r"\.[lr]$", "", name).lower()).strip("_") + {".l": "_L", ".r": "_R"}.get(name[-2:], "")
            meta["centerlines"][key] = rounded(fit(P)[::2])
            meta["vesselRadius"][key] = round(float(np.median(r)), 4)
    meta["limbRoutes"] = {}
    for route, names in LIMB_ROUTES.items():
        path = [fit(source.main_spline(n)[0]) for n in names]
        walk = [path[0] if np.linalg.norm(path[0][-1] - path[1][0]) < np.linalg.norm(path[0][0] - path[1][0]) else path[0][::-1]]
        for piece in path[1:]:
            walk.append(piece if np.linalg.norm(piece[0] - walk[-1][-1]) < np.linalg.norm(piece[-1] - walk[-1][-1]) else piece[::-1])
        points = resampled(np.vstack(walk), 0.008)[0]
        limb = ("arm." if route.startswith("arm") else "leg.") + route[-1]
        index, weight = skin_for(points, limb, fit.ref, {})
        meta["limbRoutes"][route] = dict(points=rounded(points), skinIndex=index.tolist(), skinWeight=weight.tolist())

    for name, share in inside.items():
        if share < LEAST_INSIDE["organ"]:
            raise SystemExit(f"{sex} {name}: only {share:.1%} lands inside the skin. Look at the warp or the part before shipping this.")
    if inside_vessels["trunk"] < LEAST_INSIDE["vessel"] or inside_vessels["limbs"] < LEAST_INSIDE["vessel"]:
        raise SystemExit(f"{sex}: vessels inside the skin {inside_vessels}. Look at VESSEL_SKIP or the warp before shipping this.")
    meta["fit"] = dict(organInside={k: round(v, 4) for k, v in inside.items()}, vesselInside={k: round(v, 4) for k, v in inside_vessels.items()})
    print("  organs inside the skin", {k: round(v * 100, 1) for k, v in inside.items()})
    (OUT / f"organs-{sex}.bin").write_bytes(b"".join(chunks))
    (OUT / f"organs-{sex}.json").write_text(json.dumps(meta))
    print(f"  {offset / 1e6:.2f} MB, json {(OUT / f'organs-{sex}.json').stat().st_size / 1e3:.0f} kB")


def main():
    folder, cache, female_folder = (Path(a) for a in sys.argv[1:4])
    source = ZAnatomy(folder)
    sk, fits = fit_bodies(source, cache)
    parts, trachea = build_sources(source)
    female = dict(np.load(female_folder / "female_organs.npz"))
    female = {name: (female[f"{name}_V"].astype(float), female[f"{name}_F"].astype(np.int64)) for name in ("uterus", "ovary_L", "ovary_R", "tube_L", "tube_R")}
    build("male", source, parts, trachea, fits["male"], sk, None, cache)
    build("female", source, parts, trachea, fits["female"], sk, female, cache)


if __name__ == "__main__":
    main()
