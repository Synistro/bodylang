"""Runs inside Blender. Writes every mesh and curve of Z-Anatomy's Startup.blend as the build scripts read them.

Output in the folder given after `--`: meshes.npz holds each mesh after its modifiers, and curves.json holds each
curve as a polyline with a radius at every point, plus the parent of every object. Everything is in world space.

Most right-side objects share their data with the left and are mirrored through delta_scale -1. That reverses a
mesh's winding and makes a curve's scale negative, so both are corrected here and nothing downstream has to know.
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

OUT = Path(sys.argv[sys.argv.index("--") + 1])
CURVE_SAMPLES = 12  # per Bezier segment
LEAST_FACES = 4  # the label pointers are one or two faces
# These are open tubes given a wall by a Solidify modifier. Without it, their open ends can be capped to give a solid.
WITHOUT_WALL = ("Ascending colon", "Transverse colon", "Descending colon", "Sigmoid colon")

collection_path = {}


def walk(collection, path):
    for child in collection.children:
        collection_path[child.name] = path + [child.name]
        walk(child, path + [child.name])


walk(bpy.context.scene.collection, [])
for name in WITHOUT_WALL:
    for modifier in bpy.data.objects[name].modifiers:
        if modifier.type == "SOLIDIFY":
            modifier.show_viewport = False
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()


def system_of(ob):
    if not ob.users_collection:
        return ""
    return collection_path.get(ob.users_collection[0].name, [""])[0]


arrays, mesh_rows = {}, []
for ob in bpy.data.objects:
    if ob.type != "MESH" or len(ob.data.polygons) < LEAST_FACES:
        continue
    evaluated = ob.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.index_update()
    matrix = evaluated.matrix_world
    vertices = np.array([matrix @ v.co for v in bm.verts], np.float32)
    faces = np.array([[v.index for v in f.verts] for f in bm.faces], np.int32)
    if matrix.determinant() < 0:
        faces = faces[:, ::-1]
    bm.free()
    evaluated.to_mesh_clear()
    i = len(mesh_rows)
    mesh_rows.append(ob.name)
    arrays[f"v{i}"], arrays[f"f{i}"] = vertices, faces
np.savez(OUT / "meshes.npz", **arrays)


def bezier_samples(spline, matrix):
    points, radii = [], []
    bp = spline.bezier_points
    for i in range(len(bp) if spline.use_cyclic_u else len(bp) - 1):
        a, b = bp[i], bp[(i + 1) % len(bp)]
        for k in range(CURVE_SAMPLES):
            t = k / CURVE_SAMPLES
            u = 1 - t
            point = u**3 * a.co + 3 * u * u * t * a.handle_right + 3 * u * t * t * b.handle_left + t**3 * b.co
            points.append(matrix @ point)
            radii.append(a.radius * u + b.radius * t)
    if not spline.use_cyclic_u:
        points.append(matrix @ bp[-1].co)
        radii.append(bp[-1].radius)
    return points, radii


curves = {}
for ob in bpy.data.objects:
    if ob.type != "CURVE":
        continue
    matrix = ob.matrix_world
    scale = sum(abs(s) for s in matrix.to_scale()) / 3
    splines = []
    for spline in ob.data.splines:
        if spline.type == "BEZIER":
            if len(spline.bezier_points) < 2:
                continue
            points, radii = bezier_samples(spline, matrix)
        else:
            points = [matrix @ p.co.to_3d() for p in spline.points]
            radii = [p.radius for p in spline.points]
        splines.append(
            {
                "points": [[round(x, 5) for x in p] for p in points],
                "radii": [round(abs(r) * ob.data.bevel_depth * scale, 6) for r in radii],
            }
        )
    curves[ob.name] = splines

(OUT / "curves.json").write_text(
    json.dumps(
        {
            "meshes": mesh_rows,
            "curves": curves,
            "parent": {ob.name: ob.parent.name for ob in bpy.data.objects if ob.parent},
            "system": {ob.name: system_of(ob) for ob in bpy.data.objects},
        }
    )
)
print(f"exported {len(mesh_rows)} meshes and {len(curves)} curves to {OUT}")
