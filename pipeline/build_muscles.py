"""Turns Z-Anatomy's muscles and bones into one file fitted to both Anny reference bodies.

Every part is rewrapped into a closed surface in Z-Anatomy's frame, decimated, then moved into each reference body by
the warp in body_warp.py. Limb bones stay rigid in the skeleton pass and hand bones are placed on Anny's own finger bones,
because the source hand is posed differently.

Usage: build_muscles.py <folder fetch_zanatomy.sh wrote> <cache folder>
"""
import json, re, sys, warnings
from pathlib import Path
import numpy as np, trimesh, fast_simplification
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import measure

from body_warp import OUT, JOINT_NAMES, decimate, scan_solid, taubin, refs, signed_distance_estimate, smoothstep, unit, vertex_normals, winding_inside, contain, fit_bodies
from zanatomy import ZAnatomy, base_name, side_of

warnings.filterwarnings("ignore")
rng = np.random.default_rng(7)

GROUPS = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "abs", "glutes", "quads", "hamstrings", "calves", "other"]
SEXES = ("male", "female")

# ---------------------------------------------------------------------------------------------
# Catalogue, over names with their side and any trailing "muscle" removed. First match wins. `detail` multiplies a
# muscle's share of the triangle budget. `fibre` says how the fibres run: "axis" lies flat along the long axis,
# "spindle" runs lengthwise around a rounded muscle and gathers at its ends, ("fan", landmark) converges on an
# insertion, ("wrap", degrees) winds around the trunk at that angle from horizontal.
# ---------------------------------------------------------------------------------------------
MUSCLES = [
    (r"(clavicular|sternocostal) head of pectoralis major|abdominal part of pectoralis major", "chest", 1.5, ("fan", "pec_insertion")),
    (r"^pectoralis minor$", "chest", 0.3, ("fan", "coracoid")),
    (r"part of trapezius", "back", 1.4, "axis"),
    (r"^latissimus dorsi$", "back", 1.5, ("fan", "lat_insertion")),
    (r"^rhomboid (major|minor)$", "back", 0.6, "axis"),
    (r"^iliocostalis (lumborum|thoracis|colli)$", "back", 0.45, "axis"),
    (r"^longissimus (thoracis|colli)$", "back", 0.45, "axis"),
    (r"^spinalis thoracis$", "back", 0.3, "axis"),
    (r"^teres (major|minor)$", "back", 0.9, "axis"),
    (r"part of deltoid", "shoulders", 1.5, ("fan", "deltoid_tuberosity")),
    (r"^infraspinatus$", "shoulders", 0.8, "axis"),
    (r"^supraspinatus$", "shoulders", 0.4, "axis"),
    (r"^subscapularis$", "shoulders", 0.2, "axis"),
    (r"head of biceps brachii", "biceps", 1.4, "spindle"),
    (r"^brachialis$", "biceps", 0.7, "spindle"),
    (r"head of triceps brachii", "triceps", 1.3, "spindle"),
    (r"^anconeus$", "triceps", 0.4, "spindle"),
    (r"^brachioradialis$", "forearms", 1.0, "spindle"),
    (r"head of pronator teres", "forearms", 0.3, "axis"),
    (r"^flexor carpi radialis$", "forearms", 0.7, "spindle"),
    (r"head of flexor carpi ulnaris", "forearms", 0.35, "spindle"),
    (r"^palmaris longus$", "forearms", 0.5, "spindle"),
    (r"head of flexor digitorum superficialis", "forearms", 0.3, "spindle"),
    (r"^flexor digitorum profundus$", "forearms", 0.6, "spindle"),
    (r"^flexor pollicis longus$", "forearms", 0.3, "spindle"),
    (r"^extensor carpi radialis (longus|brevis)$", "forearms", 0.7, "spindle"),
    (r"head of extensor carpi ulnaris", "forearms", 0.35, "spindle"),
    (r"^extensor (digitorum|digiti minimi)$", "forearms", 0.7, "spindle"),
    (r"^(abductor pollicis longus|extensor pollicis (longus|brevis)|extensor indicis)$", "forearms", 0.3, "spindle"),
    (r"^supinator$", "forearms", 0.2, "spindle"),
    (r"^rectus abdominis$", "abs", 1.6, "axis"),
    (r"^external abdominal oblique$", "abs", 1.3, ("wrap", 55)),
    (r"^internal abdominal oblique$", "abs", 0.25, ("wrap", -45)),
    (r"^linea alba$", "abs", 0.2, "axis"),
    (r"^gluteus maximus$", "glutes", 1.5, "axis"),
    (r"^gluteus medius$", "glutes", 0.9, ("fan", "greater_trochanter")),
    (r"^gluteus minimus$", "glutes", 0.25, ("fan", "greater_trochanter")),
    (r"^rectus femoris$", "quads", 1.3, "spindle"),
    (r"^vastus (lateralis|medialis)$", "quads", 1.3, "spindle"),
    (r"^vastus intermedius$", "quads", 0.3, "spindle"),
    (r"head of biceps femoris", "hamstrings", 1.2, "spindle"),
    (r"^(semimembranosus|semitendinosus)$", "hamstrings", 1.2, "spindle"),
    (r"head of gastrocnemius", "calves", 1.4, "spindle"),
    (r"^soleus$", "calves", 1.0, "spindle"),
    (r"^calcaneal tendon$", "calves", 0.3, "axis"),
    # The quiet rest of the figure.
    (r"^sartorius$", "other", 0.8, "spindle"),
    (r"^gracilis$", "other", 0.5, "spindle"),
    (r"^pectineus$", "other", 0.3, "spindle"),
    (r"^adductor (longus|brevis|magnus)$", "other", 0.6, "spindle"),
    (r"^tensor fasciae latae$", "other", 0.4, "spindle"),
    (r"^iliotibial tract$", "other", 0.5, "axis"),
    (r"^psoas major$", "other", 0.25, "axis"),
    (r"^iliacus$", "other", 0.2, ("fan", "lesser_trochanter")),
    (r"^tibialis (anterior|posterior)$", "other", 0.6, "spindle"),
    (r"^extensor (digitorum|hallucis) longus$", "other", 0.5, "spindle"),
    (r"^fibularis (longus|brevis)$", "other", 0.5, "spindle"),
    (r"^flexor (digitorum|hallucis) longus$", "other", 0.2, "spindle"),
    (r"^popliteus$", "other", 0.15, "axis"),
    (r"^sternocleidomastoid$", "other", 0.8, "spindle"),
    (r"^splenius (capitis|colli)$", "other", 0.4, "axis"),
    (r"^semispinalis colli$", "other", 0.25, "axis"),
    (r"^levator scapulae$", "other", 0.35, "spindle"),
    (r"^scalenus (anterior|medius|posterior)$", "other", 0.25, "spindle"),
    (r"^(omohyoid|sternohyoid|sternothyroid|thyrohyoid)$", "other", 0.2, "axis"),
    (r"^serratus anterior$", "other", 0.9, ("wrap", 15)),
    (r"^serratus posterior (superior|inferior)$", "other", 0.2, "axis"),
    (r"^coracobrachialis$", "other", 0.35, "spindle"),
    (r"^subclavius$", "other", 0.1, "axis"),
    (r"^external intercostal$", "other", 0.6, ("wrap", 50)),
]

