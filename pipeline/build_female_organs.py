"""The uterus, ovaries and tubes, the only anatomy Z-Anatomy doesn't have. They come from the HuBMAP female reference
organs (CC BY 4.0), moved into the female Anny body by matching torso slices of the HuBMAP skin to Anny's.

Usage: build_female_organs.py <cache folder>. Downloads the six files it reads.
"""
import json, struct, sys, urllib.request
from pathlib import Path
import numpy as np, trimesh, fast_simplification
from scipy import ndimage as ndi
from skimage import measure

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://hubmapconsortium.github.io/ccf-releases/v1.2/models"
OUT = ROOT / "public/assets"
refs = np.load(ROOT / "pipeline/cache/reference_bodies.npz")
meta_body = json.loads((OUT / "body.json").read_text())
body_bin = (OUT / "body.bin").read_bytes()
rng = np.random.default_rng(7)

ORGANS = {
    # name: (file, wrap pitch in metres, closing iterations, blur sigma, target triangles)
    "uterus": ("VH_F_Uterus.glb", 0.0018, 4, 1.3, 2600),
    "ovary_L": ("VH_F_Ovary_L.glb", 0.0012, 3, 1.0, 700),
    "ovary_R": ("VH_F_Ovary_R.glb", 0.0012, 3, 1.0, 700),
    "tube_L": ("VH_F_Fallopian_Tube_L.glb", 0.0012, 3, 0.8, 900),
    "tube_R": ("VH_F_Fallopian_Tube_R.glb", 0.0012, 3, 0.8, 900),
}
SKIN = "VH_F_Skin.glb"
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


def load_parts(path):
    """Every mesh in a file in world coordinates."""
    js, bin_ = read_glb(path)
    parts = []

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
            parts.append(((M @ np.c_[np.vstack(vs), np.ones(off)].T).T[:, :3], np.vstack(fs)))
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


def wrap(meshes, pitch, close, sigma, target):
    grid, lo = voxelize(meshes, pitch, close)
    labels, n = ndi.label(grid)
    if n > 1:
        grid = labels == (1 + int(np.argmax(ndi.sum(grid, labels, range(1, n + 1)))))
    V, F, _, _ = measure.marching_cubes(ndi.gaussian_filter(grid.astype(np.float32), sigma), 0.5)
    V, F = V * pitch + lo, F[:, ::-1].astype(np.int64)
    if len(F) > target:
        v, f = fast_simplification.simplify(V.astype(np.float32), F.astype(np.int32), target_count=target, agg=3)
        V, F = v.astype(float), f.astype(np.int64)
    return V, F


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


def torso_vertices(sex):
    """Reference-body vertices that belong to trunk and head, so arms don't widen the slices."""
    v = refs[sex]
    si = np.frombuffer(body_bin, np.uint8, meta_body["vertexCount"] * 4, meta_body["skinIndex"]).reshape(-1, 4)
    sw = np.frombuffer(body_bin, np.uint8, meta_body["vertexCount"] * 4, meta_body["skinWeight"]).reshape(-1, 4)
    names = [j["name"] for j in meta_body["joints"]]
    limb = np.array([n.startswith(("arm", "forearm", "hand", "clavicle")) for n in names])
    return v[(limb[si] * sw).sum(1) / 255 < 0.15]


def main():
    cache = Path(sys.argv[1])
    cache.mkdir(parents=True, exist_ok=True)
    for file in [SKIN, *(row[0] for row in ORGANS.values())]:
        if not (cache / file).exists():
            urllib.request.urlretrieve(f"{BASE}/{file}", cache / file)
    skin = np.vstack([V for V, _ in load_parts(cache / SKIN)])
    skin = skin[rng.choice(len(skin), 200000, replace=False)]
    warp = Warp(skin, torso_vertices("female"))
    out = {}
    for name, (file, pitch, close, sigma, target) in ORGANS.items():
        V, F = wrap(load_parts(cache / file), pitch, close, sigma, target)
        out[f"{name}_V"], out[f"{name}_F"] = warp(V), F
        print(f"  {name:8s} tris {len(F):5d} center {np.round(out[f'{name}_V'].mean(0), 3)}")
    np.savez(cache / "female_organs.npz", **out)


if __name__ == "__main__":
    main()
