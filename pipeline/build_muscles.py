"""Turns BodyParts3D muscles and bones into one file fitted to both Anny reference bodies.

Every part is rewrapped into a closed surface in the BodyParts3D frame, decimated, then moved
into each reference body by one warp: a skeleton-driven pass (joints found in the source bones,
limbs rotated and scaled segment by segment, the trunk matched slice by slice) followed by a
smooth displacement field that lands the source skin on the Anny skin. Whatever sat under the
source skin therefore ends up under the Anny skin. Limb bones stay rigid in the skeleton pass
and hand bones are placed on Anny's own finger bones, because the source hand is posed differently.

Usage: build_muscles.py <BP3D 4.0 is_a obj folder> <BP3D 3.0 stl folder> <cache folder>
The 3.0 folder needs FMA13358, FMA13359, FMA13377, FMA13378, FMA13892 and FMA13893.
"""
import json, re, sys, warnings
from pathlib import Path
import numpy as np, torch, trimesh, fast_simplification
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import measure

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets"
refs = np.load(ROOT / "pipeline/cache/reference_bodies.npz")
meta_body = json.loads((OUT / "body.json").read_text())
body_bin = (OUT / "body.bin").read_bytes()
JOINT_NAMES = [j["name"] for j in meta_body["joints"]]
rng = np.random.default_rng(7)

GROUPS = ["chest", "back", "shoulders", "biceps", "triceps", "forearms", "abs", "glutes", "quads", "hamstrings", "calves", "other"]
SEXES = ("male", "female")

# ---------------------------------------------------------------------------------------------
# Catalogue. First match wins. `detail` multiplies a muscle's share of the triangle budget.
# `fibre` says how the fibres run: "axis" lies flat along the long axis, "spindle" runs lengthwise
# around a rounded muscle and gathers at its ends, ("fan", landmark) converges on an insertion,
# ("wrap", degrees) winds around the trunk at that angle from horizontal.
# ---------------------------------------------------------------------------------------------
MUSCLES = [
    (r"part of \w+ pectoralis major", "chest", 1.5, ("fan", "pec_insertion")),
    (r"pectoralis minor", "chest", 0.3, ("fan", "coracoid")),
    (r"part of \w+ trapezius", "back", 1.4, "axis"),
    (r"latissimus dorsi", "back", 1.5, ("fan", "lat_insertion")),
    (r"rhomboid (major|minor)", "back", 0.6, "axis"),
    (r"iliocostalis (lumborum|thoracis|cervicis)", "back", 0.45, "axis"),
    (r"longissimus (thoracis|cervicis)", "back", 0.45, "axis"),
    (r"(?<!semi)spinalis thoracis", "back", 0.3, "axis"),
    (r"teres (major|minor)", "back", 0.9, "axis"),
    (r"part of \w+ deltoid", "shoulders", 1.5, ("fan", "deltoid_tuberosity")),
    (r"infraspinatus", "shoulders", 0.8, "axis"),
    (r"supraspinatus", "shoulders", 0.4, "axis"),
    (r"subscapularis", "shoulders", 0.2, "axis"),
    (r"head of \w+ biceps brachii", "biceps", 1.4, "spindle"),
    (r"\bbrachialis\b", "biceps", 0.7, "spindle"),
    (r"triceps brachii", "triceps", 1.3, "spindle"),
    (r"anconeus", "triceps", 0.4, "spindle"),
    (r"brachioradialis", "forearms", 1.0, "spindle"),
    (r"pronator teres", "forearms", 0.6, "axis"),
    (r"flexor carpi (radialis|ulnaris)", "forearms", 0.7, "spindle"),
    (r"palmaris longus", "forearms", 0.5, "spindle"),
    (r"flexor digitorum (superficialis|profundus)", "forearms", 0.6, "spindle"),
    (r"flexor pollicis longus", "forearms", 0.3, "spindle"),
    (r"extensor carpi (radialis|ulnaris)", "forearms", 0.7, "spindle"),
    (r"extensor (digitorum|digiti minimi)$", "forearms", 0.7, "spindle"),
    (r"(abductor pollicis longus|extensor pollicis (longus|brevis)|extensor indicis)", "forearms", 0.3, "spindle"),
    (r"supinator", "forearms", 0.2, "spindle"),
    (r"rectus abdominis", "abs", 1.6, "axis"),
    (r"external oblique", "abs", 1.3, ("wrap", 55)),
    (r"internal oblique", "abs", 0.25, ("wrap", -45)),
    (r"^linea alba$", "abs", 0.2, "axis"),
    (r"gluteus maximus", "glutes", 1.5, "axis"),
    (r"gluteus medius", "glutes", 0.9, ("fan", "greater_trochanter")),
    (r"gluteus minimus", "glutes", 0.25, ("fan", "greater_trochanter")),
    (r"rectus femoris", "quads", 1.3, "spindle"),
    (r"vastus (lateralis|medialis)", "quads", 1.3, "spindle"),
    (r"vastus intermedius", "quads", 0.3, "spindle"),
    (r"head of \w+ biceps femoris", "hamstrings", 1.2, "spindle"),
    (r"(semimembranosus|semitendinosus)", "hamstrings", 1.2, "spindle"),
    (r"head of \w+ gastrocnemius", "calves", 1.4, "spindle"),
    (r"soleus", "calves", 1.0, "spindle"),
    (r"calcaneal tendon", "calves", 0.3, "axis"),
    # The quiet rest of the figure.
    (r"sartorius", "other", 0.8, "spindle"),
    (r"gracilis", "other", 0.5, "spindle"),
    (r"pectineus", "other", 0.3, "spindle"),
    (r"adductor (longus|brevis|magnus)", "other", 0.6, "spindle"),
    (r"tensor fasciae latae", "other", 0.4, "spindle"),
    (r"iliotibial tract", "other", 0.5, "axis"),
    (r"psoas major", "other", 0.25, "axis"),
    (r"iliacus", "other", 0.2, ("fan", "lesser_trochanter")),
    (r"tibialis (anterior|posterior)", "other", 0.6, "spindle"),
    (r"extensor (digitorum|hallucis) longus", "other", 0.5, "spindle"),
    (r"fibularis (longus|brevis)", "other", 0.5, "spindle"),
    (r"flexor (digitorum|hallucis) longus", "other", 0.2, "spindle"),
    (r"popliteus", "other", 0.15, "axis"),
    (r"sternocleidomastoid", "other", 0.8, "spindle"),
    (r"splenius (capitis|cervicis)", "other", 0.4, "axis"),
    (r"semispinalis (capitis|cervicis)", "other", 0.25, "axis"),
    (r"levator scapulae", "other", 0.35, "spindle"),
    (r"scalenus (anterior|medius|posterior)", "other", 0.25, "spindle"),
    (r"(omohyoid|sternohyoid|sternothyroid|thyrohyoid$)", "other", 0.2, "axis"),
    (r"serratus anterior", "other", 0.9, ("wrap", 15)),
    (r"serratus posterior (superior|inferior)", "other", 0.2, "axis"),
    (r"coracobrachialis", "other", 0.35, "spindle"),
    (r"subclavius", "other", 0.1, "axis"),
    (r"external intercostal", "other", 0.6, ("wrap", 50)),
]

# Parts BodyParts3D 4.0 lacks, taken from 3.0. The older set sits a few millimetres away from
# 4.0, so each file carries the offset measured by fitting its neighbours in both versions:
# scapula and humerus for the latissimus, external oblique for the front of the abdomen (mm).
V3_PARTS = {
    "Right latissimus dorsi": ("FMA13358", (0.45, -4.2, -11.0)),
    "Left latissimus dorsi": ("FMA13359", (-0.45, -4.2, -11.0)),
    "Right rectus abdominis": ("FMA13377", (0.18, -0.03, -13.64)),
    "Left rectus abdominis": ("FMA13378", (-0.18, -0.03, -13.64)),
    "Right internal oblique": ("FMA13892", (0.18, -0.03, -13.64)),
    "Left internal oblique": ("FMA13893", (-0.18, -0.03, -13.64)),
}

