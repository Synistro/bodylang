"""Exports the Anny parametric body for the browser.

Output: public/assets/body.bin + body.json holding, per sex, a reference shape
and additive deltas for weight, height and age, plus a collapsed skeleton with
per-shape joint positions. The browser mixes these on the CPU and skins on the GPU.
Anny's A-pose is rebaked to a relaxed stance first, so rotations at runtime start
from identity joints aligned with world axes.
"""
import json, sys, warnings
from pathlib import Path
import numpy as np, torch, trimesh, anny
from scipy import ndimage as ndi

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets"
CACHE = ROOT / "pipeline/cache"
CACHE.mkdir(exist_ok=True)

YOUNG, OLD = 2 / 3, 1.0
SEXES = {"male": 0.0, "female": 1.0}
BASE = dict(age=YOUNG, muscle=0.5, weight=0.5, height=0.5, proportions=0.5)
SHAPES = {  # delta name -> phenotype override
    "weight_up": dict(weight=1.0),
    "weight_down": dict(weight=0.0),
    "height_up": dict(height=0.75),
    "height_down": dict(height=0.25),
    "age_up": dict(age=OLD),
}

# Collapsed rig: every Anny bone feeds exactly one of these.
JOINTS = {
    "hips": (None, "root"),
    "spine": ("hips", "spine03"),
    "chest": ("spine", "spine01"),
    "neck": ("chest", "neck01"),
    "head": ("neck", "head"),
    "clavicle.L": ("chest", "clavicle.L"),
    "arm.L": ("clavicle.L", "upperarm01.L"),
    "forearm.L": ("arm.L", "lowerarm01.L"),
    "hand.L": ("forearm.L", "wrist.L"),
    "clavicle.R": ("chest", "clavicle.R"),
    "arm.R": ("clavicle.R", "upperarm01.R"),
    "forearm.R": ("arm.R", "lowerarm01.R"),
    "hand.R": ("forearm.R", "wrist.R"),
    "thigh.L": ("hips", "upperleg01.L"),
    "shin.L": ("thigh.L", "lowerleg01.L"),
    "foot.L": ("shin.L", "foot.L"),
    "thigh.R": ("hips", "upperleg01.R"),
    "shin.R": ("thigh.R", "lowerleg01.R"),
    "foot.R": ("shin.R", "foot.R"),
}
JOINT_NAMES = list(JOINTS)


def collapse_target(label: str) -> str:
    side = label.split(".")[-1] if label.endswith((".L", ".R")) else None
    if label == "root" or label.startswith(("pelvis", "spine05", "spine04")):
        return "hips"
    if label.startswith(("spine03", "spine02")):
        return "spine"
    if label.startswith(("spine01", "breast")):
        return "chest"
    if label.startswith(("clavicle", "shoulder")):
        return f"clavicle.{side}"
    if label.startswith("upperarm"):
        return f"arm.{side}"
    if label.startswith("lowerarm"):
        return f"forearm.{side}"
    if label.startswith(("wrist", "finger", "metacarpal")):
        return f"hand.{side}"
    if label.startswith("upperleg"):
        return f"thigh.{side}"
    if label.startswith("lowerleg"):
        return f"shin.{side}"
    if label.startswith(("foot", "toe")):
        return f"foot.{side}"
    if label.startswith(("neck01", "neck02")):
        return "neck"
    return "head"


model = anny.create_fullbody_model(triangulate_faces=True, remove_unattached_vertices=True)
labels = list(model.bone_labels)
parents = model.bone_parents.tolist() if hasattr(model.bone_parents, "tolist") else list(model.bone_parents)


def axis_angle(axis, degrees):
    return trimesh.transformations.rotation_matrix(np.radians(degrees), axis)[:3, :3]


# Relaxed stance, in Anny's Z-up frame facing -Y; L is +X.
STANCE = {
    "upperarm01.L": axis_angle([0, 1, 0], 37) ,
    "upperarm01.R": axis_angle([0, 1, 0], -37),
    "lowerarm01.L": axis_angle([1, 0, 0], -14),
    "lowerarm01.R": axis_angle([1, 0, 0], -14),
    "upperleg01.L": axis_angle([0, 1, 0], -4.5),
    "upperleg01.R": axis_angle([0, 1, 0], 4.5),
}


