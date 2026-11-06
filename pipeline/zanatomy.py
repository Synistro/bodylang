"""Reads what export_zanatomy.py wrote, in the frame the bodies use: metres, y up, the front is +z, the person's left is +x."""
import json
import re
from pathlib import Path

import numpy as np

SIDE_SUFFIX = re.compile(r"\.(l|r)$")


def to_body_frame(v):
    return np.c_[v[:, 0], v[:, 2], -v[:, 1]].astype(float)


class ZAnatomy:
    def __init__(self, folder):
        folder = Path(folder)
        index = json.loads((folder / "curves.json").read_text())
        self.arrays = np.load(folder / "meshes.npz")
        self.row = {name: i for i, name in enumerate(index["meshes"])}
        self.curves = index["curves"]
        self.parent = index["parent"]
        self.system = index["system"]

    def has(self, name):
        return name in self.row

    def mesh(self, name):
        i = self.row[name]
        return to_body_frame(self.arrays[f"v{i}"]), self.arrays[f"f{i}"].astype(np.int64)

    def meshes_in(self, system):
        """Names of the meshes in a top-level collection, such as the one starting "4:"."""
        return [name for name in self.row if self.system.get(name, "").startswith(system)]

    def curves_in(self, system):
        return [name for name in self.curves if self.system.get(name, "").startswith(system)]

    def splines(self, name):
        return [(to_body_frame(np.array(s["points"])), np.array(s["radii"])) for s in self.curves[name]]

    def main_spline(self, name):
        def length(entry):
            return float(np.linalg.norm(np.diff(entry[0], axis=0), axis=1).sum())

        return max(self.splines(name), key=length)

    def ancestors(self, name):
        chain = []
        while name in self.parent:
            name = self.parent[name]
            chain.append(name)
        return chain

    def merged(self, names):
        vs, fs, offset = [], [], 0
        for name in names:
            v, f = self.mesh(name)
            vs.append(v)
            fs.append(f + offset)
            offset += len(v)
        return np.vstack(vs), np.vstack(fs)


def base_name(name):
    """The name without its side, parentheses or a trailing "muscle"."""
    name = SIDE_SUFFIX.sub("", name).strip("() ")
    return re.sub(r"\s+muscles?$", "", name)


def side_of(name, mean_x):
    match = SIDE_SUFFIX.search(name)
    if match:
        return match.group(1).upper()
    return "M" if abs(mean_x) < 0.012 else ("L" if mean_x > 0 else "R")