ORDINAL = "(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)"
HAND_CARPAL = r"^(scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate) bone$"
FOOT_TARSAL = r"^(calcaneus|talus|navicular bone|cuboid bone|(medial|intermediate|lateral) cuneiform bone)$"
# (pattern, shared part name or None, joint or None, detail). `{side}` joints are per side and bind the whole bone
# rigidly, None takes per-vertex weights from the skin. A shared name wraps every match into one surface, which is what
# fuses a skull out of its 20-odd bones.
BONES = [
    (r"^(frontal bone|occipital bone|sphenoid bone|ethmoid bone)$", "cranium", "head", 4.0),
    (r"^(parietal bone|temporal bone|zygomatic bone|maxilla|nasal bone|lacrimal bone|palatine bone|upper .*(molar tooth|premolar|canine|incisor))$", "cranium", "head", 4.0),
    (r"^(mandible|lower .*(molar tooth|premolar|canine|incisor))$", "mandible", "head", 2.5),
    (r"^hyoid bone$", None, "neck", 0.1),
    (r"^(thyroid cartilage|cricoid cartilage)$", None, "neck", 0.3),
    (r"^(atlas \(c1\)|axis \(c2\))$", None, "neck", 0.4),
    (r"^vertebra c\d$", None, "neck", 0.4),
    (r"^vertebra t\d+$", None, None, 0.55),
    (r"^vertebra l\d$", None, None, 0.7),
    (r"^sacrum$", None, "hips", 1.0),
    (r"^coccyx$", None, "hips", 0.1),
    (rf"^{ORDINAL} rib$", None, None, 0.5),
    (rf"^costal cartilage of {ORDINAL} rib$", None, None, 0.2),
    (r"^(manubrium of sternum|body of sternum|xiphoid process)$", None, None, 0.3),
    (r"^clavicle$", None, "clavicle.{side}", 0.5),
    (r"^scapula$", None, "clavicle.{side}", 1.3),
    (r"^humerus$", None, "arm.{side}", 1.2),
    (r"^radius$", None, "forearm.{side}", 0.8),
    (r"^ulna$", None, "forearm.{side}", 0.8),
    (HAND_CARPAL, None, "hand.{side}", 0.07),
    (r"^(first|second|third|fourth|fifth) metacarpal bone$", None, "hand.{side}", 0.1),
    (r"phalanx of \w+ finger of hand$", None, "hand.{side}", 0.06),
    (r"^hip bone$", None, "hips", 2.0),
    (r"^femur$", None, "thigh.{side}", 1.3),
    (r"^patella$", None, "shin.{side}", 0.25),
    (r"^tibia$", None, "shin.{side}", 1.0),
    (r"^fibula$", None, "shin.{side}", 0.6),
    (FOOT_TARSAL, None, "foot.{side}", 0.18),
    (r"^(first|second|third|fourth|fifth) metatarsal bone$", None, "foot.{side}", 0.12),
    (r"phalanx of \w+ finger of foot$", None, "foot.{side}", 0.05),
]