def stance_transforms(rest_poses):
    """World-axis stance rotations converted to Anny's local-bone deltas."""
    out = {}
    for name, world_rot in STANCE.items():
        b = rest_poses[labels.index(name)][:3, :3].numpy().astype(np.float64)
        d = np.eye(4)
        d[:3, :3] = b.T @ world_rot @ b
        out[name] = torch.tensor(d, dtype=torch.float32)[None]
    return out


def run(sex_value, **override):
    p = {**BASE, **override, "gender": sex_value}
    kw = {k: torch.tensor([float(v)], dtype=torch.float32) for k, v in p.items()}
    rest = model(phenotype_kwargs=kw, return_bone_ends=True)
    posed = model(
        pose_parameters=stance_transforms(rest["rest_bone_poses"][0]),
        phenotype_kwargs=kw,
        return_bone_ends=True,
    )
    v = posed["vertices"][0].detach().numpy().astype(np.float64)
    heads = posed["bone_heads"][0].detach().numpy().astype(np.float64)
    return v, heads


def to_y_up(a):
    return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1)


faces_all = model.faces.numpy()
probe_v, _ = run(0.0)
tm = trimesh.Trimesh(probe_v, faces_all, process=False)
components = trimesh.graph.connected_components(tm.edges, nodes=np.arange(len(probe_v)))
main = max(components, key=len)
keep = np.zeros(len(probe_v), bool)
keep[main] = True
remap = -np.ones(len(probe_v), int)
remap[keep] = np.arange(keep.sum())
faces = remap[faces_all[keep[faces_all].all(axis=1)]]
print("verts", keep.sum(), "faces", len(faces), "dropped components", [len(c) for c in components if len(c) != len(main)])

# Collapse skin weights.
vbi = model.vertex_bone_indices.numpy()
vbw = model.vertex_bone_weights.numpy()
n = len(probe_v)
collapsed = np.zeros((n, len(JOINT_NAMES)), np.float32)
target = np.array([JOINT_NAMES.index(collapse_target(l)) for l in labels])
for k in range(vbi.shape[1]):
    np.add.at(collapsed, (np.arange(n), target[vbi[:, k]]), vbw[:, k])
collapsed = collapsed[keep]
order = np.argsort(-collapsed, axis=1)[:, :4]
weights = np.take_along_axis(collapsed, order, axis=1)
weights /= weights.sum(axis=1, keepdims=True)
skin_i = order.astype(np.uint8)
skin_w = np.round(weights * 255).astype(np.uint8)
skin_w[:, 0] += (255 - skin_w.sum(axis=1)).astype(np.uint8)

# Which vertices belong to the insides of the eye sockets and the mouth, and the rims leading there.
# Those surfaces fold back into the head and would otherwise draw as rings and shapes on a contour.
OPENING_BONES = ("eye.", "orbicularis", "oculi", "tongue")
OPENING_SPREAD = 3
PROFILE_KEPT = {"from": 0.003, "to": 0.01}
INSIDE = dict(pitch=0.002, seal=4, from_depth=0.003, to_depth=0.007, neck_below_head=0.02, neck_margin=0.04)


def surface_points(v, tri, spacing):
    """Points on every triangle, no further apart than `spacing`: a voxel shell with gaps won't hold a flood fill."""
    corners = v[tri]
    longest = np.linalg.norm(corners - corners[:, [1, 2, 0]], axis=2).max(axis=1)
    steps = np.ceil(longest / spacing).astype(int)
    points = []
    for k in np.unique(steps):
        bary = np.array([(i, j, k - i - j) for i in range(k + 1) for j in range(k + 1 - i)]) / k
        points.append((corners[steps == k][:, None, :, :] * bary[None, :, :, None]).sum(axis=2).reshape(-1, 3))
    return np.concatenate(points)


