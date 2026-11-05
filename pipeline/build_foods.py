#!/usr/bin/env python3
"""Builds server/foods.json from the USDA FoodData Central bulk CSV downloads.

Download and unpack these two public files, which need no account or key:
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip
  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip

Then run it with Python's isolated mode, because the folders hold downloaded data:
  python3 -I pipeline/build_foods.py <survey folder> <sr legacy folder> server/foods.json

Each row of the output is
  [fdc id, name, dataset, water g, carbs g, sugar g, fat g, protein g, fiber g, caffeine mg, alcohol g, [[portion, grams], ...]]
with every amount per 100 g. Carbs are total carbohydrate including fiber, as USDA reports them.
"""
import csv
import json
import sys
from pathlib import Path

# The survey file numbers nutrients by their old code, and SR Legacy by id, so each field has both.
FIELDS = {
    "water": {"1051", "255"},
    "carbs": {"1005", "205"},
    "sugar": {"2000", "269", "1063"},
    "fat": {"1004", "204"},
    "protein": {"1003", "203"},
    "fiber": {"1079", "291"},
    "caffeine": {"1057", "262"},
    "alcohol": {"1018", "221"},
}
FIELD_OF = {code: name for name, codes in FIELDS.items() for code in codes}
LEFT_OUT = ("babyfood", "infant formula", "usda commodity", "formulated bar, power", "baby toddler")
MOST_PORTIONS = 4
USELESS_PORTION = ("quantity not specified", "guideline amount")


def rows(path: Path):
    with path.open(newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def read_dataset(folder: Path, dataset: str):
    units = {r["id"]: r["name"] for r in rows(folder / "measure_unit.csv")}
    foods = {}
    for r in rows(folder / "food.csv"):
        name = r["description"].strip()
        if name and not any(word in name.lower() for word in LEFT_OUT):
            foods[r["fdc_id"]] = {"name": name, "dataset": dataset, "portions": [], **{field: 0.0 for field in FIELDS}}
    for r in rows(folder / "food_nutrient.csv"):
        food = foods.get(r["fdc_id"])
        field = FIELD_OF.get(r["nutrient_id"])
        if food is not None and field and r["amount"]:
            food[field] = float(r["amount"])
    for r in rows(folder / "food_portion.csv"):
        food = foods.get(r["fdc_id"])
        if food is None or not r["gram_weight"] or float(r["gram_weight"]) <= 0:
            continue
        label = r["portion_description"].strip()
        if not label:
            unit = units.get(r["measure_unit_id"], "")
            parts = [r["amount"].strip(), "" if unit == "undetermined" else unit, r["modifier"].strip()]
            label = " ".join(part for part in parts if part)
        if label and not any(word in label.lower() for word in USELESS_PORTION) and len(food["portions"]) < MOST_PORTIONS:
            food["portions"].append([label, round(float(r["gram_weight"]), 1)])
    return foods


def main(survey: str, legacy: str, out: str):
    table = []
    for folder, dataset in ((survey, "FNDDS"), (legacy, "SR Legacy")):
        for fdc_id, food in read_dataset(Path(folder), dataset).items():
            amounts = [round(food[field], 2) for field in FIELDS]
            table.append([int(fdc_id), food["name"], dataset, *amounts, food["portions"]])
    table.sort(key=lambda row: row[0])
    Path(out).write_text(json.dumps(table, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(table)} foods, {Path(out).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
