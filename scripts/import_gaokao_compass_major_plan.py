#!/usr/bin/env python3
"""Compatibility wrapper for the old slow GaokaoCompass major/plan importer.

The original row-by-row importer was replaced because real major notes and group
keys can exceed the old varchar(128) columns and row-by-row plan matching was too
slow. Use the batch importer instead.
"""
import os
import runpy
from pathlib import Path

here = Path(__file__).resolve().parent
fast = here / "import_gaokao_compass_major_plan_fast.py"
os.environ.setdefault("GAOKAO_IMPORT_PLANS", "1")
runpy.run_path(str(fast), run_name="__main__")
