"""Turns HuBMAP/Visible Human reference organs into one small file per sex.

Each organ is rewrapped into a single watertight surface, warped from the Visible
Human frame into the Anny reference body by matching torso slices, then decimated.
Named vessels also get a centerline, which is what substances travel along.
"""
import json, struct, sys, re
from pathlib import Path
import numpy as np, trimesh, fast_simplification
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import measure
from skimage.graph import route_through_array
from skimage.morphology import skeletonize

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(sys.argv[1])  # folder holding the downloaded GLBs
OUT = ROOT / "public/assets"
refs = np.load(ROOT / "pipeline/cache/reference_bodies.npz")
meta_body = json.loads((OUT / "body.json").read_text())
body_bin = (OUT / "body.bin").read_bytes()
rng = np.random.default_rng(7)


def read_glb(path):
    b = path.read_bytes()
    o, js, bin_ = 12, None, None
    while o < len(b):
        cl, ct = struct.unpack("<II", b[o : o + 8])
        d = b[o + 8 : o + 8 + cl]
        o += 8 + cl
        if ct == 0x4E4F534A:
            js = json.loads(d)
        else:
            bin_ = d
    return js, bin_


def node_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], float).reshape(4, 4).T
    T = np.eye(4)
    T[:3, 3] = n.get("translation", [0, 0, 0])
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    R = np.eye(4)
    R[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return T @ R @ np.diag(n.get("scale", [1, 1, 1]) + [1])


COMP = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
NCOMP = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}