MUSCLE_TRIANGLES = 70000
BONE_TRIANGLES = 25000
MIN_TRIANGLES = 24
Q = 32767 / 2.5  # same quantisation as body.json
PICK_CELL = 0.022  # one pick point per cube this wide, per group, metres
PICK_RADIUS = 0.018  # how close a ray must pass a pick point to hit it, metres
THICKEN = {r"iliotibial tract": 2, r"^linea alba$": 1}  # voxels; a flat band has to clear what it lies on
ALL_TENDON = r"(iliotibial tract|calcaneal tendon|linea alba)"
TORSO_CENTRE_Z = 0.03  # midway between the sternum and the spine in the source, metres
RECTUS_FRONT_Z = 0.04  # in front of this the oblique is its aponeurosis, which would cover the rectus
RECTUS_INTERSECTIONS = (1.028, 1.088, 1.148)  # where the source rectus's own grooves lie, measured on its front face, metres
RECTUS_BAND_WIDTH = 0.0028  # half width of each, metres


# ---------------------------------------------------------------------------------------------
# Wrapping into closed surfaces
# ---------------------------------------------------------------------------------------------
def surface_points(V, F, spacing):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    counts = np.minimum(np.ceil(areas / (spacing**2 * 0.25)).astype(int) + 1, 800)
    idx = np.repeat(np.arange(len(F)), counts)
    u, v = rng.random(len(idx)), rng.random(len(idx))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[idx] + (b[idx] - a[idx]) * u[:, None] + (c[idx] - a[idx]) * v[:, None]


def wrap(meshes, pitch, close=1, sigma=0.8, keep=None, min_share=0.03, thicken=0):
    """Voxel rewrap into one closed surface. `keep` is an optional predicate on metre positions
    that trims the part. Each source mesh is closed, so voting across three scan directions gives
    its true solid even where scans graze a surface; the sampled shell keeps thin sheets alive."""
    shell = np.vstack([surface_points(V, F, pitch) for V, F in meshes])
    lo = shell.min(0) - pitch * 4
    dims = np.ceil((shell.max(0) - lo) / pitch).astype(int) + 6
    grid = np.zeros(dims, bool)
    for V, F in meshes:
        votes = sum(scan_solid(V, F, lo, pitch, dims, axis).astype(np.int8) for axis in range(3))
        grid |= votes >= 2
    ijk = ((shell - lo) / pitch).astype(int)
    grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    if close:
        grid = ndi.binary_closing(grid, iterations=close)
    grid = ndi.binary_fill_holes(grid)
    if thicken:
        grid = ndi.binary_dilation(grid, iterations=thicken)
    if keep is not None:
        solid = np.argwhere(grid)
        centres = solid * pitch + lo + pitch / 2
        grid[tuple(solid[~keep(centres)].T)] = False
    lab, n = ndi.label(grid)
    if n > 1:
        sizes = ndi.sum(grid, lab, range(1, n + 1))
        grid = np.isin(lab, 1 + np.where(sizes >= sizes.max() * min_share)[0])
    smooth = ndi.gaussian_filter(grid.astype(np.float32), sigma)
    V, F, _, _ = measure.marching_cubes(smooth, min(0.5, float(smooth.max()) * 0.6))
    half_thickness = ndi.distance_transform_edt(grid).astype(np.float32) * pitch
    return V * pitch + lo + pitch / 2, F[:, ::-1].astype(np.int64), half_thickness, lo


# ---------------------------------------------------------------------------------------------
# Per-vertex data
# ---------------------------------------------------------------------------------------------
ARM_MUSCLES = r"coracobrachialis"
LEG_MUSCLES = r"(sartorius|gracilis|pectineus|adductor|tensor fasciae|iliotibial|tibialis|longus$|fibularis|popliteus)"


def allowed_joints(part):
    """Which joints a part may take weights from, so a hand near the thigh doesn't drag on the thigh."""
    side, group, name = part["side"], part["group"], part["base"]
    sides = "LR" if side == "M" else side
    per = lambda *names: [f"{n}.{s}" for n in names for s in sides]
    if group in ("biceps", "triceps", "forearms") or re.search(ARM_MUSCLES, name):
        return per("arm", "forearm", "hand", "clavicle") + ["chest"]
    if group in ("glutes", "quads", "hamstrings", "calves") or (group == "other" and re.search(LEG_MUSCLES, name) and "pollicis" not in name):
        return per("thigh", "shin", "foot") + ["hips", "spine"]
    if re.search(r"(psoas|iliacus)", name):
        return per("thigh") + ["hips", "spine", "chest"]
    return per("clavicle", "arm") + ["hips", "spine", "chest", "neck", "head"]


