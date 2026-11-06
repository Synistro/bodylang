# Where these meshes come from

`muscles.*` and `organs-*.*` are adapted from Z-Anatomy, so they are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). If you reuse them, credit the sources below and share what you make from them under the same licence. The app's code doesn't fall under this licence because it loads these files.

- **Z-Anatomy**, the libre 3D atlas of anatomy, CC BY-SA 4.0, [Models-of-human-anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) at commit `bb293be`. Gauthier Kervyn and contributors.
- **BodyParts3D**, © The Database Center for Life Science, which Z-Anatomy is derived from. Its [licence page](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) now says CC BY 4.0.
- **Uterus, ovaries and tubes:** [HuBMAP CCF 3D Reference Object Library](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html) v1.2, built from the NLM Visible Human data, CC BY 4.0.
- **`body.*`:** [Anny](https://github.com/naver/anny) by NAVER Labs Europe, Apache 2.0, with MakeHuman data, CC0.

All of the above were rewrapped, decimated and warped onto the Anny bodies by `pipeline/`.

Z-Anatomy also lists models it used as a reference or adapted under other terms, without saying which meshes they became, including "Kidney" by Lissie Cowley (CC BY-NC 4.0) and "Anatomy of the Inner Ear" from the University of Dundee (CC BY-NC-SA 4.0). No ear is included here. Treat the kidney meshes as possibly non-commercial until that is settled.