ORDINAL = "(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)"
HAND_CARPAL = r"(scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)$"
FOOT_TARSAL = r"(calcaneus$|talus$|navicular bone|cuboid bone|cuneiform bone)"
# (pattern, shared part name or None, joint or None, detail). `{side}` joints are per side and bind
# the whole bone rigidly, None takes per-vertex weights from the skin. A shared name wraps every
# match on that side into one surface, which is what fuses a skull out of its 20-odd bones.
BONES = [
    (r"^(frontal bone|occipital bone|sphenoid bone|ethmoid)$", "cranium", "head", 4.0),
    (r"(parietal bone|temporal bone|zygomatic bone|\bmaxilla$|nasal bone|lacrimal bone|palatine bone|upper .*tooth)", "cranium", "head", 4.0),
    (r"^mandible$|lower .*tooth", "mandible", "head", 2.5),
    (r"^hyoid bone$", None, "neck", 0.1),
    (r"^(trachea|thyroid cartilage|cricoid cartilage)$", None, "neck", 0.3),
    (r"^(atlas|axis)$", None, "neck", 0.4),
    (rf"{ORDINAL} cervical vertebra", None, "neck", 0.4),
    (rf"{ORDINAL} thoracic vertebra", None, None, 0.55),
    (rf"{ORDINAL} lumbar vertebra", None, None, 0.7),
    (r"intervertebral dis[ck]", None, None, 0.08),
    (r"^sacrum$", None, "hips", 1.0),
    (rf"{ORDINAL} rib$", None, None, 0.5),
    (rf"{ORDINAL} costal cartilage", None, None, 0.2),
    (r"^(manubrium|body of sternum|xiphoid process)$", None, None, 0.3),
    (r"\bclavicle$", None, "clavicle.{side}", 0.5),
    (r"\bscapula$", None, "clavicle.{side}", 1.3),
    (r"\bhumerus$", None, "arm.{side}", 1.2),
    (r"\bradius$", None, "forearm.{side}", 0.8),
    (r"\bulna$", None, "forearm.{side}", 0.8),
    (HAND_CARPAL, None, "hand.{side}", 0.07),
    (r"(first|second|third|fourth|fifth) metacarpal bone", None, "hand.{side}", 0.1),
    (r"phalanx of \w+ (thumb|index finger|middle finger|ring finger|little finger)", None, "hand.{side}", 0.06),
    (r"\bhip bone$", None, "hips", 2.0),
    (r"\bfemur$", None, "thigh.{side}", 1.3),
    (r"\bpatella$", None, "shin.{side}", 0.25),
    (r"\btibia$", None, "shin.{side}", 1.0),
    (r"\bfibula$", None, "shin.{side}", 0.6),
    (FOOT_TARSAL, None, "foot.{side}", 0.18),
    (r"(first|second|third|fourth|fifth) metatarsal bone", None, "foot.{side}", 0.12),
    (r"phalanx of \w+ (big|second|third|fourth|little) toe", None, "foot.{side}", 0.05),
]