def skin_weights(V, F, allowed, ref, cache):
    key = tuple(sorted(allowed))
    if key not in cache:
        idx = [JOINT_NAMES.index(n) for n in key]
        share = ref.dense[:, idx].sum(1)
        ids = np.where(share > 0.5)[0]
        cache[key] = (cKDTree(ref.V[ids]), ids, idx)
    tree, ids, idx = cache[key]
    d, near = tree.query(V, k=6)
    w = 1 / (d + 0.012) ** 2
    w /= w.sum(1, keepdims=True)
    dense = (ref.dense[ids[near]] * w[..., None]).sum(1)
    mask = np.zeros(len(JOINT_NAMES))
    mask[idx] = 1
    dense *= mask
    # A few rounds of mesh smoothing keep neighbouring vertices from tearing apart under a pose.
    pairs = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    pairs = np.unique(np.sort(pairs, axis=1), axis=0)
    for _ in range(3):
        total = np.zeros_like(dense)
        count = np.zeros(len(dense))
        np.add.at(total, pairs[:, 0], dense[pairs[:, 1]])
        np.add.at(total, pairs[:, 1], dense[pairs[:, 0]])
        np.add.at(count, pairs.ravel(), 1)
        dense = dense * 0.5 + 0.5 * total / np.maximum(count, 1)[:, None]
    return dense / dense.sum(1, keepdims=True)


def quantize_weights(dense):
    order = np.argsort(-dense, axis=1)[:, :4]
    w = np.take_along_axis(dense, order, axis=1)
    w /= w.sum(1, keepdims=True)
    q = np.round(w * 255).astype(int)
    q[:, 0] += 255 - q.sum(1)
    return order.astype(np.uint8), q.astype(np.uint8)


def nearest_on_polyline(p, joints):
    best, bestd = None, np.inf
    for a, b in zip(joints[:-1], joints[1:]):
        d = b - a
        t = np.clip((p - a) @ d / (d @ d), 0, 1)
        q = a + t * d
        if np.linalg.norm(p - q) < bestd:
            best, bestd = q, np.linalg.norm(p - q)
    return best


def fibre_coordinate(V, part, sk):
    """Position across the fibres, in metres. Lines of equal value run along the fibres."""
    c = V.mean(0)
    axes = np.linalg.svd(V - c, full_matrices=False)[2]
    spec = part["fibre"]
    side = part["side"] if part["side"] != "M" else ("L" if c[0] > 0 else "R")
    if isinstance(spec, tuple) and spec[0] == "fan":
        Q = sk.landmark(spec[1], side)
        normal = axes[2]
        o = V - Q
        o = o - (o @ normal)[:, None] * normal
        u = unit((c - Q) - ((c - Q) @ normal) * normal)
        v = np.cross(normal, u)
        angle = np.arctan2(o @ v, o @ u)
        return angle * np.linalg.norm(o, axis=1).mean()
    if isinstance(spec, tuple) and spec[0] == "wrap":
        zc = TORSO_CENTRE_Z
        radius = np.linalg.norm(np.c_[V[:, 0], V[:, 2] - zc], axis=1).mean()
        arc = radius * np.arctan2(V[:, 0], V[:, 2] - zc)
        a = np.radians(spec[1])
        sign = 1 if side == "L" else -1
        return -arc * np.sin(a) * sign + V[:, 1] * np.cos(a)
    axis = axes[0]
    if part["group"] in ("biceps", "triceps", "forearms") or re.search(ARM_MUSCLES, part["base"]):
        inner = nearest_on_polyline(c, [sk.joint(n, side) for n in ("shoulder", "elbow", "wrist")])
    elif part["group"] in ("glutes", "quads", "hamstrings", "calves") or re.search(LEG_MUSCLES, part["base"]):
        inner = nearest_on_polyline(c, [sk.joint(n, side) for n in ("hip", "knee", "ankle")])
    else:
        inner = np.array([0, c[1], TORSO_CENTRE_Z])
    outward = unit(c - inner)
    across = unit(np.cross(axis, outward))
    if spec == "axis":
        return (V - c) @ across
    # Spindle: the angle around the muscle's own centre line, unrolled, with the seam on the deep
    # side that faces the bone. Lines stay even across the belly and draw together toward the ends.
    outward = unit(np.cross(across, axis))
    t = (V - c) @ axis
    bins = np.linspace(t.min(), t.max(), 13)
    middle = (bins[:-1] + bins[1:]) / 2
    which = np.clip(np.digitize(t, bins) - 1, 0, 11)
    centres = np.array([V[which == i].mean(0) if (which == i).any() else c for i in range(12)])
    centres = ndi.gaussian_filter1d(centres, 1.0, axis=0, mode="nearest")
    centre = np.stack([np.interp(t, middle, centres[:, k]) for k in range(3)], 1)
    radial = V - centre
    u, v = radial @ outward, radial @ across
    su, sv = max(u.std(), 1e-3), max(v.std(), 1e-3)
    girth = np.pi * (su + sv)  # half the perimeter of the ellipse the section roughly is
    return np.arctan2(v / sv, u / su) * girth / np.pi


