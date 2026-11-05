#!/bin/sh
# Downloads the HuBMAP reference organs that build_organs.py reads. Usage: fetch_organs.sh <empty folder>
set -eu
out="$1"
mkdir -p "$out"
base=https://hubmapconsortium.github.io/ccf-releases/v1.2/models
for sex in M F; do
  for organ in Heart Liver Lung Kidney_L Kidney_R Pancreas Spleen Small_Intestine Blood_Vasculature Urinary_Bladder Spinal_Cord Skin Thymus; do
    curl -sSf -o "$out/VH_${sex}_${organ}.glb" "$base/VH_${sex}_${organ}.glb"
  done
  curl -sSf -o "$out/SBU_${sex}_Intestine_Large.glb" "$base/SBU_${sex}_Intestine_Large.glb"
  curl -sSf -o "$out/Allen_${sex}_Brain.glb" "$base/Allen_${sex}_Brain.glb"
done
for organ in Uterus Ovary_L Ovary_R Fallopian_Tube_L Fallopian_Tube_R; do
  curl -sSf -o "$out/VH_F_${organ}.glb" "$base/VH_F_${organ}.glb"
done
curl -sSf -o "$out/VH_M_Prostate.glb" "$base/VH_M_Prostate.glb"