MUSCLE_TRIANGLES = 70000
BONE_TRIANGLES = 25000
MIN_TRIANGLES = 24
Q = 32767 / 2.5  # same quantisation as body.json
INSIDE_MARGIN = 0.0015  # how far under the skin a pulled-in vertex ends up, metres
SKIN_CLEARANCE = 0.004  # the source skin lands this far under the Anny skin: a layer of soft tissue
PICK_CELL = 0.022  # one pick point per cube this wide, per group, metres
PICK_RADIUS = 0.018  # how close a ray must pass a pick point to hit it, metres
CONTAIN_LIMIT = 0.012  # the furthest one round of the final pass may move anything, metres
RECTUS_INTERSECTIONS = (0.952, 1.028, 1.104)  # source heights: at the navel and two above it, metres
RECTUS_GROOVE = (0.0028, 0.0035)  # half width and depth of each intersection, metres
THICKEN = {r"iliotibial tract": 2, r"^linea alba$": 1}  # voxels; a flat band has to clear what it lies on
ALL_TENDON = r"(iliotibial tract|calcaneal tendon|linea alba)"


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def unit(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


# ---------------------------------------------------------------------------------------------
# Reading the source
# ---------------------------------------------------------------------------------------------
def to_body_frame(v):
    """BodyParts3D is millimetres, Z up, front -Y. The bodies are metres, Y up, front +Z."""
    return np.c_[v[:, 0], v[:, 2], -v[:, 1]] / 1000


def read_obj(path):
    vs, fs = [], []
    with open(path, errors="ignore") as h:
        for line in h:
            if line.startswith("v "):
                vs.append(line[2:].split()[:3])
            elif line.startswith("f "):
                fs.append([p.split("/")[0] for p in line[2:].split()[:3]])
    return np.array(vs, float), np.array(fs, np.int64) - 1


def read_stl(path):
    b = path.read_bytes()
    n = int.from_bytes(b[80:84], "little")
    a = np.frombuffer(b, np.dtype([("n", "<f4", (3,)), ("v", "<f4", (9,)), ("a", "<u2")]), n, 84)
    tri = a["v"].reshape(-1, 3).astype(float)
    u, inv = np.unique(np.round(tri, 4), axis=0, return_inverse=True)
    return u, inv.reshape(-1, 3)


def index_source(isa):
    """English name of every OBJ. A few headers are blank; the ones this build needs are named here."""
    named = {}
    for path in sorted(isa.glob("*.obj")):
        with open(path, errors="ignore") as h:
            for line in h:
                if line.startswith("# English name"):
                    name = line.split(":", 1)[1].strip()
                    break
                if line.startswith("v "):
                    name = ""
                    break
        named[path.stem] = name
    named["FJ1451"] = "Right external intercostal"
    named["FJ1451M"] = "Left external intercostal"
    return named


def side_of(name, mean_x):
    low = name.lower()
    if re.search(r"\bleft\b", low):
        return "L"
    if re.search(r"\bright\b", low):
        return "R"
    return "M" if abs(mean_x) < 0.012 else ("L" if mean_x > 0 else "R")


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


def scan_solid(V, F, lo, pitch, dims, axis):
    """Solid voxels by winding along one axis: every triangle marks where each column crosses it."""
    u, v = [k for k in range(3) if k != axis]
    P = (V - lo) / pitch - 0.5  # voxel centres sit on integers
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    delta = np.zeros(dims, np.int16)
    area = (b[:, u] - a[:, u]) * (c[:, v] - a[:, v]) - (b[:, v] - a[:, v]) * (c[:, u] - a[:, u])
    live = np.where(np.abs(area) > 1e-12)[0]
    umin = np.ceil(np.minimum(np.minimum(a[live, u], b[live, u]), c[live, u])).astype(int)
    umax = np.floor(np.maximum(np.maximum(a[live, u], b[live, u]), c[live, u])).astype(int)
    vmin = np.ceil(np.minimum(np.minimum(a[live, v], b[live, v]), c[live, v])).astype(int)
    vmax = np.floor(np.maximum(np.maximum(a[live, v], b[live, v]), c[live, v])).astype(int)
    keep = (umax >= umin) & (vmax >= vmin)
    live, umin, umax, vmin, vmax = live[keep], umin[keep], umax[keep], vmin[keep], vmax[keep]
    wu, wv = umax - umin + 1, vmax - vmin + 1
    for chunk in np.array_split(np.arange(len(live)), max(1, len(live) // 20000 + 1)):
        counts = wu[chunk] * wv[chunk]
        tri = np.repeat(chunk, counts)
        starts = np.r_[0, np.cumsum(counts)[:-1]]
        off = np.arange(counts.sum()) - np.repeat(starts, counts)
        pu = umin[tri] + off % wu[tri]
        pv = vmin[tri] + off // wu[tri]
        t = live[tri]
        ax, ay, bx, by, cx, cy = a[t, u], a[t, v], b[t, u], b[t, v], c[t, u], c[t, v]
        d = area[t]
        w0 = ((bx - pu) * (cy - pv) - (by - pv) * (cx - pu)) / d
        w1 = ((cx - pu) * (ay - pv) - (cy - pv) * (ax - pu)) / d
        w2 = 1 - w0 - w1
        # Half-open edges so a shared edge counts for exactly one of its triangles.
        hit = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        depth = np.ceil(w0[hit] * a[t[hit], axis] + w1[hit] * b[t[hit], axis] + w2[hit] * c[t[hit], axis]).astype(int)
        depth = np.clip(depth, 0, dims[axis] - 1)
        index = [None, None, None]
        index[u], index[v], index[axis] = pu[hit], pv[hit], depth
        np.add.at(delta, tuple(index), np.sign(d[hit]).astype(np.int16))
    return np.cumsum(delta, axis=axis) != 0


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


def taubin(V, F, iterations=6, lamb=0.5, mu=-0.53):
    """Volume-keeping smoothing, which takes the voxel steps out of the shading."""
    edges = np.unique(np.sort(np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1), axis=0)
    deg = np.zeros(len(V))
    np.add.at(deg, edges.ravel(), 1)
    V = V.copy()
    for k in range(iterations):
        total = np.zeros_like(V)
        np.add.at(total, edges[:, 0], V[edges[:, 1]])
        np.add.at(total, edges[:, 1], V[edges[:, 0]])
        V = V + (total / np.maximum(deg, 1)[:, None] - V) * (lamb if k % 2 == 0 else mu)
    return V


def decimate(V, F, target):
    """Quadric decimation that insists on a closed result. The simplifier occasionally pinches an
    edge at a given target, and it can stop short of the target, so both are searched past."""
    if len(F) <= target:
        return taubin(V, F), F
    for attempt in range(12):
        v, f = V.astype(np.float32), F.astype(np.int32)
        wanted = int(target * (1 + 0.012 * attempt))
        for _ in range(4):
            v, f = fast_simplification.simplify(v, f, target_count=wanted, agg=3 + attempt // 3)
            if len(f) <= wanted * 1.02:
                break
        # A collapsed fold leaves the same triangle twice, back to back; dropping both keeps it closed.
        _, which, counts = np.unique(np.sort(f, axis=1), axis=0, return_inverse=True, return_counts=True)
        m = trimesh.Trimesh(v.astype(float), f[counts[which.ravel()] == 1].astype(np.int64), process=False)
        m.remove_unreferenced_vertices()
        if m.is_watertight:
            break
    return taubin(np.asarray(m.vertices), np.asarray(m.faces)), np.asarray(m.faces)


# ---------------------------------------------------------------------------------------------
# Body data
# ---------------------------------------------------------------------------------------------
class Reference:
    """One Anny reference body: surface, joints, collapsed weights, and the fine hand and foot bones."""

    def __init__(self, sex, fine):
        self.sex = sex
        self.V = refs[sex]
        self.F = refs["faces"]
        self.J = {n: refs[f"joints_{sex}"][i] for i, n in enumerate(JOINT_NAMES)}
        n = meta_body["vertexCount"]
        self.skin_index = np.frombuffer(body_bin, np.uint8, n * 4, meta_body["skinIndex"]).reshape(-1, 4)
        self.skin_weight = np.frombuffer(body_bin, np.uint8, n * 4, meta_body["skinWeight"]).reshape(-1, 4).astype(float) / 255
        self.dense = np.zeros((n, len(JOINT_NAMES)))
        np.add.at(self.dense, (np.repeat(np.arange(n), 4), self.skin_index.ravel()), self.skin_weight.ravel())
        self.fine_head = fine[f"{sex}_head"]
        self.fine_tail = fine[f"{sex}_tail"]
        self.fine_labels = list(fine["labels"])
        self.breast = fine["breast"]
        self.mesh = trimesh.Trimesh(self.V, self.F, process=False)
        self.N = np.asarray(self.mesh.vertex_normals)
        # Dense surface samples with normals and interpolated weights.
        P, fid = trimesh.sample.sample_surface_even(self.mesh, 400000, seed=11)
        tri = self.F[fid]
        bary = trimesh.triangles.points_to_barycentric(self.V[tri], P)
        self.sample_P = P
        self.sample_N = unit((self.N[tri] * bary[..., None]).sum(1))
        self.sample_w = (self.dense[tri] * bary[..., None]).sum(1)
        self.sample_breast = (self.breast[tri] * bary).sum(1)
        self.tree = cKDTree(P)

    def head(self, label):
        return self.fine_head[self.fine_labels.index(label)]

    def tail(self, label):
        return self.fine_tail[self.fine_labels.index(label)]

    def share(self, names):
        idx = [JOINT_NAMES.index(n) for n in names]
        return self.sample_w[:, idx].sum(1)

    def region_points(self, names, threshold=0.6):
        return self.sample_P[self.share(names) > threshold]


def load_fine_bones(cache):
    """Anny's bones before they were collapsed into the 19-joint rig, in the same relaxed stance."""
    path = cache / "anny_fine.npz"
    if path.exists():
        return dict(np.load(path))
    import anny

    model = anny.create_fullbody_model(triangulate_faces=True, remove_unattached_vertices=True)
    labels = list(model.bone_labels)

    def axis_angle(axis, degrees):
        return trimesh.transformations.rotation_matrix(np.radians(degrees), axis)[:3, :3]

    stance = {  # build_body.py's stance; both must agree or the reference vertices would not match
        "upperarm01.L": axis_angle([0, 1, 0], 37),
        "upperarm01.R": axis_angle([0, 1, 0], -37),
        "lowerarm01.L": axis_angle([1, 0, 0], -14),
        "lowerarm01.R": axis_angle([1, 0, 0], -14),
        "upperleg01.L": axis_angle([0, 1, 0], -4.5),
        "upperleg01.R": axis_angle([0, 1, 0], 4.5),
    }

    def y_up(a):
        return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1)

    base = dict(age=2 / 3, muscle=0.5, weight=0.5, height=0.5, proportions=0.5)
    out = {"labels": np.array(labels)}
    keep = None
    for sex, value in (("male", 0.0), ("female", 1.0)):
        kw = {k: torch.tensor([float(v)], dtype=torch.float32) for k, v in {**base, "gender": value}.items()}
        rest = model(phenotype_kwargs=kw, return_bone_ends=True)
        pose = {}
        for name, rot in stance.items():
            b = rest["rest_bone_poses"][0][labels.index(name)][:3, :3].numpy().astype(np.float64)
            d = np.eye(4)
            d[:3, :3] = b.T @ rot @ b
            pose[name] = torch.tensor(d, dtype=torch.float32)[None]
        posed = model(pose_parameters=pose, phenotype_kwargs=kw, return_bone_ends=True)
        v = y_up(posed["vertices"][0].detach().numpy().astype(float))
        if keep is None:
            tm = trimesh.Trimesh(v, model.faces.numpy(), process=False)
            comps = trimesh.graph.connected_components(tm.edges, nodes=np.arange(len(v)))
            keep = np.zeros(len(v), bool)
            keep[max(comps, key=len)] = True
        ground = v[keep, 1].min()
        out[f"{sex}_head"] = y_up(posed["bone_heads"][0].detach().numpy().astype(float)) - [0, ground, 0]
        out[f"{sex}_tail"] = y_up(posed["bone_tails"][0].detach().numpy().astype(float)) - [0, ground, 0]
        assert np.abs(v[keep] - [0, ground, 0] - refs[sex]).max() < 1e-4
    bones = model.vertex_bone_indices.numpy()[keep]
    weights = model.vertex_bone_weights.numpy()[keep]
    breast = [labels.index("breast.L"), labels.index("breast.R")]
    out["breast"] = (weights * np.isin(bones, breast)).sum(1)
    np.savez(path, **out)
    return out


# ---------------------------------------------------------------------------------------------
# Finding joints in the source bones
# ---------------------------------------------------------------------------------------------
def fit_sphere(P):
    A = np.c_[2 * P, np.ones(len(P))]
    x = np.linalg.lstsq(A, (P**2).sum(1), rcond=None)[0]
    return x[:3], float(np.sqrt(x[3] + x[:3] @ x[:3]))


def long_axis_ends(P, proximal_near):
    """Mean positions of the two ends of a bone along its principal axis, proximal one first."""
    c = P.mean(0)
    axis = np.linalg.svd(P - c, full_matrices=False)[2][0]
    t = (P - c) @ axis
    span = t.max() - t.min()
    a, b = P[t > t.max() - span * 0.08].mean(0), P[t < t.min() + span * 0.08].mean(0)
    return (a, b) if np.linalg.norm(a - proximal_near) < np.linalg.norm(b - proximal_near) else (b, a)


class SourceSkeleton:
    def __init__(self, load):
        """`load(name)` returns body-frame vertices of a right-side bone."""
        self.load = load
        femur, tibia, humerus, radius, ulna = (load(n) for n in ("Right femur", "Right tibia", "Right humerus", "Right radius", "Right ulna"))
        top = femur[femur[:, 1] > femur[:, 1].max() - 0.05]
        hip, r_hip = fit_sphere(top[top[:, 0] > np.percentile(top[:, 0], 55)])
        top = humerus[humerus[:, 1] > humerus[:, 1].max() - 0.05]
        shoulder, r_shoulder = fit_sphere(top[top[:, 0] > np.percentile(top[:, 0], 45)])
        low = lambda P, h: P[P[:, 1] < P[:, 1].min() + h].mean(0)
        high = lambda P, h: P[P[:, 1] > P[:, 1].max() - h].mean(0)
        knee = (low(femur, 0.02) + high(tibia, 0.02)) / 2
        ankle = low(tibia, 0.015)
        elbow = low(humerus, 0.02)
        wrist = (low(radius, 0.012) + low(ulna, 0.012)) / 2
        print(f"  source joints: hip r={r_hip*1000:.1f} mm, shoulder r={r_shoulder*1000:.1f} mm")
        self.hip, self.knee, self.ankle, self.shoulder, self.elbow, self.wrist = hip, knee, ankle, shoulder, elbow, wrist
        lesser = femur[femur[:, 1] < hip[1] - 0.04]
        lesser = lesser[lesser[:, 1] > hip[1] - 0.09]
        trochanter = femur[femur[:, 1] > hip[1] - 0.05]
        axis = unit(elbow - shoulder)
        self.landmarks = {
            "pec_insertion": shoulder + axis * np.linalg.norm(elbow - shoulder) * 0.22 + np.array([0, 0, 0.02]),
            "lat_insertion": shoulder + axis * np.linalg.norm(elbow - shoulder) * 0.14 + np.array([0, 0, 0.015]),
            "deltoid_tuberosity": shoulder + axis * np.linalg.norm(elbow - shoulder) * 0.46 + np.array([-0.012, 0, 0.004]),
            "greater_tubercle": shoulder + np.array([-0.022, 0.004, 0.006]),
            "greater_trochanter": trochanter[np.argmin(trochanter[:, 0])],
            "lesser_trochanter": lesser[np.argmax(lesser[:, 0])],
            "coracoid": shoulder + np.array([0.035, 0.015, 0.035]),
        }

    def mirrored(self, point):
        return np.array([-point[0], point[1], point[2]])

    def joint(self, name, side):
        p = getattr(self, name)
        return p if side == "R" else self.mirrored(p)

    def landmark(self, name, side):
        p = self.landmarks[name]
        return p if side == "R" else self.mirrored(p)


# ---------------------------------------------------------------------------------------------
# Skeleton pass of the warp
# ---------------------------------------------------------------------------------------------
def rotation_between(a, b):
    a, b = unit(a), unit(b)
    v = np.cross(a, b)
    c = float(a @ b)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def rotation_log(R):
    angle = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
    if angle < 1e-6:
        return np.array([1.0, 0, 0]), 0.0
    axis = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * np.sin(angle))
    return axis, float(angle)


def rotate_many(axis, angles, v):
    """Rodrigues for one axis and many angles over many vectors."""
    c, s = np.cos(angles)[:, None], np.sin(angles)[:, None]
    return v * c + np.cross(axis, v) * s + axis * (v @ axis)[:, None] * (1 - c)


class Chain:
    """A limb: joints mapped onto joints, each segment rotated, stretched along its bone and scaled
    across it. Between segments the swing around the shared joint is blended."""

    def __init__(self, source, target, blend, radial, twist=None):
        self.Js, self.Jt = np.asarray(source), np.asarray(target)
        self.n = len(source) - 1
        self.ds = self.Js[1:] - self.Js[:-1]
        self.dt = self.Jt[1:] - self.Jt[:-1]
        self.Ls = np.linalg.norm(self.ds, axis=1)
        self.Lt = np.linalg.norm(self.dt, axis=1)
        self.ds, self.dt = unit(self.ds), unit(self.dt)
        self.R = [rotation_between(self.ds[k], self.dt[k]) for k in range(self.n)]
        self.blend = blend
        self.radial = radial  # per segment: (t samples, factors)
        self.twist = twist  # per segment: radians at the distal end, or None

    def rho(self, k, t):
        ts, rs = self.radial[k]
        return np.interp(t, ts, rs)

    def segment_of(self, P):
        best, bestd = np.zeros(len(P), int), np.full(len(P), np.inf)
        for k in range(self.n):
            t = np.clip((P - self.Js[k]) @ self.ds[k], 0, self.Ls[k])
            d = np.linalg.norm(P - (self.Js[k] + t[:, None] * self.ds[k]), axis=1)
            near = d < bestd
            best[near], bestd[near] = k, d[near]
        return best

    def stretched(self, k, o, t, across=None):
        """Offset from any point on segment k's line, axial part stretched, radial part scaled."""
        axial = (o @ self.ds[k])[:, None] * self.ds[k]
        radial = self.rho(k, t)[:, None] if across is None else across
        return axial * (self.Lt[k] / self.Ls[k]) + (o - axial) * radial

    def apply(self, P, rigid=None, across=None):
        """`rigid` pins every point to one segment with no blending, which is how bones stay bones.
        `across` replaces the flesh's radial scale, since a femur doesn't thicken with the thigh."""
        out = np.zeros_like(P)
        seg = np.full(len(P), rigid) if rigid is not None else self.segment_of(P)
        for k in range(self.n):
            mask = seg == k
            if not mask.any():
                continue
            p = P[mask]
            t = (p - self.Js[k]) @ self.ds[k] / self.Ls[k]
            q = np.zeros_like(p)
            if rigid is not None:
                q = self.Jt[k] + self.stretched(k, p - self.Js[k], t, across) @ self.R[k].T
            else:
                near_tail = (t > 0.5) & (k < self.n - 1)
                near_head = ~near_tail
                for flag, j, a, b in ((near_tail, k + 1, k, k + 1), (near_head, k, k - 1, k)):
                    if not flag.any():
                        continue
                    if a < 0:  # root of the chain: no neighbour to blend with
                        q[flag] = self.Jt[k] + self.stretched(k, p[flag] - self.Js[k], t[flag]) @ self.R[k].T
                        continue
                    n_plane = unit(self.ds[a] + self.ds[b])
                    o = p[flag] - self.Js[j]
                    w = smoothstep(-self.blend[j - 1], self.blend[j - 1], o @ n_plane)
                    ta = 1 + (o @ self.ds[a]) / self.Ls[a]
                    tb = (o @ self.ds[b]) / self.Ls[b]
                    # Stretch in each segment's frame, then swing around the shared joint, so an
                    # elbow bends like an elbow where a plain linear blend would pinch.
                    sa = self.stretched(a, o, ta)
                    sb = self.stretched(b, o, tb)
                    s = sa * (1 - w)[:, None] + sb * w[:, None]
                    axis, angle = rotation_log(self.R[b] @ self.R[a].T)
                    r = s @ self.R[a].T
                    q[flag] = self.Jt[j] + rotate_many(axis, w * angle, r)
            out[mask] = q
            if self.twist is not None and self.twist[k]:
                # Twist grows along the segment, the way pronation winds the forearm.
                tw = smoothstep(0.05, 1.0, t) * self.twist[k]
                axis_point = self.Jt[k] + (out[mask] - self.Jt[k]) @ self.dt[k][:, None] * self.dt[k]
                out[mask] = axis_point + rotate_many(self.dt[k], tw, out[mask] - axis_point)
        return out


def section_radii(P, J0, J1, ts, width):
    d = J1 - J0
    L = np.linalg.norm(d)
    d = d / L
    t = (P - J0) @ d / L
    r = []
    for x in ts:
        s = P[np.abs(t - x) < width]
        if len(s) < 8:
            r.append(np.nan)
            continue
        radial = s - J0 - ((s - J0) @ d)[:, None] * d
        radial = radial - radial.mean(0)
        r.append(np.sqrt((radial**2).sum(1).mean()))
    return np.array(r)


def radial_table(source, J0s, J1s, target, J0t, J1t, trust=(0.0, 1.0)):
    """Limb thickness ratio along a segment; near the ends the sections are unreliable, so they hold."""
    ts = np.linspace(0, 1, 17)
    a = section_radii(source, J0s, J1s, ts, 0.04)
    b = section_radii(target, J0t, J1t, ts, 0.04)
    ratio = b / a
    good = (ts >= trust[0]) & (ts <= trust[1]) & np.isfinite(ratio)
    ratio = np.interp(ts, ts[good], ratio[good])
    ratio = ndi.gaussian_filter1d(ratio, 1.2, mode="nearest")
    return ts, np.clip(ratio, 0.7, 1.7)


def midline_crotch(P, hip_y, band):
    ys = np.linspace(hip_y - 0.16, hip_y + 0.05, 200)
    has = np.array([(np.abs(P[np.abs(P[:, 1] - y) < band][:, 0]) < 0.006).any() for y in ys])
    return ys[np.argmax(has)]


def narrowest_neck(P, lo, hi, band):
    ys = np.linspace(lo, hi, 40)
    widths = [np.ptp(P[np.abs(P[:, 1] - y) < band][:, 0]) for y in ys]
    return ys[int(np.argmin(widths))]


class Trunk:
    """Slice matching: at each height the trunk section's centre and half sizes map onto Anny's."""

    def __init__(self, source_torso, source_all, target_torso, target_all, pairs):
        """`pairs` adds (source y, target y) landmarks between crotch and neck; the hip comes first."""
        cs = midline_crotch(source_all, pairs[0][0], 0.004)
        cd = midline_crotch(target_all, pairs[0][1], 0.004)
        ts, td = source_all[:, 1].max(), target_all[:, 1].max()
        ns = narrowest_neck(source_torso, cs + (ts - cs) * 0.72, ts - (ts - cs) * 0.09, 0.005)
        nd = narrowest_neck(target_torso, cd + (td - cd) * 0.72, td - (td - cd) * 0.09, 0.006)
        ys = [cs - 0.3, cs] + [p[0] for p in pairs] + [ns, ts, ts + 0.1]
        yd = [cd - 0.3 * (nd - cd) / (ns - cs), cd] + [p[1] for p in pairs] + [nd, td, td + 0.1 * (td - nd) / (ts - ns)]
        self.ys, self.yd = np.array(ys), np.array(yd)
        assert (np.diff(self.ys) > 0).all() and (np.diff(self.yd) > 0).all(), (self.ys, self.yd)
        print("  trunk y", np.round(self.ys, 3), "->", np.round(self.yd, 3))
        self.levels = np.r_[np.linspace(cs + 0.02, ns, 16, endpoint=False), np.linspace(ns, ts - 0.015, 7)]
        d = np.interp(self.levels, self.ys, self.yd)
        ps = self.profile(source_torso, self.levels, 0.005)
        pd = self.profile(target_torso, d, 0.006)
        # Around the shoulders the two bodies split arm from trunk in different places, so the sizes
        # measured there mean nothing. Bridge them from the chest below to the neck above.
        frac = (self.levels - cs) / (ns - cs)
        bridge = (frac > 0.56) & (frac < 1.0)
        bridged = lambda a: np.interp(self.levels, self.levels[~bridge], a[~bridge])
        f = lambda a: ndi.gaussian_filter1d(bridged(a), 1.0, mode="nearest")
        self.dx, self.dz = f(pd[:, 0] - ps[:, 0]), f(pd[:, 2] - ps[:, 2])
        self.cx_s, self.cz_s = ndi.gaussian_filter1d(ps[:, 0], 1.0, mode="nearest"), ndi.gaussian_filter1d(ps[:, 2], 1.0, mode="nearest")
        self.sx, self.sz = f(pd[:, 1] / ps[:, 1]), f(pd[:, 3] / ps[:, 3])

    @staticmethod
    def profile(P, levels, band):
        out = []
        for y in levels:
            s = P[np.abs(P[:, 1] - y) < band]
            lo, hi = np.percentile(s[:, 0], [0.5, 99.5])
            zlo, zhi = np.percentile(s[:, 2], [0.5, 99.5])
            out.append([(lo + hi) / 2, (hi - lo) / 2, (zlo + zhi) / 2, (zhi - zlo) / 2])
        return np.array(out)

    def __call__(self, P):
        y = P[:, 1]
        i = lambda a: np.interp(y, self.levels, a)
        x = i(self.cx_s) + i(self.dx) + (P[:, 0] - i(self.cx_s)) * i(self.sx)
        z = i(self.cz_s) + i(self.dz) + (P[:, 2] - i(self.cz_s)) * i(self.sz)
        return np.c_[x, np.interp(y, self.ys, self.yd), z]


def joint_targets(ref, side):
    J = ref.J
    return dict(shoulder=J[f"arm.{side}"], elbow=J[f"forearm.{side}"], wrist=J[f"hand.{side}"], hip=J[f"thigh.{side}"], knee=J[f"shin.{side}"], ankle=J[f"foot.{side}"])


def limb_weights(P, sk):
    """How much each point belongs to each limb rather than the trunk."""
    out = {}
    for side in "RL":
        sign = -1 if side == "R" else 1
        S, E, W = (sk.joint(n, side) for n in ("shoulder", "elbow", "wrist"))
        axis = unit(E - S)
        t = (P - S) @ axis / np.linalg.norm(E - S)
        forearm = unit(W - E)
        tip = W + forearm * 0.3
        d = np.minimum(np.linalg.norm(np.cross(P - S, axis), axis=1), np.linalg.norm(P - np.clip((P - E) @ forearm, 0, np.linalg.norm(tip - E))[:, None] * forearm - E, axis=1))
        radius = np.interp(t, [0, 0.35, 1], [0.062, 0.056, 0.05])
        out[f"arm.{side}"] = smoothstep(-0.16, 0.04, t) * (1 - smoothstep(radius, radius + np.interp(t, [0, 0.6], [0.042, 0.03]), d)) * smoothstep(0, 0.02, P[:, 0] * sign)
        H, K = sk.joint("hip", side), sk.joint("knee", side)
        axis = unit(K - H)
        t = (P - H) @ axis / np.linalg.norm(K - H)
        out[f"leg.{side}"] = smoothstep(-0.03, 0.17, t) * smoothstep(0.0, 0.025, P[:, 0] * sign)
    return out


class SkeletonWarp:
    def __init__(self, sk, ref, skin, hands):
        self.sk, self.ref, self.hands = sk, ref, hands
        self.chains = {}
        self.foot_tip = {}
        for side in "RL":
            T = joint_targets(ref, side)
            sg = -1 if side == "R" else 1
            # Stats for radial tables.
            skin_side = skin[skin[:, 0] * sg > 0]
            S, E, W, H, K, A = (sk.joint(n, side) for n in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle"))
            near = lambda a, b, r: skin_side[self._dist_segment(skin_side, a, b) < r]
            arm_s, fore_s = near(S, E, 0.075), near(E, W, 0.06)
            thigh_s, shin_s = near(H, K, 0.14), near(K, A, 0.1)
            arm_t = ref.region_points([f"arm.{side}"], 0.6)
            fore_t = ref.region_points([f"forearm.{side}"], 0.6)
            thigh_t = ref.region_points([f"thigh.{side}"], 0.6)
            shin_t = ref.region_points([f"shin.{side}"], 0.6)
            rad_arm = radial_table(arm_s, S, E, arm_t, T["shoulder"], T["elbow"], (0.3, 0.85))
            rad_fore = radial_table(fore_s, E, W, fore_t, T["elbow"], T["wrist"], (0.12, 0.9))
            rad_thigh = radial_table(thigh_s, H, K, thigh_t, T["hip"], T["knee"], (0.2, 0.9))
            rad_shin = radial_table(shin_s, K, A, shin_t, T["knee"], T["ankle"], (0.1, 0.92))
            # Hand and foot segments only have to carry skin near the wrist and ankle.
            hand_dir_s, hand_dir_t = unit(W - E), unit(T["wrist"] - T["elbow"])
            hand_tail_s, hand_tail_t = W + hand_dir_s * 0.09, T["wrist"] + hand_dir_t * 0.09 * np.linalg.norm(T["wrist"] - T["elbow"]) / np.linalg.norm(W - E)
            flat = (np.array([0.0, 1.0]), np.array([rad_fore[1][-1], rad_fore[1][-1]]))
            twist = self._forearm_twist(side, E, W, T)
            self.chains[f"arm.{side}"] = Chain([S, E, W, hand_tail_s], [T["shoulder"], T["elbow"], T["wrist"], hand_tail_t], [0.04, 0.02], [rad_arm, rad_fore, flat], twist=[0.0, twist, 0.0])
            toe_s = A + np.array([sg * 0.02, -0.05, 0.14])
            toe_t = ref.head(f"toe3-1.{side}")
            flat = (np.array([0.0, 1.0]), np.array([1.0, 1.0]) * (np.linalg.norm(toe_t - T["ankle"]) / np.linalg.norm(toe_s - A)))
            self.chains[f"leg.{side}"] = Chain([H, K, A, toe_s], [T["hip"], T["knee"], T["ankle"], toe_t], [0.05, 0.03], [rad_thigh, rad_shin, flat])
        weights = limb_weights(skin, sk)
        source_torso = skin[weights["arm.R"] + weights["arm.L"] < 0.1]
        target_torso = ref.sample_P[ref.share([n for n in JOINT_NAMES if n.startswith(("arm", "forearm", "hand", "clavicle"))]) < 0.12]
        sh_t, hip_t = ref.J["arm.L"], ref.J["thigh.L"]
        self.trunk = Trunk(source_torso, skin, target_torso, ref.sample_P, [(sk.hip[1], hip_t[1]), (sk.shoulder[1], sh_t[1])])

    @staticmethod
    def _dist_segment(P, a, b):
        d = b - a
        L = np.linalg.norm(d)
        d = d / L
        t = np.clip((P - a) @ d, 0, L)
        return np.linalg.norm(P - (a + t[:, None] * d), axis=1)

    def _forearm_twist(self, side, E, W, T):
        """Anny's forearm is pronated and the source's is supinated; winding the forearm lets the
        radius and ulna arrive at the wrist the way the hand needs them."""
        a, b = self.hands[side].across()
        axis = unit(T["wrist"] - T["elbow"])
        a = rotation_between(W - E, T["wrist"] - T["elbow"]) @ a
        a, b = unit(a - (a @ axis) * axis), unit(b - (b @ axis) * axis)
        angle = float(np.arctan2(axis @ np.cross(a, b), a @ b))
        print(f"  forearm twist {side}: {np.degrees(angle):.0f} deg")
        return angle

    def __call__(self, P):
        w = limb_weights(P, self.sk)
        total = 1 - np.prod([1 - v for v in w.values()], axis=0)
        trunk_w = 1 - total
        out = self.trunk(P) * trunk_w[:, None]
        norm = trunk_w.copy()
        for name, v in w.items():
            active = v > 1e-4
            if active.any():
                out[active] += self.chains[name].apply(P[active]) * v[active, None]
                norm[active] += v[active]
        return out / norm[:, None]

    def rigid(self, P, chain, segment):
        return self.chains[chain].apply(P, rigid=segment)


# ---------------------------------------------------------------------------------------------
# Field pass of the warp
# ---------------------------------------------------------------------------------------------
def gaussian_field(X, ctrl, disp, sigma, eps=2.0, chunk=4000):
    Xt = torch.as_tensor(X, dtype=torch.float32)
    Ct = torch.as_tensor(ctrl, dtype=torch.float32)
    Dt = torch.as_tensor(disp, dtype=torch.float32)
    out = []
    for i in range(0, len(Xt), chunk):
        d2 = torch.cdist(Xt[i : i + chunk], Ct).pow(2)
        w = torch.exp(-d2 / (2 * sigma * sigma))
        out.append((w @ Dt) / (w.sum(1, keepdim=True) + eps))
    return torch.cat(out).numpy().astype(float)


class SkinField:
    """Displacement rounds, coarse to fine, each one fitted to where the source skin still misses."""

    ROUNDS = [(0.10, 0.09), (0.06, 0.06), (0.035, 0.04), (0.02, 0.025), (0.012, 0.015)]

    def __init__(self, skin, faces, ref, usable):
        self.rounds = []
        X = skin.copy()
        P, N = ref.sample_P, ref.sample_N
        keep = ref.sample_breast < 0.06  # chest wall under the breast, not the breast's surface
        Pk, Nk = P[keep] - N[keep] * SKIN_CLEARANCE, N[keep]
        tree = cKDTree(Pk)
        for sigma, reach in self.ROUNDS:
            normal = trimesh.Trimesh(X, faces, process=False).vertex_normals
            d, i = tree.query(X[usable])
            disp = Pk[i] - X[usable]
            facing = (normal[usable] * Nk[i]).sum(1)
            along = np.abs((unit(disp) * Nk[i]).sum(1))
            ok = (d < reach) & (facing > 0.2) & ((along > 0.6) | (d < 0.004))
            ctrl, dv = X[usable][ok], disp[ok]
            X = X + gaussian_field(X, ctrl, dv, sigma)
            self.rounds.append((ctrl, dv, sigma))
            d2, _ = tree.query(X[usable])
            print(f"    field sigma {sigma:.3f} controls {ok.sum():6d} residual mean {d2.mean()*1000:5.1f} mm p95 {np.percentile(d2, 95)*1000:5.1f} mm")
        self.skin = X

    def __call__(self, X):
        for ctrl, dv, sigma in self.rounds:
            X = X + gaussian_field(X, ctrl, dv, sigma)
        return X


# ---------------------------------------------------------------------------------------------
# The hand: its pose differs too much from the source for a smooth warp, so each bone is placed
# on Anny's own finger bones.
# ---------------------------------------------------------------------------------------------
FINGERS = ["thumb", "index finger", "middle finger", "ring finger", "little finger"]
METACARPAL_ORDER = ["first", "second", "third", "fourth", "fifth"]


def kabsch(a, b):
    """Rotation and uniform scale taking the point set `a` onto `b`, both relative to their origins."""
    U, S, Vt = np.linalg.svd(a.T @ b)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R, float((S[0] + S[1] + d * S[2]) / (a**2).sum())


class HandMap:
    def __init__(self, parts, ref, sk, side):
        word = "left" if side == "L" else "right"
        self.wrist_s = sk.joint("wrist", side)
        self.wrist_t = ref.J[f"hand.{side}"]
        by = {p["name"].lower(): p for p in parts}
        self.ends = {}
        for name, p in by.items():
            self.ends[name] = long_axis_ends(p["source"], self.wrist_s)
        mc = lambda k: self.ends[f"{word} {METACARPAL_ORDER[k]} metacarpal bone"]
        src = np.array([mc(1)[1], mc(2)[1], mc(3)[1], mc(4)[1]]) - self.wrist_s
        dst = np.array([ref.head(f"finger{k}-1.{side}") for k in (2, 3, 4, 5)]) - self.wrist_t
        self.R, self.s = kabsch(src, dst)
        self.ref, self.side, self.word = ref, side, word

    def across(self):
        """Direction across the knuckles, in source and target, for measuring forearm twist."""
        word, side, ref = self.word, self.side, self.ref
        a = self.ends[f"{word} second metacarpal bone"][1] - self.ends[f"{word} fifth metacarpal bone"][1]
        b = ref.head(f"finger2-1.{side}") - ref.head(f"finger5-1.{side}")
        return a, b

    def place(self, P, a, b, c, d):
        """Moves one bone so its ends a, b land on c, d, keeping the hand's roll."""
        R = rotation_between(self.R @ (b - a), d - c) @ self.R
        L = np.linalg.norm(b - a)
        axis = (b - a) / L
        along = np.linalg.norm(d - c) / L
        across = min(self.s, along) * 0.95
        o = P - a
        ax = (o @ axis)[:, None] * axis
        return c + (ax * along + (o - ax) * across) @ R.T

    def __call__(self, name, P):
        low = name.lower()
        side, ref = self.side, self.ref
        wrist = lambda x: self.wrist_t + self.s * (x - self.wrist_s) @ self.R.T
        if "metacarpal" in low:
            k = next(i for i, o in enumerate(METACARPAL_ORDER) if f" {o} " in f" {low} ")
            a, b = self.ends[low]
            if k == 0:  # the thumb's first Anny bone plays its metacarpal
                return self.place(P, a, b, ref.head(f"finger1-1.{side}"), ref.tail(f"finger1-1.{side}"))
            return self.place(P, a, b, wrist(a), ref.head(f"finger{k + 1}-1.{side}"))
        if "phalanx" in low:
            finger = next(i for i, f in enumerate(FINGERS) if f in low)
            a, b = self.ends[low]
            if finger == 0:
                bone = 2 if "proximal" in low else 3
            else:
                bone = 1 if "proximal" in low else (2 if "middle" in low else 3)
            label = f"finger{finger + 1}-{bone}.{side}"
            return self.place(P, a, b, ref.head(label), ref.tail(label))
        return wrist(P)


# ---------------------------------------------------------------------------------------------
# Measuring and fixing the fit
# ---------------------------------------------------------------------------------------------
def signed_distance_estimate(P, ref):
    """Distance to the nearest surface sample; negative inside. Good to a millimetre or so."""
    d, i = ref.tree.query(P)
    q, n = ref.sample_P[i], ref.sample_N[i]
    return ((P - q) * n).sum(1), q, n


def winding_numbers(P, ref, chunk=500):
    """Generalized winding number against the reference shell. The shell is watertight but the
    posed arm presses through the chest at the armpit, so overlaps read 2 and count as inside."""
    v = torch.as_tensor(ref.V, dtype=torch.float32)
    f = torch.as_tensor(ref.F.astype(np.int64))
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    Pt = torch.as_tensor(P, dtype=torch.float32)
    out = np.zeros(len(P))
    for i in range(0, len(Pt), chunk):
        q = Pt[i : i + chunk, None]
        A, B, C = a - q, b - q, c - q
        la, lb, lc = A.norm(dim=2), B.norm(dim=2), C.norm(dim=2)
        num = (A * torch.linalg.cross(B, C, dim=2)).sum(2)
        den = la * lb * lc + (A * B).sum(2) * lc + (B * C).sum(2) * la + (C * A).sum(2) * lb
        out[i : i + chunk] = ((2 * torch.atan2(num, den)).sum(1) / (4 * np.pi)).numpy()
    return out


def winding_inside(P, ref):
    return np.abs(winding_numbers(P, ref)) > 0.5


def contain(X, ref, margin=INSIDE_MARGIN):
    """Final pass for what the warp left outside one part. Moves it inward along the nearest surface
    normal through a narrow field, so the part dents smoothly instead of crumpling, and stays within
    the part so a push off the chest can't shove the arm through its own skin. The nearest-surface
    sign is wrong where the shell overlaps itself, so the winding number decides who is out."""
    moved = 0
    for sigma in (0.012, 0.008, 0.006, 0.004, 0.003, 0.002):
        s, _, n = signed_distance_estimate(X, ref)
        near = np.where(s > -margin - 0.002)[0]
        if len(near) == 0:
            break
        w = np.abs(winding_numbers(X[near], ref))
        out = w < 0.5
        # Inside but with a positive estimate means the nearest surface is the wrong layer of an
        # overlap, so only a true shallow distance counts as too close.
        shallow = (w < 1.5) & (s[near] <= 0) & (s[near] > -margin)
        bad = near[out | shallow]
        if len(bad) == 0:
            break
        moved = max(moved, len(bad))
        push = -n[bad] * np.clip(s[bad] + margin, 0, CONTAIN_LIMIT)[:, None]
        X = X + gaussian_field(X, X[bad], push, sigma, eps=0.2)
    return X, moved


def vertex_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], n)
    return unit(N)


# ---------------------------------------------------------------------------------------------
# Per-vertex data
# ---------------------------------------------------------------------------------------------
ARM_MUSCLES = r"coracobrachialis"
LEG_MUSCLES = r"(sartorius|gracilis|pectineus|adductor|tensor fasciae|iliotibial|tibialis|longus$|fibularis|popliteus)"


def allowed_joints(part):
    """Which joints a part may take weights from, so a hand near the thigh doesn't drag on the thigh."""
    side, group, name = part["side"], part["group"], part["name"].lower()
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
        zc = 0.08
        radius = np.linalg.norm(np.c_[V[:, 0], V[:, 2] - zc], axis=1).mean()
        arc = radius * np.arctan2(V[:, 0], V[:, 2] - zc)
        a = np.radians(spec[1])
        sign = 1 if side == "L" else -1
        return -arc * np.sin(a) * sign + V[:, 1] * np.cos(a)
    axis = axes[0]
    if part["group"] in ("biceps", "triceps", "forearms") or re.search(ARM_MUSCLES, part["name"], re.I):
        inner = nearest_on_polyline(c, [sk.joint(n, side) for n in ("shoulder", "elbow", "wrist")])
    elif part["group"] in ("glutes", "quads", "hamstrings", "calves") or re.search(LEG_MUSCLES, part["name"], re.I):
        inner = nearest_on_polyline(c, [sk.joint(n, side) for n in ("hip", "knee", "ankle")])
    else:
        inner = np.array([0, c[1], 0.08])
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
WRAP_VERSION = 3


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
    """Distance from the rectus abdominis' tendinous intersections, which sit at the navel and
    above it and dip a little toward the outer edge."""
    return np.min([np.abs(P[:, 1] - y + 0.1 * np.abs(P[:, 0])) for y in RECTUS_INTERSECTIONS], axis=0)


def rectus_grooves(meshes):
    """The source rectus is one smooth strap. Carving the intersections into its front face is what
    turns it into abs."""
    pts = np.vstack([V for V, _ in meshes])
    front = cKDTree(np.c_[np.abs(pts[:, 0]), pts[:, 1]])
    z = pts[:, 2]

    def keep(P):
        _, near = front.query(np.c_[np.abs(P[:, 0]), P[:, 1]], k=12)
        surface = z[near].max(1)
        return ~((rectus_band(P) < RECTUS_GROOVE[0]) & (P[:, 2] > surface - RECTUS_GROOVE[1]))

    return keep


def trim_rule(name, group, side, sk, rectus, rectus_meshes):
    """Parts reach past where they should be drawn: tendons run into the hand and foot, and the
    oblique's aponeurosis covers the rectus sheath, which would hide the abs."""
    low = name.lower()
    if "rectus abdominis" in low:
        return rectus_grooves(rectus_meshes)
    if group == "forearms":
        E, W = sk.joint("elbow", side), sk.joint("wrist", side)
        axis = unit(W - E)
        L = np.linalg.norm(W - E)
        return lambda P: (P - E) @ axis < L * 1.0
    if re.search(r"(tibialis|extensor (digitorum|hallucis) longus|fibularis|flexor (digitorum|hallucis) longus)", low):
        floor = sk.ankle[1] - 0.012
        return lambda P: P[:, 1] > floor
    if re.search(r"(external|internal) oblique", low):
        ys, xs = rectus
        return lambda P: ~((np.abs(P[:, 0]) < np.interp(P[:, 1], ys, xs) + 0.0025) & (P[:, 2] > 0.09))
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


def collect(isa, v3, named, sk, cache):
    stems = {}
    for stem, name in named.items():
        if name:
            stems.setdefault(name, []).append(stem)
    raw = lambda name: [(to_body_frame(read_obj(isa / f"{s}.obj")[0]), read_obj(isa / f"{s}.obj")[1]) for s in stems[name]]

    def v3_mesh(name):
        fma, offset = V3_PARTS[name]
        V, F = read_stl(v3 / f"{fma}.stl")
        return to_body_frame(V + np.array(offset)), F

    rectus_meshes = [v3_mesh("Right rectus abdominis"), v3_mesh("Left rectus abdominis")]
    rectus = rectus_border(rectus_meshes)
    all_names = list(stems) + list(V3_PARTS)
    muscles = []
    for name in all_names:
        for pattern, group, detail, fibre in MUSCLES:
            if re.search(pattern, name, re.I):
                meshes = [v3_mesh(name)] if name in V3_PARTS else raw(name)
                side = side_of(name, np.vstack([m[0] for m in meshes])[:, 0].mean())
                thicken = next((n for r, n in THICKEN.items() if re.search(r, name, re.I)), 0)
                V, F, half, lo, pitch = wrapped(name, meshes, auto_pitch(meshes, 0.0014), cache, trim_rule(name, group, side, sk, rectus, rectus_meshes), thicken)
                muscles.append(dict(name=name, group=group, detail=detail, fibre=fibre, side=side, V=V, F=F, half=half, lo=lo, pitch=pitch))
                break
    muscles.sort(key=lambda m: (GROUPS.index(m["group"]), m["name"]))
    print(f"muscles: {len(muscles)} parts")

    shared, bones = {}, []
    for name in stems:
        for pattern, part, joint, detail in BONES:
            if re.search(pattern, name, re.I):
                if part:
                    shared.setdefault(part, dict(joint=joint, detail=detail, meshes=[]))["meshes"] += raw(name)
                else:
                    meshes = raw(name)
                    side = side_of(name, np.vstack([m[0] for m in meshes])[:, 0].mean())
                    V, F, half, lo, pitch = wrapped(name, meshes, auto_pitch(meshes, 0.0012), cache)
                    bones.append(dict(name=name, side=side, detail=detail, joint=joint.format(side=side) if joint else None, V=V, F=F, half=half, lo=lo, pitch=pitch))
                break
    for part, info in shared.items():
        V, F, half, lo, pitch = wrapped(part, info["meshes"], 0.0012, cache)
        bones.append(dict(name=part, side="M", detail=info["detail"], joint=info["joint"], V=V, F=F, half=half, lo=lo, pitch=pitch))
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


def hand_skin(skin, sk):
    """The source hand is posed nothing like Anny's, so its skin must not steer the field."""
    mask = np.zeros(len(skin), bool)
    for side in "RL":
        W, E = sk.joint("wrist", side), sk.joint("elbow", side)
        axis = unit(W - E)
        along = (skin - W) @ axis
        radial = np.linalg.norm(skin - W - along[:, None] * axis, axis=1)
        mask |= (along > -0.015) & (along < 0.3) & (radial < 0.1)
    return mask


def main():
    isa, v3, cache = (Path(a) for a in sys.argv[1:4])
    cache.mkdir(parents=True, exist_ok=True)
    named = index_source(isa)
    stems = {v: k for k, v in named.items()}
    bone_vertices = lambda name: to_body_frame(read_obj(isa / f"{stems[name]}.obj")[0])
    sk = SourceSkeleton(bone_vertices)
    fine = load_fine_bones(cache)
    skin_raw, skin_faces = read_obj(isa / f"{stems['Skin']}.obj")
    skin = to_body_frame(skin_raw)
    source_height = skin[:, 1].max() - skin[:, 1].min()

    muscles, bones = collect(isa, v3, named, sk, cache)
    assign_budget(muscles, MUSCLE_TRIANGLES)
    assign_budget(bones, BONE_TRIANGLES)

    for p in muscles:
        p["source"] = p["V"]
        p["fibre_coord"] = fibre_coordinate(p["V"], p, sk)
        p["tendon"] = np.ones(len(p["V"])) if re.search(ALL_TENDON, p["name"], re.I) else tendon_share(p["V"], p["F"], p["half"], p["lo"], p["pitch"])
        if "rectus abdominis" in p["name"].lower():
            p["tendon"] = np.maximum(p["tendon"], 1 - smoothstep(RECTUS_GROOVE[0], RECTUS_GROOVE[0] * 2.2, rectus_band(p["V"])))
    for p in bones:
        p["source"] = p["V"]

    hand_re = re.compile(rf"({HAND_CARPAL}|metacarpal bone|phalanx of \w+ (thumb|index finger|middle finger|ring finger|little finger))", re.I)
    hand_parts = {side: [p for p in bones if p["side"] == side and hand_re.search(p["name"])] for side in "RL"}
    rigid_limb = {
        r"\bhumerus$": ("arm", 0),
        r"\b(radius|ulna)$": ("arm", 1),
        r"\bfemur$": ("leg", 0),
        r"\b(tibia|fibula)$": ("leg", 1),
    }

    usable = ~hand_skin(skin, sk)

    posed = {}
    inside_report = {}
    for sex in SEXES:
        print(sex)
        ref = Reference(sex, fine)
        hands = {side: HandMap(hand_parts[side], ref, sk, side) for side in "RL"}
        warp = SkeletonWarp(sk, ref, skin, hands)
        field = SkinField(warp(skin), skin_faces, ref, usable)
        scale = (ref.V[:, 1].max() - ref.V[:, 1].min()) / source_height

        for p in muscles:
            p[sex] = field(warp(p["source"]))
        for p in bones:
            P = p["source"]
            if p in hand_parts["R"] or p in hand_parts["L"]:
                p[sex] = hands[p["side"]](p["name"], P)
                continue
            for pattern, (limb, segment) in rigid_limb.items():
                if re.search(pattern, p["name"], re.I):
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
        worst = []
        for p in muscles:
            out = ~winding_inside(p[sex], ref)
            if out.any():
                worst.append((round(float(out.mean()) * 100), round(float(signed_distance_estimate(p[sex][out], ref)[0].max()) * 1000, 1), p["name"]))
        print("  parts with vertices outside (share %, mm)", sorted(worst, reverse=True)[:12])
        print("  inside share from the warp alone", {k: round(v * 100, 1) for k, v in warped.items()})
        moved_total = 0
        for p in muscles + bones:
            p[sex], moved = contain(p[sex], ref)
            moved_total += moved

        # The measured fit: exact winding number on the reference shell.
        table = {}
        for g in GROUPS:
            X = np.vstack([p[sex] for p in muscles if p["group"] == g])
            table[g] = float(winding_inside(X, ref).mean())
        Xb = np.vstack([p[sex] for p in bones])
        table["skeleton"] = float(winding_inside(Xb, ref).mean())
        inside_report[sex] = dict(warp=warped, final=table)
        print("  inside share", {k: round(v * 100, 1) for k, v in table.items()}, "| pulled vertices", moved_total)
        posed[sex] = ref

    write(muscles, bones, posed, sk, inside_report)


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
                mask = members & big
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
        source="BodyParts3D 4.0 is_a set (latissimus dorsi, rectus abdominis, internal oblique from BodyParts3D 3.0), The Database Center for Life Science. Rewrapped, decimated and warped onto Anny reference bodies.",
        attribution="BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0 per the database's current licence page; the 4.0 OBJ headers and the 3.0 files still state CC BY-SA 2.1 Japan.",
    )
    (OUT / "muscles.bin").write_bytes(b"".join(w.chunks))
    (OUT / "muscles.json").write_text(json.dumps(meta))
    print("muscles.bin", w.offset, "bytes;", "muscles.json", (OUT / "muscles.json").stat().st_size, "bytes;", len(pick_vertices), "pick points")


if __name__ == "__main__":
    main()