def tendon_share(V, F, half_thickness, lo, pitch):
    """1 where a part is thin for its own size, reading as tendon or aponeurosis; 0 in the belly.
    A slim muscle like the sartorius is still flesh, so thickness is judged against the part itself."""
    N = vertex_normals(V, F)
    best = np.zeros(len(V))
    for depth in np.arange(0.5, 16) * pitch:
        ijk = np.round((V - N * depth - lo) / pitch - 0.5).astype(int)
        ok = ((ijk >= 0) & (ijk < np.array(half_thickness.shape))).all(1)
        best[ok] = np.maximum(best[ok], half_thickness[tuple(ijk[ok].T)])
    typical = min(np.percentile(best, 80), 0.009)
    return 1 - smoothstep(0.3 * typical, 0.62 * typical, best)


def cavity_shade(V, F, part_of_vertex, reach=0.022, self_reach=0.009, self_gain=0.9):
    """How open each vertex is: dark in the grooves where a neighbouring part rises beside it, and in
    the part's own hollows, such as an eye socket or a carved tendinous intersection."""
    n = vertex_normals(V, F)
    tree = cKDTree(V)
    out = np.ones(len(V))
    for start in range(0, len(V), 4000):
        ids = np.arange(start, min(start + 4000, len(V)))
        near = tree.query_ball_point(V[ids], max(reach, self_reach))
        for i, nearby in zip(ids, near):
            nearby = np.array(nearby)
            o = V[nearby] - V[i]
            dist = np.linalg.norm(o, axis=1) + 1e-5
            facing = (o / dist[:, None]) @ n[i]
            same = part_of_vertex[nearby] == part_of_vertex[i]
            other = ~same & (dist < reach)
            crowding = (np.maximum(facing[other], 0) * (1 - dist[other] / reach) ** 2).sum() if other.any() else 0.0
            own = same & (dist < self_reach) & (nearby != i)
            hollow = max(facing[own].mean(), 0.0) if own.any() else 0.0
            out[i] = np.clip(1 - crowding * 0.22, 0, 1) * (1 - min(hollow * self_gain, 0.85))
    return out


# ---------------------------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------------------------
WRAP_VERSION = 4


def wrapped(name, meshes, pitch, cache, keep=None, thicken=0):
    safe = re.sub(r"[^a-z0-9]+", "_", name.lower())
    path = cache / f"wrap{WRAP_VERSION}_{safe}.npz"
    if path.exists():
        z = np.load(path)
        return z["V"], z["F"], z["half"], z["lo"], float(z["pitch"])
    V, F, half, lo = wrap(meshes, pitch, keep=keep, thicken=thicken)
    np.savez_compressed(path, V=V, F=F, half=half, lo=lo, pitch=pitch)
    return V, F, half, lo, pitch


def auto_pitch(meshes, largest, per=70):
    pts = np.vstack([m[0] for m in meshes])
    extent = np.maximum(np.ptp(pts, axis=0), 0.004)
    return float(np.clip(np.cbrt(np.prod(extent)) / per, 0.0005, largest))


def rectus_band(P):
    """Distance from the rectus abdominis' tendinous intersections, which dip a little toward the outer edge."""
    return np.min([np.abs(P[:, 1] - y + 0.1 * np.abs(P[:, 0])) for y in RECTUS_INTERSECTIONS], axis=0)


def trim_rule(name, group, side, sk, rectus):
    """Parts reach past where they should be drawn: tendons run into the hand and foot, and the oblique's aponeurosis
    covers the rectus sheath, which would hide the abs."""
    if group == "forearms":
        E, W = sk.joint("elbow", side), sk.joint("wrist", side)
        axis = unit(W - E)
        L = np.linalg.norm(W - E)
        return lambda P: (P - E) @ axis < L * 1.0
    if re.search(r"(tibialis|extensor (digitorum|hallucis) longus|fibularis|flexor (digitorum|hallucis) longus)", name):
        floor = sk.ankle[1] - 0.012
        return lambda P: P[:, 1] > floor
    if re.search(r"(external|internal) abdominal oblique", name):
        ys, xs = rectus
        return lambda P: ~((np.abs(P[:, 0]) < np.interp(P[:, 1], ys, xs) + 0.0025) & (P[:, 2] > RECTUS_FRONT_Z))
    return None