def accessor(js, bin_, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    dt = np.dtype(COMP[a["componentType"]]).newbyteorder("<")
    n = NCOMP[a["type"]]
    stride = bv.get("byteStride")
    if stride and stride != dt.itemsize * n:
        raw = np.frombuffer(bin_, np.uint8, stride * a["count"], start)
        return np.stack([np.frombuffer(raw[k * dt.itemsize :: 1].tobytes(), dt)[:: stride // dt.itemsize][: a["count"]] for k in range(n)], 1)
    return np.frombuffer(bin_, dt, a["count"] * n, start).reshape(-1, n) if n > 1 else np.frombuffer(bin_, dt, a["count"], start)


# The two reference bodies were annotated separately and spell a few parts differently.
SPELLING = {
    "left_ventricle": "heart_left_ventricle",
    "jejenum": "jejunum",
    "right_ventricle": "heart_right_ventricle",
    "duodenum_horizonal": "duodenum_horizontal",
}


def load_parts(path):
    """Returns {node name: (V, F)} in world coordinates, name stripped of prefixes."""
    js, bin_ = read_glb(path)
    parts = {}

    def rec(i, P):
        n = js["nodes"][i]
        M = P @ node_matrix(n)
        if "mesh" in n:
            vs, fs, off = [], [], 0
            for pr in js["meshes"][n["mesh"]]["primitives"]:
                v = accessor(js, bin_, pr["attributes"]["POSITION"]).astype(float)
                f = accessor(js, bin_, pr["indices"]).astype(np.int64).reshape(-1, 3) if "indices" in pr else np.arange(len(v)).reshape(-1, 3)
                vs.append(v)
                fs.append(f + off)
                off += len(v)
            V = (M @ np.c_[np.vstack(vs), np.ones(off)].T).T[:, :3]
            name = re.sub(r"^(VH_[MF]_|Allen_[MF]_|SBU_[MF]_|Allen_|SBU_)", "", n.get("name", str(i)))
            name = SPELLING.get(name, name)
            parts[name] = (V, np.vstack(fs))
        for c in n.get("children", []):
            rec(c, M)

    for r in js["scenes"][js.get("scene", 0)]["nodes"]:
        rec(r, np.eye(4))
    return parts


def surface_points(V, F, spacing):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    counts = np.minimum(np.ceil(areas / (spacing**2 * 0.4)).astype(int) + 1, 400)
    idx = np.repeat(np.arange(len(F)), counts)
    u, v = rng.random(len(idx)), rng.random(len(idx))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[idx] + (b[idx] - a[idx]) * u[:, None] + (c[idx] - a[idx]) * v[:, None]


def voxelize(meshes, pitch, close=1, extra_room=0):
    pts = np.vstack([surface_points(V, F, pitch) for V, F in meshes])
    # Room around the shape, so closing it can't run off the edge of the grid.
    room = 3 + close + extra_room
    lo = pts.min(0) - pitch * room
    dims = np.ceil((pts.max(0) - lo) / pitch).astype(int) + room + 1
    grid = np.zeros(dims, bool)
    ijk = ((pts - lo) / pitch).astype(int)
    grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    if close:
        grid = ndi.binary_closing(grid, iterations=close)
    grid = ndi.binary_fill_holes(grid)
    return grid, lo


def without_crumbs(V, F, least_share=0.05):
    """A thin wall can come apart where it is blurred: drops pieces too small to mean anything."""
    mesh = trimesh.Trimesh(V, F, process=False)
    parts = trimesh.graph.connected_components(mesh.edges, nodes=np.arange(len(V)))
    largest = max(len(p) for p in parts)
    keep = np.zeros(len(V), bool)
    for part in parts:
        if len(part) >= largest * least_share:
            keep[part] = True
    remap = -np.ones(len(V), int)
    remap[keep] = np.arange(keep.sum())
    return V[keep], remap[F[keep[F].all(axis=1)]]


def wrap(meshes, pitch, close=1, sigma=0.9, keep_largest=True, slim=0):
    grid, lo = voxelize(meshes, pitch, close)
    if slim:
        # Only the wide parts come in: eroding a narrow part as well would cut the shape in two.
        n = int(slim / pitch)
        wide = ndi.binary_opening(grid, iterations=3 * n)
        grid = ndi.binary_erosion(grid, iterations=n) | (grid & ~ndi.binary_dilation(wide, iterations=n))
        grid = ndi.binary_closing(grid, iterations=n)
    if keep_largest:
        lab, n = ndi.label(grid)
        if n > 1:
            sizes = ndi.sum(grid, lab, range(1, n + 1))
            grid = lab == (1 + int(np.argmax(sizes)))
    smooth = ndi.gaussian_filter(grid.astype(np.float32), sigma)
    # Thin parts like the airway never reach 0.5 once blurred, so the level follows the peak.
    V, F, _, _ = measure.marching_cubes(smooth, min(0.5, float(smooth.max()) * 0.6))
    return without_crumbs(V * pitch + lo, F[:, ::-1].astype(np.int64))


FILLED_CLOSING = 7


def between_ends(grid, axis):
    """Voxels between the first and last occupied voxel of every line along one axis."""
    first = np.argmax(grid, axis=axis)
    last = grid.shape[axis] - 1 - np.argmax(np.flip(grid, axis=axis), axis=axis)
    occupied = grid.any(axis=axis)
    at = np.indices(grid.shape)[axis]
    return (at >= np.expand_dims(first, axis)) & (at <= np.expand_dims(last, axis)) & np.expand_dims(occupied, axis)


def wrap_filled(meshes, pitch, close, sigma):
    """For a part drawn only as patches of its outside, such as a lung's segments, which never close into a surface to fill."""
    grid, lo = voxelize(meshes, pitch, close, extra_room=FILLED_CLOSING)
    solid = between_ends(grid, 0) & between_ends(grid, 1) & between_ends(grid, 2)
    # What that leaves is shaped right except for windows at a hilum, where vessels go in.
    solid = ndi.binary_fill_holes(ndi.binary_closing(solid, iterations=FILLED_CLOSING))
    lab, n = ndi.label(solid)
    if n > 1:
        solid = lab == (1 + int(np.argmax(ndi.sum(solid, lab, range(1, n + 1)))))
    V, F, _, _ = measure.marching_cubes(ndi.gaussian_filter(solid.astype(np.float32), sigma), 0.5)
    return without_crumbs(V * pitch + lo, F[:, ::-1].astype(np.int64))


# The source's coils are open wall pieces that never close into one tube, so only the room they take
# up is kept. The tube is grown inside that room from the end of the duodenum to the ileocecal valve:
# the path keeps gaining length, its parts push each other away, and it buckles into loops the way a
# real gut folds. Nothing can cross, because no point ever moves further than the gap between strands.
DUODENUM_PATH = dict(pitch=0.002, smoothing=2, spacing=0.006, end_reach=0.01)
BOWEL = dict(
    pitch=0.003,  # of the grid the room is held in
    frame_closing=0.04,  # bridges the gaps in the colon's ring when working out what it frames
    room_depth=0.07,  # front to back: about two layers of loops, since anything further back never shows
    under_skin=0.0,  # how far the front of the tube keeps from the skin of the belly
    room_lower=0.03,  # and below them
    filled=1.1,  # share of the room the tube ends up taking
    apart=1.15,  # strands stay this many diameters apart, centre to centre, which keeps the loops loose
    spacing=0.01,  # between points on the path while it grows
    inset=0.72,  # how many radii the path keeps from the wall of the room
    tightest_bend=1.3,  # in radii of the tube
    most_easing=16,
    tightest_swept=1.0,
    most_sweep_easing=60,
    grow_every=40,
    settle_steps=1500,
    most_steps=40000,
    largest_move=0.003,
    ring_spacing=0.0065,
    sides=12,
    jejunum_share=0.4,
)


def bowel_room(coil_meshes, colon_meshes, radius, belly_front):
    """The space the small intestine has, as a signed distance: positive inside, in metres. The source's
    coils are a thin slab of it, so the room also takes what the colon frames at that depth."""
    pitch = BOWEL["pitch"]
    coil_points = np.vstack([surface_points(V, F, pitch) for V, F in coil_meshes])
    colon_points = np.vstack([surface_points(V, F, pitch) for V, F in colon_meshes])
    margin = pitch * (FILLED_CLOSING + 8)
    lo = np.minimum(coil_points.min(0), colon_points.min(0)) - margin
    hi = np.maximum(coil_points.max(0), colon_points.max(0)) + margin
    hi[2] = max(hi[2], belly_front + margin)
    dims = np.ceil((hi - lo) / pitch).astype(int)

    def marked(points):
        grid = np.zeros(dims, bool)
        at = ((points - lo) / pitch).astype(int)
        grid[at[:, 0], at[:, 1], at[:, 2]] = True
        return grid

    coil = ndi.binary_fill_holes(ndi.binary_closing(marked(coil_points), iterations=2))
    coil = between_ends(coil, 0) & between_ends(coil, 1) & between_ends(coil, 2)
    coil = ndi.binary_fill_holes(ndi.binary_closing(coil, iterations=FILLED_CLOSING))
    colon = ndi.binary_fill_holes(ndi.binary_closing(marked(colon_points), iterations=3))

    framed = ndi.binary_fill_holes(ndi.binary_closing(colon.any(axis=2), iterations=int(BOWEL["frame_closing"] / pitch)))
    level = np.nonzero(coil.any(axis=(0, 2)))[0]
    front = int((belly_front - radius * BOWEL["inset"] - BOWEL["under_skin"] - lo[2]) / pitch)
    z_band = np.zeros(dims[2], bool)
    z_band[front - int(BOWEL["room_depth"] / pitch) : front + 1] = True
    y_band = np.zeros(dims[1], bool)
    y_band[max(0, level[0] - int(BOWEL["room_lower"] / pitch)) : level[-1] + 1] = True
    room = (framed[:, :, None] | coil.any(axis=2)[:, :, None]) & z_band[None, None, :] & y_band[None, :, None]
    room &= ~ndi.binary_dilation(colon, iterations=int(radius * 0.7 / pitch))
    lab, n = ndi.label(room)
    if n > 1:
        room = lab == (1 + int(np.argmax(ndi.sum(room, lab, range(1, n + 1)))))
    outside = ndi.distance_transform_edt(~room) * pitch
    inside = ndi.distance_transform_edt(room) * pitch
    return ndi.gaussian_filter((inside - outside).astype(np.float32), 1.5), lo, pitch


def turning(path):
    """The angle the path turns through at each of its inner points."""
    before = path[1:-1] - path[:-2]
    after = path[2:] - path[1:-1]
    cosine = (before * after).sum(axis=1) / (np.linalg.norm(before, axis=1) * np.linalg.norm(after, axis=1)).clip(1e-9)
    return np.arccos(np.clip(cosine, -1, 1))


def evenly_spaced(path, spacing):
    walked = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    at = np.linspace(0, walked[-1], max(4, int(round(walked[-1] / spacing))))
    return np.stack([np.interp(at, walked, path[:, k]) for k in range(3)], axis=1)


def eased_bends(path, spacing, most_turn, most_easing):
    """Smooths only where the path still turns too sharply, so the rest of its length is kept."""
    for _ in range(most_easing):
        path = evenly_spaced(path, spacing)
        tight = np.r_[False, turning(path) > most_turn, False]
        if not tight.any():
            break
        around = ndi.binary_dilation(tight, iterations=3)
        between = np.zeros_like(path)
        between[1:-1] = 0.5 * (path[:-2] + path[2:]) - path[1:-1]
        path = path + 0.5 * around[:, None] * between
    return path


def grow_bowel(coil_meshes, colon_meshes, start, end, diameter, belly_front, seed):
    """The tube's centre line, as evenly spaced points from start to end."""
    signed, lo, pitch = bowel_room(coil_meshes, colon_meshes, diameter / 2, belly_front)
    gradient = np.stack(np.gradient(signed, pitch), axis=-1)
    def room_at(p):
        at = ((p - lo) / pitch).T
        depth = ndi.map_coordinates(signed, at, order=1, mode="nearest")
        slope = np.stack([ndi.map_coordinates(gradient[..., k], at, order=1, mode="nearest") for k in range(3)], axis=1)
        return depth, slope

    rng_tube = np.random.default_rng(seed)
    radius = diameter / 2
    spacing = BOWEL["spacing"]
    most_turn = spacing / (radius * BOWEL["tightest_bend"])
    apart = diameter * BOWEL["apart"]
    skip = int(np.ceil(apart * 1.7 / spacing))
    inset = radius * BOWEL["inset"]
    room = float((signed > inset).sum()) * pitch**3
    length_wanted = BOWEL["filled"] * room / (np.pi * radius**2)

    count = max(8, int(np.linalg.norm(end - start) / spacing))
    path = np.linspace(start, end, count)
    path[1:-1] += rng_tube.normal(0, 0.002, (count - 2, 3))
    steps = 0
    settle = 0
    while settle < BOWEL["settle_steps"] and steps < BOWEL["most_steps"]:
        steps += 1
        along = path[1:] - path[:-1]
        lengths = np.linalg.norm(along, axis=1, keepdims=True).clip(1e-6)
        pull = 0.1 * (lengths - spacing) * along / lengths
        force = np.zeros_like(path)
        force[:-1] += pull
        force[1:] -= pull
        # Stiffness against bending, which is what makes it buckle into long loops and not a zigzag. A
        # bend tighter than the tube itself would fold its inner wall through itself, so those are eased hard.
        force[2:-2] += 0.012 * (4 * (path[1:-3] + path[3:-1]) - 6 * path[2:-2] - path[:-4] - path[4:])
        between = 0.5 * (path[:-2] + path[2:]) - path[1:-1]
        force[1:-1] += (0.3 * np.clip(turning(path) / most_turn - 1, 0, 1))[:, None] * between
        pairs = cKDTree(path).query_pairs(apart, output_type="ndarray")
        crowded = np.zeros(len(path))
        if len(pairs):
            pairs = pairs[np.abs(pairs[:, 0] - pairs[:, 1]) > skip]
            if len(pairs):
                gap = path[pairs[:, 0]] - path[pairs[:, 1]]
                d = np.linalg.norm(gap, axis=1, keepdims=True).clip(1e-6)
                push = 0.05 * (apart - d) * gap / d
                np.add.at(force, pairs[:, 0], push)
                np.add.at(force, pairs[:, 1], -push)
                np.add.at(crowded, pairs.ravel(), 1)
        depth, slope = room_at(path)
        outside = (inset - depth).clip(0)[:, None]
        force += 0.5 * outside * slope
        size = np.linalg.norm(force, axis=1, keepdims=True).clip(1e-9)
        force *= np.minimum(1, BOWEL["largest_move"] / size)
        force[0] = force[-1] = 0
        path += force

        total = float(np.linalg.norm(path[1:] - path[:-1], axis=1).sum())
        if total >= length_wanted:
            settle += 1
        elif steps % BOWEL["grow_every"] == 0:
            free = np.nonzero((crowded[:-1] == 0) & (depth[:-1] > inset * 0.8))[0]
            pick = free if len(free) else np.arange(len(path) - 1)
            i = int(rng_tube.choice(pick))
            path = np.insert(path, i + 1, 0.5 * (path[i] + path[i + 1]) + rng_tube.normal(0, 0.0006, 3), axis=0)
    grown = float(np.linalg.norm(path[1:] - path[:-1], axis=1).sum())
    path = eased_bends(path, spacing, most_turn, BOWEL["most_easing"])
    total = float(np.linalg.norm(path[1:] - path[:-1], axis=1).sum())
    pairs = cKDTree(path).query_pairs(diameter, output_type="ndarray")
    closest = "none nearer than the diameter" if not len(pairs) else None
    if len(pairs):
        pairs = pairs[np.abs(pairs[:, 0] - pairs[:, 1]) > skip]
        closest = round(float(np.linalg.norm(path[pairs[:, 0]] - path[pairs[:, 1]], axis=1).min()), 4) if len(pairs) else "none nearer than the diameter"
    print(f"  bowel: room {room * 1000:.2f} l, wanted {length_wanted:.2f} m, grew {grown:.2f} m, {total:.2f} m once eased, in {steps} steps, closest strands {closest}, tightest bend {spacing / turning(path).max() / radius:.2f} radii")
    return path


def sweep_tube(path, radius):
    """A closed tube round a path. Also returns each vertex's distance along the path, for lines that run round it."""
    # A bend tighter than the tube's own radius would turn its inner wall inside out.
    spacing = BOWEL["ring_spacing"]
    centre = evenly_spaced(ndi.gaussian_filter1d(path, 1.5, axis=0, mode="nearest"), spacing)
    centre = eased_bends(centre, spacing, spacing / (radius * BOWEL["tightest_swept"]), BOWEL["most_sweep_easing"])
    print(f"  bowel: tube {np.linalg.norm(np.diff(centre, axis=0), axis=1).sum():.2f} m, tightest bend {spacing / turning(centre).max() / radius:.2f} radii")
    at = np.r_[0, np.cumsum(np.linalg.norm(np.diff(centre, axis=0), axis=1))]
    tangent = np.gradient(centre, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    # Round the ends off so the tube is closed.
    ends = np.array([0.45, 0.8, 0.96])
    scale = np.ones(len(centre))
    scale[: len(ends)] = ends
    scale[-len(ends) :] = ends[::-1]
    sides = BOWEL["sides"]
    angles = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    up = np.cross(tangent[0], [0.0, 1.0, 0.0] if abs(tangent[0, 1]) < 0.9 else [1.0, 0.0, 0.0])
    up /= np.linalg.norm(up)
    rings, along = [], []
    for k in range(len(centre)):
        up = up - tangent[k] * (up @ tangent[k])
        up /= np.linalg.norm(up)
        side = np.cross(tangent[k], up)
        rings.append(centre[k] + radius * scale[k] * (np.cos(angles)[:, None] * up + np.sin(angles)[:, None] * side))
        along.append(np.full(sides, at[k]))
    V = np.vstack(rings + [centre[:1], centre[-1:]])
    along = np.concatenate(along + [at[:1], at[-1:]])
    n = len(centre)
    F = []
    for k in range(n - 1):
        for j in range(sides):
            a, b = k * sides + j, k * sides + (j + 1) % sides
            c, d = a + sides, b + sides
            F += [(a, b, c), (b, d, c)]
    first, last = n * sides, n * sides + 1
    for j in range(sides):
        F.append((first, (j + 1) % sides, j))
        F.append((last, (n - 1) * sides + j, (n - 1) * sides + (j + 1) % sides))
    return V, np.array(F, dtype=np.int64), along.astype(np.float32)


def duodenum_inside(drawn, parts):
    """A path down the middle of the duodenum as it is drawn, always inside it. The skeletons of its short
    separate pieces wander from wall to wall and don't join up, and anything travelling through has to stay in."""
    pitch = DUODENUM_PATH["pitch"]
    # Sampled densely enough to hold a fill without closing, which would bridge the bend of the C.
    points = surface_points(*drawn, pitch * 0.35)
    lo = points.min(0) - pitch * 3
    grid = np.zeros(np.ceil((points.max(0) + pitch * 3 - lo) / pitch).astype(int), bool)
    at = ((points - lo) / pitch).astype(int)
    grid[at[:, 0], at[:, 1], at[:, 2]] = True
    grid = ndi.binary_fill_holes(grid)
    depth = ndi.distance_transform_edt(grid) * pitch
    away = lambda part, other: part[np.argmax(np.linalg.norm(part - parts[other][0].mean(0), axis=1))]
    ends = [away(parts["duodenum_superior"][0], "duodenum_descending"), away(parts["duodenum_ascending"][0], "duodenum_horizontal")]
    solid = np.argwhere(grid)
    centres = (solid + 0.5) * pitch + lo

    def deepest_near(point):
        near = np.linalg.norm(centres - point, axis=1) < DUODENUM_PATH["end_reach"]
        return tuple(solid[near][np.argmax(depth[tuple(solid[near].T)])])

    start, end = deepest_near(ends[0]), deepest_near(ends[1])
    # Wide berth from the walls costs nothing, and hugging one costs a lot, so the cheapest way runs down the middle.
    cost = np.where(grid, 1 / (depth + pitch) ** 2, 1e9)
    line, _ = route_through_array(cost, start, end, fully_connected=True, geometric=True)
    line = (np.array(line) + 0.5) * pitch + lo
    return evenly_spaced(ndi.gaussian_filter1d(line, DUODENUM_PATH["smoothing"], axis=0, mode="nearest"), DUODENUM_PATH["spacing"])


def decimate(V, F, target):
    if len(F) <= target:
        return V, F
    v, f = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=target, agg=3)
    return v.astype(float), f.astype(np.int64)


def profile(V, levels, band, gap):
    """Center and half-size of the blob containing the midline, at each height."""
    out = []
    for y in levels:
        s = V[np.abs(V[:, 1] - y) < band]
        xs = np.sort(s[:, 0])
        gaps = np.where(np.diff(xs) > gap)[0]
        seed = np.searchsorted(xs, 0.0)
        left = xs[gaps[gaps < seed][-1] + 1] if (gaps < seed).any() else xs[0]
        right = xs[gaps[gaps >= seed][0]] if (gaps >= seed).any() else xs[-1]
        blob = s[(s[:, 0] >= left) & (s[:, 0] <= right)]
        out.append([(left + right) / 2, (right - left) / 2, (blob[:, 2].max() + blob[:, 2].min()) / 2, (blob[:, 2].max() - blob[:, 2].min()) / 2])
    return np.array(out)


def body_landmarks(V, band, gap):
    """Crotch and neck heights: first midline surface going up, then the narrowest slice above the shoulders."""
    top = V[:, 1].max()
    bottom = V[:, 1].min()
    ys = np.linspace(bottom + (top - bottom) * 0.25, top - 0.01, 300)
    has_mid = np.array([(np.abs(V[np.abs(V[:, 1] - y) < band][:, 0]) < 0.02).any() for y in ys])
    crotch = ys[np.argmax(has_mid)]
    lv = np.linspace(crotch + (top - crotch) * 0.72, top - (top - crotch) * 0.09, 40)
    prof = profile(V, lv, band, gap)
    neck = lv[int(np.argmin(prof[:, 1]))]
    return crotch, neck, top


class Warp:
    BAND_SRC, GAP_SRC = 0.008, 0.018
    BAND_DST, GAP_DST = 0.015, 0.06

    def __init__(self, src, dst):
        cs, ns, ts = body_landmarks(src, self.BAND_SRC, self.GAP_SRC)
        cd, nd, td = body_landmarks(dst, self.BAND_DST, self.GAP_DST)
        self.ys_src = np.array([cs - 0.3, cs, ns, ts, ts + 0.1])
        self.ys_dst = np.array([cd - 0.3 * (nd - cd) / (ns - cs), cd, nd, td, td + 0.1 * (td - nd) / (ts - ns)])
        t = np.r_[np.linspace(0, 1, 14, endpoint=False) * (ns - cs) + cs + 0.02, np.linspace(0, 1, 7) * (ts - 0.02 - ns) + ns]
        self.t_src = t
        d = np.interp(t, self.ys_src, self.ys_dst)
        ps = profile(src, t, self.BAND_SRC, self.GAP_SRC)
        pd = profile(dst, d, self.BAND_DST, self.GAP_DST)
        self.cx = ndi.gaussian_filter1d(pd[:, 0] - ps[:, 0], 1.0, mode="nearest")
        ratio = pd[:, 1] / ps[:, 1]
        # Visible Human's arms are fused to its shoulders in these slices, so above the chest
        # the width ratio says nothing about the ribcage: hold the value from below.
        frac = (t - cs) / (ns - cs)
        chest = np.argmin(np.abs(frac - 0.42))
        ratio[(frac > 0.42) & (frac <= 1.0)] = ratio[chest]
        self.sx = ndi.gaussian_filter1d(ratio, 1.0, mode="nearest")
        self.cz_s = ndi.gaussian_filter1d(ps[:, 2], 1.0, mode="nearest")
        self.cz_d = ndi.gaussian_filter1d(pd[:, 2], 1.0, mode="nearest")
        self.sz = ndi.gaussian_filter1d(pd[:, 3] / ps[:, 3], 1.0, mode="nearest")
        self.cx_s = ndi.gaussian_filter1d(ps[:, 0], 1.0, mode="nearest")
        print("  warp y", np.round(self.ys_src, 3), "->", np.round(self.ys_dst, 3), "| sx", np.round(self.sx[[2, 7, 12, 18]], 2), "sz", np.round(self.sz[[2, 7, 12, 18]], 2))

    def __call__(self, V):
        y = V[:, 1]
        i = lambda a: np.interp(y, self.t_src, a)
        x = i(self.cx_s) + i(self.cx) + (V[:, 0] - i(self.cx_s)) * i(self.sx)
        z = i(self.cz_d) + (V[:, 2] - i(self.cz_s)) * i(self.sz)
        return np.c_[x, np.interp(y, self.ys_src, self.ys_dst), z]


def centerline(V, F, pitch=0.0016, step=0.008):
    if len(F) < 8:
        return None
    grid, lo = voxelize([(V, F)], pitch, close=1)
    sk = skeletonize(grid)
    pts = np.argwhere(sk)
    if len(pts) < 2:
        return None
    index = {tuple(p): i for i, p in enumerate(pts)}
    nb = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
    adj = [[index[(p[0] + a, p[1] + b, p[2] + c)] for a, b, c in nb if (p[0] + a, p[1] + b, p[2] + c) in index] for p in pts]

    def farthest(s):
        prev = {s: None}
        frontier, last = [s], s
        while frontier:
            nxt = []
            for u in frontier:
                for w in adj[u]:
                    if w not in prev:
                        prev[w] = u
                        nxt.append(w)
                        last = w
            frontier = nxt
        return last, prev

    # Skeleton may be broken into islands, so start from the biggest one.
    seen, best = set(), []
    for s in range(len(pts)):
        if s in seen:
            continue
        _, prev = farthest(s)
        seen |= set(prev)
        if len(prev) > len(best):
            best = list(prev)
    a, _ = farthest(best[0])
    b, prev = farthest(a)
    path = []
    u = b
    while u is not None:
        path.append(u)
        u = prev[u]
    line = pts[path] * pitch + lo
    if len(line) > 5:
        line = ndi.gaussian_filter1d(line.astype(float), 2.0, axis=0, mode="nearest")
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))]
    n = max(2, int(seg[-1] / step))
    return np.stack([np.interp(np.linspace(0, seg[-1], n), seg, line[:, k]) for k in range(3)], 1)


def normalize_vessel(name):
    m = re.match(r"(left|right)_(.*)", name)
    if m and re.search(r"(renal|common_iliac)", name):
        side = "L" if m.group(1) == "left" else "R"
        name = f"{m.group(2)}_{side}"
    name = name.replace("left_renal_artery", "renal_artery_L").replace("right_renal_artery", "renal_artery_R")
    return name


ARTERY = re.compile(r"(artery|aorta|aortic|carotid|celiac|subclavian|brachiocephalic_artery|branch_of_anterior|marginal_branch|posterior_left_ventricular|circumflex)")
EXCLUDE_VESSEL = re.compile(r"(ophthalmic|opthalmic|retinal)")

ORGANS = {
    # name: (file suffix, part filter, wrap pitch in m, closing iterations, blur sigma, target triangles)
    "brain": ("Brain", None, 0.0016, 3, 1.1, 18000),
    "heart": ("Heart", r"(atrium|ventricle|septum)", 0.0016, 2, 1.4, 7000),
    "liver": ("Liver", None, 0.0022, 3, 1.4, 7000),
    "lung_L": ("Lung", r"^(left_|lingula_).*bronchopulmonary", 0.004, 2, 2.0, 6000),
    "lung_R": ("Lung", r"^right_.*bronchopulmonary", 0.004, 2, 2.0, 6000),
    "airway": ("Lung", r"(^trachea$|main_bronchus|carina)", 0.0018, 2, 1.1, 2500),
    "kidney_L": ("Kidney_L", r"capsule", 0.0018, 3, 2.0, 2800),
    "kidney_R": ("Kidney_R", r"capsule", 0.0018, 3, 2.0, 2800),
    "pancreas": ("Pancreas", None, 0.0018, 2, 1.3, 3000),
    # These source walls are separate open pieces, so closing has to seal the seams before filling.
    "spleen": ("Spleen", None, 0.002, 8, 1.8, 2200),
    "duodenum": ("Small_Intestine", r"duodenum", 0.0018, 8, 1.8, 2500),
    "small_intestine": ("Small_Intestine", r"(ileum|jejunum)", 0, 0, 0, 0),  # generated: see grow_bowel
    "large_intestine": ("Intestine_Large", None, 0.0024, 9, 2.6, 9000),
    "bladder": ("Urinary_Bladder", None, 0.002, 8, 1.8, 1400),
    "spinal_cord": ("Spinal_Cord", None, 0.002, 2, 1.0, 1600),
    "thymus": ("Thymus", None, 0.0018, 2, 1.2, 1600),
    "uterus": ("Uterus", None, 0.0018, 4, 1.3, 2600),
    "ovary_L": ("Ovary_L", None, 0.0012, 3, 1.0, 700),
    "ovary_R": ("Ovary_R", None, 0.0012, 3, 1.0, 700),
    "tube_L": ("Fallopian_Tube_L", None, 0.0012, 3, 0.8, 900),
    "tube_R": ("Fallopian_Tube_R", None, 0.0012, 3, 0.8, 900),
    "prostate": ("Prostate", None, 0.0016, 4, 1.2, 1600),
}
# Organs only one reference body has.
ONLY_IN = {"uterus": "F", "ovary_L": "F", "ovary_R": "F", "tube_L": "F", "tube_R": "F", "prostate": "M"}
# Shapes in more than one piece, which keep every piece.
SEVERAL_PIECES = ("thymus",)
# Coils and folds so fine that decimating leaves little facets, which would shade as flecks.
SMOOTHED = ("duodenum", "large_intestine")
# Drawn only as patches of their outside.
FILLED = ("lung_L", "lung_R", "kidney_L", "kidney_R")
BOWEL_SEED = {"male": 3, "female": 5}
BOWEL_DIAMETER = {"male": 0.025, "female": 0.021}  # the female reference has a much smaller space inside the colon
# The source's colon is distended enough to wall off the small intestine, so it loses this much off every side.
SLIMMED = {"large_intestine": 0.007}


def source_file(sex_code, suffix):
    if suffix == "Brain":
        return SRC / f"Allen_{sex_code}_Brain.glb"
    if suffix == "Intestine_Large":
        return SRC / f"SBU_{sex_code}_Intestine_Large.glb"
    return SRC / f"VH_{sex_code}_{suffix}.glb"


def torso_vertices(sex):
    """Reference-body vertices that belong to trunk and head, so arms don't widen the slices."""
    v = refs[sex]
    si = np.frombuffer(body_bin, np.uint8, meta_body["vertexCount"] * 4, meta_body["skinIndex"]).reshape(-1, 4)
    sw = np.frombuffer(body_bin, np.uint8, meta_body["vertexCount"] * 4, meta_body["skinWeight"]).reshape(-1, 4)
    names = [j["name"] for j in meta_body["joints"]]
    limb = np.array([n.startswith(("arm", "forearm", "hand", "clavicle")) for n in names])
    limb_w = (limb[si] * sw).sum(1) / 255
    return v[limb_w < 0.15]


def build(sex, code):
    print(sex)
    skin_parts = load_parts(SRC / f"VH_{code}_Skin.glb")
    skin = np.vstack([p[0] for p in skin_parts.values()])
    if code == "F":
        skin = skin[rng.choice(len(skin), 200000, replace=False)]
    warp = Warp(skin, torso_vertices(sex))

    meta = {"organs": {}, "landmarks": {}, "centerlines": {}, "vesselRadius": {}}
    chunks, offset = [], 0

    def add(arr):
        nonlocal offset
        b = arr.tobytes()
        pad = (-len(b)) % 4
        chunks.append(b + b"\0" * pad)
        start = offset
        offset += len(b) + pad
        return start

    Q = 32767 / 2.5
    cache = {}
    for name, (suffix, pattern, pitch, close, sigma, target) in ORGANS.items():
        if ONLY_IN.get(name, code) != code:
            continue
        # Organs in one body only leave the random sequence as they found it, so the rest build the same.
        rng_before = rng.bit_generator.state if name in ONLY_IN else None
        f = source_file(code, suffix)
        parts = cache.setdefault(f, load_parts(f))
        chosen = [p for n, p in parts.items() if pattern is None or re.search(pattern, n)]
        assert chosen, (name, list(parts)[:20])
        along = None
        if name == "small_intestine":
            large = cache.setdefault(source_file(code, "Intestine_Large"), load_parts(source_file(code, "Intestine_Large")))
            start = warp(duodenum_path[-1:])[0]
            end = warp(large["ileocecal_valve"][0].mean(0, keepdims=True))[0]
            colon = [(warp(pv), pf) for n, (pv, pf) in large.items()]
            coil = [(warp(pv), pf) for pv, pf in chosen]
            lowest, highest = min(c[0][:, 1].min() for c in coil), max(c[0][:, 1].max() for c in coil)
            belly = refs[sex][(np.abs(refs[sex][:, 0]) < 0.05) & (refs[sex][:, 1] > lowest) & (refs[sex][:, 1] < highest)]
            bowel_path = grow_bowel(coil, colon, start, end, BOWEL_DIAMETER[sex], np.percentile(belly[:, 2], 90), BOWEL_SEED[sex])
            V, F, along = sweep_tube(bowel_path, BOWEL_DIAMETER[sex] / 2)
        else:
            if name in FILLED:
                V, F = wrap_filled(chosen, pitch, close, sigma)
            else:
                V, F = wrap(chosen, pitch, close, sigma, keep_largest=name not in SEVERAL_PIECES, slim=SLIMMED.get(name, 0))
            V, F = decimate(V, F, target)
            if name in SMOOTHED:
                mesh = trimesh.Trimesh(V, F, process=False)
                trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=0.53, iterations=24)
                V = np.asarray(mesh.vertices)
            if name == "duodenum":
                duodenum_path = duodenum_inside((V, F), parts)
            V = warp(V)
        for n, (pv, _) in parts.items():
            meta["landmarks"][n] = np.round(warp(pv).mean(0), 4).tolist()
        meta["organs"][name] = {
            "pos": add(np.round(V * Q).astype(np.int16)),
            "vertexCount": len(V),
            "index": add(F.astype(np.uint32)),
            "indexCount": int(F.size),
            "center": np.round(V.mean(0), 4).tolist(),
            "min": np.round(V.min(0), 4).tolist(),
            "max": np.round(V.max(0), 4).tolist(),
        }
        if along is not None:
            meta["organs"][name]["along"] = add(along)
        if rng_before is not None:
            rng.bit_generator.state = rng_before
        print(f"  {name:18s} tris {len(F):6d} center {np.round(V.mean(0), 3)}")

    gut_parts = {**cache[source_file(code, "Small_Intestine")], **cache[source_file(code, "Intestine_Large")]}
    for part, (V, F) in gut_parts.items():
        if re.search(r"(duodenum_|jejunum|ileum|colon|caecum|rectum)", part):
            line = centerline(V, F, pitch=0.0022, step=0.01)
            if line is not None:
                meta["centerlines"][part] = np.round(warp(line), 4).tolist()
    # Anything travelling through the small intestine follows the tube that is actually drawn.
    meta["centerlines"].pop("ileum_terminal", None)
    meta["centerlines"]["duodenum_inside"] = np.round(warp(duodenum_path), 4).tolist()
    halfway = int(len(bowel_path) * BOWEL["jejunum_share"])
    meta["centerlines"]["jejunum"] = np.round(bowel_path[: halfway + 1], 4).tolist()
    meta["centerlines"]["ileum"] = np.round(bowel_path[halfway:], 4).tolist()
    meta["landmarks"]["jejunum_end"] = np.round(bowel_path[halfway], 4).tolist()

    vessels = load_parts(SRC / f"VH_{code}_Blood_Vasculature.glb")
    groups = {"arteries": [], "veins": []}
    for raw, (V, F) in vessels.items():
        if EXCLUDE_VESSEL.search(raw):
            continue
        name = normalize_vessel(raw)
        line = centerline(V, F)
        if line is not None:
            meta["centerlines"][name] = np.round(warp(line), 4).tolist()
            area = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum()
            length = max(np.linalg.norm(np.diff(line, axis=0), axis=1).sum(), 1e-3)
            meta["vesselRadius"][name] = round(float(area / (2 * np.pi * length)), 4)
        groups["arteries" if ARTERY.search(raw) and "vein" not in raw else "veins"].append((V, F))
    for name, target in (("arteries", 26000), ("veins", 26000)):
        Vs, Fs, off = [], [], 0
        for V, F in groups[name]:
            Vs.append(V)
            Fs.append(F + off)
            off += len(V)
        V, F = decimate(np.vstack(Vs), np.vstack(Fs), target)
        V = warp(V)
        meta["organs"][name] = {"pos": add(np.round(V * Q).astype(np.int16)), "vertexCount": len(V), "index": add(F.astype(np.uint32)), "indexCount": int(F.size), "center": np.round(V.mean(0), 4).tolist(), "min": np.round(V.min(0), 4).tolist(), "max": np.round(V.max(0), 4).tolist()}
        print(f"  {name:18s} tris {len(F):6d}")
    meta["quant"] = Q
    (OUT / f"organs-{sex}.bin").write_bytes(b"".join(chunks))
    (OUT / f"organs-{sex}.json").write_text(json.dumps(meta))
    print("  organs bin", offset, "centerlines", len(meta["centerlines"]))


build("male", "M")
build("female", "F")