def depth_inside_head(v, head):
    """How far each head vertex lies inside the outer surface, with the eyes and mouth sealed and the neck capped."""
    neck = v[head, 1].min() - INSIDE["neck_below_head"]
    tri = faces[(v[:, 1] > neck - INSIDE["neck_margin"])[faces].any(axis=1)]
    points = surface_points(v, tri, INSIDE["pitch"] / 2)
    lo = points.min(axis=0) - INSIDE["pitch"] * (INSIDE["seal"] + 2)
    dims = np.ceil((points.max(axis=0) - lo) / INSIDE["pitch"]).astype(int) + INSIDE["seal"] + 3
    grid = np.zeros(dims, bool)
    at = ((points - lo) / INSIDE["pitch"]).astype(int)
    grid[at[:, 0], at[:, 1], at[:, 2]] = True
    grid = ndi.binary_closing(grid, iterations=INSIDE["seal"])
    grid[:, int((neck - lo[1]) / INSIDE["pitch"]), :] = True
    depth = ndi.distance_transform_edt(ndi.binary_fill_holes(grid)) * INSIDE["pitch"]
    cells = np.clip(((v - lo) / INSIDE["pitch"]).astype(int), 0, dims - 1)
    return np.where(head, depth[cells[:, 0], cells[:, 1], cells[:, 2]], 0)


opening_of = np.array([l.startswith(OPENING_BONES) for l in labels])
opening = np.minimum(1, (opening_of[vbi] * vbw).sum(axis=1)[keep].astype(np.float32) * 2)
inside = depth_inside_head(to_y_up(probe_v)[keep], collapsed[:, JOINT_NAMES.index("head")] > 0.3)
inside = np.clip((inside - INSIDE["from_depth"]) / (INSIDE["to_depth"] - INSIDE["from_depth"]), 0, 1)
opening = np.maximum(opening, inside)
neighbours = trimesh.Trimesh(probe_v[keep], faces, process=False).vertex_neighbors
for _ in range(OPENING_SPREAD):
    opening = np.array([max(opening[i], 0.75 * max((opening[k] for k in near), default=0)) for i, near in enumerate(neighbours)])
# The midline stays, because in side view it is the profile.
midline = np.abs(to_y_up(probe_v)[keep][:, 0])
opening = np.maximum(inside, opening * np.clip((midline - PROFILE_KEPT["from"]) / (PROFILE_KEPT["to"] - PROFILE_KEPT["from"]), 0, 1))
print("opening vertices", int((opening > 0.5).sum()))

joint_src = [labels.index(JOINTS[j][1]) for j in JOINT_NAMES]
Q = 32767 / 2.5


def quant(a):
    q = np.round(a * Q)
    assert np.abs(q).max() <= 32767, np.abs(a).max()
    return q.astype(np.int16)


meta = {"sexes": {}, "joints": [{"name": j, "parent": JOINTS[j][0]} for j in JOINT_NAMES], "vertexCount": int(keep.sum()), "indexCount": int(faces.size), "quant": Q}
chunks = []
offset = 0


def add(arr):
    global offset
    b = arr.tobytes()
    pad = (-len(b)) % 4
    chunks.append(b + b"\0" * pad)
    start = offset
    offset += len(b) + pad
    return start


reference = {}
for sex, value in SEXES.items():
    v0, h0 = run(value)
    v0, h0 = to_y_up(v0)[keep], to_y_up(h0)[joint_src]
    ground = v0[:, 1].min()
    v0[:, 1] -= ground
    h0[:, 1] -= ground
    entry = {"base": add(quant(v0)), "joints": np.round(h0, 5).tolist(), "deltas": {}}
    reference[sex] = v0
    for name, override in SHAPES.items():
        vd, hd = run(value, **override)
        vd, hd = to_y_up(vd)[keep], to_y_up(hd)[joint_src]
        g = vd[:, 1].min()
        vd[:, 1] -= g
        hd[:, 1] -= g
        dv = vd - v0
        dh = hd - h0
        if name in ("height_up", "height_down"):  # stored per unit of the [0,1] height phenotype
            dv, dh = dv / 0.25, dh / 0.25
        entry["deltas"][name] = {"offset": add(quant(dv)), "joints": np.round(dh, 5).tolist()}
    meta["sexes"][sex] = entry
    print(sex, "height", round(float(v0[:, 1].max()), 3))

meta["skinIndex"] = add(skin_i)
meta["skinWeight"] = add(skin_w)
meta["index"] = add(faces.astype(np.uint16 if keep.sum() < 65536 else np.uint32))
meta["opening"] = add(np.round(opening * 255).astype(np.uint8))

(OUT / "body.bin").write_bytes(b"".join(chunks))
(OUT / "body.json").write_text(json.dumps(meta))
np.savez(CACHE / "reference_bodies.npz", faces=faces, **reference, **{f"joints_{s}": np.array(meta["sexes"][s]["joints"]) for s in SEXES})
print("body.bin", offset, "bytes")