def rectus_border(meshes):
    """Lateral edge of the rectus abdominis at each height."""
    pts = np.vstack([np.c_[np.abs(V[:, 0]), V[:, 1]] for V, _ in meshes])
    ys = np.linspace(pts[:, 1].min(), pts[:, 1].max(), 60)
    xs = []
    for y in ys:
        s = pts[np.abs(pts[:, 1] - y) < 0.006]
        xs.append(np.percentile(s[:, 0], 99) if len(s) else 0)
    return ys, ndi.gaussian_filter1d(np.array(xs), 1.5, mode="nearest")


def collect(source, sk, cache):
    named = {}
    for name in source.meshes_in("4:") + source.meshes_in("1:"):
        named.setdefault(base_name(name).lower(), []).append(name)
    rectus = rectus_border([source.mesh(n) for n in named["rectus abdominis"]])
    muscles = []
    for name, sources in named.items():
        for pattern, group, detail, fibre in MUSCLES:
            if re.search(pattern, name):
                for src in sources:
                    if not src in source.row or not source.system[src].startswith("4:"):
                        continue
                    meshes = [source.mesh(src)]
                    side = side_of(src, meshes[0][0][:, 0].mean())
                    thicken = next((n for r, n in THICKEN.items() if re.search(r, name)), 0)
                    V, F, half, lo, pitch = wrapped(f"{name} {side}", meshes, auto_pitch(meshes, 0.0014), cache, trim_rule(name, group, side, sk, rectus), thicken)
                    muscles.append(dict(name=src, base=name, group=group, detail=detail, fibre=fibre, side=side, V=V, F=F, half=half, lo=lo, pitch=pitch))
                break
    muscles.sort(key=lambda m: (GROUPS.index(m["group"]), m["name"]))
    print(f"muscles: {len(muscles)} parts")
    missing = [p for p, *_ in MUSCLES if not any(re.search(p, n) for n in named)]
    if missing:
        raise SystemExit(f"These catalogue rows match nothing in Z-Anatomy: {missing}")

    shared, bones = {}, []
    for name, sources in named.items():
        for pattern, part, joint, detail in BONES:
            if re.search(pattern, name):
                for src in sources:
                    if not source.system[src].startswith("1:"):
                        continue
                    if part:
                        shared.setdefault(part, dict(joint=joint, detail=detail, meshes=[]))["meshes"].append(source.mesh(src))
                    else:
                        meshes = [source.mesh(src)]
                        side = side_of(src, meshes[0][0][:, 0].mean())
                        V, F, half, lo, pitch = wrapped(f"{name} {side}", meshes, auto_pitch(meshes, 0.0012), cache)
                        bones.append(dict(name=src, base=name, side=side, detail=detail, joint=joint.format(side=side) if joint else None, V=V, F=F, half=half, lo=lo, pitch=pitch))
                break
    for part, info in shared.items():
        V, F, half, lo, pitch = wrapped(part, info["meshes"], 0.0012, cache)
        bones.append(dict(name=part, base=part, side="M", detail=info["detail"], joint=info["joint"], V=V, F=F, half=half, lo=lo, pitch=pitch))
    print(f"bones: {len(bones)} parts")
    return muscles, bones


def assign_budget(parts, total):
    areas = np.array([trimesh.Trimesh(p["V"], p["F"], process=False).area for p in parts])
    score = np.array([p["detail"] for p in parts]) * areas**0.72
    budget = np.maximum((score / score.sum() * total).astype(int), MIN_TRIANGLES)
    budget = np.maximum((score / score.sum() * (total - (budget == MIN_TRIANGLES).sum() * MIN_TRIANGLES)).astype(int), MIN_TRIANGLES)
    for p, b in zip(parts, budget):
        p["V"], p["F"] = decimate(p["V"], p["F"], int(b))
    print(f"  decimated to {sum(len(p['F']) for p in parts)} triangles, target {total}; largest", sorted(((len(p["F"]), p["name"]) for p in parts), reverse=True)[:6])


class Writer:
    def __init__(self):
        self.chunks, self.offset = [], 0

    def add(self, arr):
        b = arr.tobytes()
        pad = (-len(b)) % 4
        self.chunks.append(b + b"\0" * pad)
        start = self.offset
        self.offset += len(b) + pad
        return start


def quant(a):
    q = np.round(a * Q)
    assert np.abs(q).max() <= 32767, np.abs(a).max()
    return q.astype(np.int16)


