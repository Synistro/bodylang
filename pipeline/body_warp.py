"""Moves anything from Z-Anatomy's frame into an Anny reference body. One warp: a skeleton-driven pass (joints found in
the source bones, limbs rotated and scaled segment by segment, the trunk matched slice by slice) followed by a smooth
displacement field that lands the source skin on the Anny skin. Whatever sat under the source skin therefore ends up
under the Anny skin. Every build script uses this, so all the anatomy stays in register with itself.
"""
import json
import re
from pathlib import Path

import fast_simplification
import numpy as np
import torch
import trimesh
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

from zanatomy import base_name

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets"
refs = np.load(ROOT / "pipeline/cache/reference_bodies.npz")
meta_body = json.loads((OUT / "body.json").read_text())
body_bin = (OUT / "body.bin").read_bytes()
JOINT_NAMES = [j["name"] for j in meta_body["joints"]]

INSIDE_MARGIN = 0.0015  # how far under the skin a pulled-in vertex ends up, metres
SKIN_CLEARANCE = 0.004  # the source skin lands this far under the Anny skin: a layer of soft tissue
CONTAIN_LIMIT = 0.012  # the furthest one round of the final pass may move anything, metres


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def unit(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


def vertex_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], n)
    return unit(N)


CARPAL_NAMES = "scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate"


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
        femur, tibia, humerus, radius, ulna = (load(n) for n in ("Femur", "Tibia", "Humerus", "Radius", "Ulna"))
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
METACARPAL_ORDER = ["first", "second", "third", "fourth", "fifth"]


def kabsch(a, b):
    """Rotation and uniform scale taking the point set `a` onto `b`, both relative to their origins."""
    U, S, Vt = np.linalg.svd(a.T @ b)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R, float((S[0] + S[1] + d * S[2]) / (a**2).sum())


class HandMap:
    def __init__(self, parts, ref, sk, side):
        self.wrist_s = sk.joint("wrist", side)
        self.wrist_t = ref.J[f"hand.{side}"]
        by = {p["name"].lower(): p for p in parts}
        self.ends = {}
        for name, p in by.items():
            self.ends[name] = long_axis_ends(p["source"], self.wrist_s)
        mc = lambda k: self.ends[f"{METACARPAL_ORDER[k]} metacarpal bone"]
        src = np.array([mc(1)[1], mc(2)[1], mc(3)[1], mc(4)[1]]) - self.wrist_s
        dst = np.array([ref.head(f"finger{k}-1.{side}") for k in (2, 3, 4, 5)]) - self.wrist_t
        self.R, self.s = kabsch(src, dst)
        self.ref, self.side = ref, side

    def across(self):
        """Direction across the knuckles, in source and target, for measuring forearm twist."""
        side, ref = self.side, self.ref
        a = self.ends["second metacarpal bone"][1] - self.ends["fifth metacarpal bone"][1]
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
            k = next(i for i, o in enumerate(METACARPAL_ORDER) if low.startswith(o))
            a, b = self.ends[low]
            if k == 0:  # the thumb's first Anny bone plays its metacarpal
                return self.place(P, a, b, ref.head(f"finger1-1.{side}"), ref.tail(f"finger1-1.{side}"))
            return self.place(P, a, b, wrist(a), ref.head(f"finger{k + 1}-1.{side}"))
        if "phalanx" in low:
            finger = next(i for i, o in enumerate(METACARPAL_ORDER) if f"{o} finger" in low)
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


class BodyFit:
    """One reference body and the warp into it, fitted from Z-Anatomy's limb bones and Regions-of-the-body patches."""

    def __init__(self, source, sex, fine, skeleton, skin, skin_faces, usable):
        self.ref = Reference(sex, fine)
        self.skeleton = skeleton
        self.hands = {side: HandMap(hand_bones(source, side), self.ref, skeleton, side) for side in "RL"}
        self.warp = SkeletonWarp(skeleton, self.ref, skin, self.hands)
        self.field = SkinField(self.warp(skin), skin_faces, self.ref, usable)

    def __call__(self, P):
        return self.field(self.warp(P))

    def inside_share(self, P, samples=1500):
        return float(winding_inside(P[:: max(1, len(P) // samples)], self.ref).mean())


HAND_BONE = re.compile(rf"({CARPAL_NAMES}|metacarpal bone|phalanx of \w+ finger of hand)", re.I)


def hand_bones(source, side):
    suffix = f".{side.lower()}"
    return [{"name": base_name(n), "source": source.mesh(n)[0]} for n in source.meshes_in("1:") if n.endswith(suffix) and HAND_BONE.search(n)]


def source_skeleton(source):
    return SourceSkeleton(lambda bone: source.mesh(f"{bone}.r")[0])


def source_skin(source):
    """Z-Anatomy has no skin mesh. Its Regions patches cover the whole surface, which is all the warp asks of one."""
    return source.merged(source.meshes_in("9:"))


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


def fit_bodies(source, cache):
    """Both reference bodies, in the order the assets list them."""
    skeleton = source_skeleton(source)
    skin, faces = source_skin(source)
    fine = load_fine_bones(Path(cache))
    usable = ~hand_skin(skin, skeleton)
    fits = {}
    for sex in ("male", "female"):
        print(sex)
        fits[sex] = BodyFit(source, sex, fine, skeleton, skin, faces, usable)
    return skeleton, fits