def main():
    folder, cache = (Path(a) for a in sys.argv[1:3])
    cache.mkdir(parents=True, exist_ok=True)
    source = ZAnatomy(folder)
    sk, fits = fit_bodies(source, cache)
    muscles, bones = collect(source, sk, cache)
    assign_budget(muscles, MUSCLE_TRIANGLES)
    assign_budget(bones, BONE_TRIANGLES)

    for p in muscles:
        p["source"] = p["V"]
        p["fibre_coord"] = fibre_coordinate(p["V"], p, sk)
        p["tendon"] = np.ones(len(p["V"])) if re.search(ALL_TENDON, p["base"]) else tendon_share(p["V"], p["F"], p["half"], p["lo"], p["pitch"])
        if p["base"] == "rectus abdominis":
            p["tendon"] = np.maximum(p["tendon"], 1 - smoothstep(RECTUS_BAND_WIDTH, RECTUS_BAND_WIDTH * 2.2, rectus_band(p["V"])))
    for p in bones:
        p["source"] = p["V"]

    hand_re = re.compile(rf"({HAND_CARPAL}|metacarpal bone$|phalanx of \w+ finger of hand$)")
    rigid_limb = {r"^humerus$": ("arm", 0), r"^(radius|ulna)$": ("arm", 1), r"^femur$": ("leg", 0), r"^(tibia|fibula)$": ("leg", 1)}

    posed, inside_report = {}, {}
    for sex in SEXES:
        print(sex)
        fit = fits[sex]
        ref, warp, field = fit.ref, fit.warp, fit.field
        scale = (ref.V[:, 1].max() - ref.V[:, 1].min()) / source_height_of(source)
        for p in muscles:
            p[sex] = field(warp(p["source"]))
        for p in bones:
            P = p["source"]
            if hand_re.search(p["base"]):
                p[sex] = fit.hands[p["side"]](p["base"], P)
                continue
            for pattern, (limb, segment) in rigid_limb.items():
                if re.search(pattern, p["base"]):
                    chain = warp.chains[f"{limb}.{p['side']}"]
                    X = chain.apply(P, rigid=segment, across=scale)
                    if segment == 0:
                        # The muscles around a hip or shoulder blend with the trunk, so the bone's
                        # head has to as well or it pokes through them.
                        t = (P - chain.Js[0]) @ chain.ds[0] / chain.Ls[0]
                        X = warp(P) + (X - warp(P)) * smoothstep(0.08, 0.32, t)[:, None]
                    p[sex] = field(X)
                    break
            else:
                p[sex] = field(warp(P))
        warped = {g: float(winding_inside(np.vstack([p[sex] for p in muscles if p["group"] == g]), ref).mean()) for g in GROUPS}
        warped["skeleton"] = float(winding_inside(np.vstack([p[sex] for p in bones]), ref).mean())
        print("  inside share from the warp alone", {k: round(v * 100, 1) for k, v in warped.items()})
        moved_total = 0
        for p in muscles + bones:
            p[sex], moved = contain(p[sex], ref)
            moved_total += moved

        # The measured fit: exact winding number on the reference shell.
        table = {g: float(winding_inside(np.vstack([p[sex] for p in muscles if p["group"] == g]), ref).mean()) for g in GROUPS}
        table["skeleton"] = float(winding_inside(np.vstack([p[sex] for p in bones]), ref).mean())
        inside_report[sex] = dict(warp=warped, final=table)
        print("  inside share", {k: round(v * 100, 1) for k, v in table.items()}, "| pulled vertices", moved_total)
        posed[sex] = ref

    write(muscles, bones, posed, sk, inside_report)


def source_height_of(source):
    skin = source.merged(source.meshes_in("9:"))[0]
    return skin[:, 1].max() - skin[:, 1].min()


def write(muscles, bones, posed, sk, inside_report):
    w = Writer()
    male = posed["male"]
    weight_cache = {}

    # Muscles.
    offs, F_all, part_of = [], [], []
    start = 0
    dense_all = []
    groups, fibres, tendons = [], [], []
    parts_meta = []
    for i, p in enumerate(muscles):
        n = len(p["source"])
        F_all.append(p["F"] + start)
        part_of.append(np.full(n, i))
        dense_all.append(skin_weights(p["male"], p["F"], allowed_joints(p), male, weight_cache))
        groups.append(np.full(n, GROUPS.index(p["group"]), np.uint8))
        fibres.append(p["fibre_coord"])
        tendons.append(p["tendon"])
        parts_meta.append(dict(name=p["name"], group=p["group"], side=p["side"], start=start, count=n))
        start += n
    F_all, part_of = np.vstack(F_all), np.concatenate(part_of)
    dense_all = np.vstack(dense_all)
    positions = {sex: np.vstack([p[sex] for p in muscles]) for sex in SEXES}
    groups = np.concatenate(groups)
    fibres = np.concatenate(fibres)
    tendons = np.concatenate(tendons)
    shade = cavity_shade(positions["male"], F_all, part_of)
    print("muscle verts", start, "tris", len(F_all), "shade mean", shade.mean().round(3))
    skin_i, skin_w = quantize_weights(dense_all)

    fibre_quant = 32767 / max(0.5, float(np.abs(fibres).max()))
    assert start < 65536
    meta_muscles = dict(
        vertexCount=int(start),
        indexCount=int(F_all.size),
        index=w.add(F_all.astype(np.uint16)),
        positions={sex: w.add(quant(positions[sex])) for sex in SEXES},
        skinIndex=w.add(skin_i),
        skinWeight=w.add(skin_w),
        group=w.add(groups),
        fibre=w.add(np.round(fibres * fibre_quant).astype(np.int16)),
        fibreQuant=fibre_quant,
        shade=w.add(np.round(shade * 255).astype(np.uint8)),
        tendon=w.add(np.round(tendons * 255).astype(np.uint8)),
    )

    # Bones.
    F_b, part_b, start_b, rows = [], [], 0, []
    for i, p in enumerate(bones):
        n = len(p["source"])
        F_b.append(p["F"] + start_b)
        part_b.append(np.full(n, i))
        if p["joint"]:
            dense = np.zeros((n, len(JOINT_NAMES)))
            dense[:, JOINT_NAMES.index(p["joint"])] = 1
        else:
            allowed = ["hips", "spine", "chest"]
            dense = skin_weights(p["male"], p["F"], allowed, male, weight_cache)
        rows.append(dense)
        start_b += n
    F_b, part_b = np.vstack(F_b), np.concatenate(part_b)
    bi, bw = quantize_weights(np.vstack(rows))
    pos_b = {sex: np.vstack([p[sex] for p in bones]) for sex in SEXES}
    shade_b = cavity_shade(pos_b["male"], F_b, part_b, reach=0.012, self_reach=0.016, self_gain=1.3)
    assert start_b < 65536
    print("bone verts", start_b, "tris", len(F_b))
    meta_bones = dict(
        vertexCount=int(start_b),
        indexCount=int(F_b.size),
        index=w.add(F_b.astype(np.uint16)),
        positions={sex: w.add(quant(pos_b[sex])) for sex in SEXES},
        skinIndex=w.add(bi),
        skinWeight=w.add(bw),
        shade=w.add(np.round(shade_b * 255).astype(np.uint8)),
    )

    # Anchors, on the big visible muscles of each group, and pick points: an even scatter of the
    # vertices near the skin, which a ray can test cheaply once they are posed.
    s_male, _, _ = signed_distance_estimate(positions["male"], male)
    sides = np.array([{"L": 0, "R": 1, "M": 2}[p["side"]] for p in muscles])[part_of]
    big = np.array([p["detail"] >= 1.0 for p in muscles])[part_of]
    MIDLINE = ("chest", "back", "abs", "glutes")
    anchors = {}
    for gi, g in enumerate(GROUPS):
        if g == "other":
            continue
        members = groups == gi
        verts = {}
        for key, mask in (("left", members & big & (sides != 1)), ("right", members & big & (sides != 0))):
            if g in MIDLINE:
                # Nothing need lie on the midline itself, as with the gap over the sternum, so each side takes its own.
                mask = members & big & (positions["male"][:, 0] * (1 if key == "left" else -1) >= 0)
            ids = np.where(mask & (s_male > -0.018))[0]
            c = positions["male"][ids].mean(0)
            verts[key] = int(ids[np.argmin(np.linalg.norm(positions["male"][ids] - c, axis=1))])
        center = {sex: np.round(positions[sex][members].mean(0), 4).tolist() for sex in SEXES}
        anchors[g] = dict(center=center, **verts)

    cells = np.floor(positions["male"] / PICK_CELL).astype(int)
    outermost = np.where(s_male > -0.03)[0]
    keys = np.c_[groups[outermost], cells[outermost]]
    _, first = np.unique(keys, axis=0, return_index=True)
    pick_vertices = np.sort(outermost[first])
    meta_pick = dict(vertices=w.add(pick_vertices.astype(np.uint16)), count=int(len(pick_vertices)), radius=PICK_RADIUS)

    meta = dict(
        quant=Q,
        groups=GROUPS,
        joints=JOINT_NAMES,
        referenceJoints={sex: np.round(refs[f"joints_{sex}"], 5).tolist() for sex in SEXES},
        referenceHeight={sex: round(float(refs[sex][:, 1].max() - refs[sex][:, 1].min()), 4) for sex in SEXES},
        referenceVolume={sex: round(float(posed[sex].mesh.volume), 5) for sex in SEXES},
        muscles=meta_muscles,
        bones=meta_bones,
        parts=parts_meta,
        anchors=anchors,
        pick=meta_pick,
        fit=dict(insideShare=inside_report),
        source="Z-Anatomy, Models-of-human-anatomy at commit bb293be. Rewrapped, decimated and warped onto Anny reference bodies.",
        attribution="Z-Anatomy, the libre 3D atlas of anatomy, CC BY-SA 4.0, derived from BodyParts3D, (c) The Database Center for Life Science.",
    )
    (OUT / "muscles.bin").write_bytes(b"".join(w.chunks))
    (OUT / "muscles.json").write_text(json.dumps(meta))
    print("muscles.bin", w.offset, "bytes;", "muscles.json", (OUT / "muscles.json").stat().st_size, "bytes;", len(pick_vertices), "pick points")


if __name__ == "__main__":
    main()
