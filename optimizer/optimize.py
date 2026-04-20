"""
Hindi Translator Optimizer - Autonomous Loop Runner.

Pattern: modify system prompt -> translate test samples -> evaluate -> keep/discard -> repeat.

Usage:
    python optimizer/optimize.py --baseline       # Establish baseline scores
    python optimizer/optimize.py --experiment "desc"  # Run single experiment
    python optimizer/optimize.py --summary        # Show results
"""

import argparse
import csv
import json
import os
import sys
import time
import hashlib
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
OPTIMIZER_DIR = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(OPTIMIZER_DIR))

from config import (
    RESULTS_DIR, RESULTS_TSV, TRANSLATOR_JS,
    TEST_SCENARIOS, METRIC_WEIGHTS,
    MINIMUM_QUALITY_SCORE, IMPROVEMENT_THRESHOLD,
)
from evaluate import run_eval, get_current_system_prompt, evaluate_translation

# ---------------------------------------------------------------------------
# Results Tracking
# ---------------------------------------------------------------------------
TSV_HEADERS = [
    "timestamp", "experiment_id", "scenario", "composite_score",
    "glossary_compliance", "completeness", "format_preservation",
    "hindi_quality", "no_transliteration", "exam_tag_preservation",
    "latency_score", "elapsed_seconds", "status", "description",
]


def init_results():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    if not RESULTS_TSV.exists():
        with open(RESULTS_TSV, "w", newline="", encoding="utf-8") as f:
            csv.writer(f, delimiter="\t").writerow(TSV_HEADERS)


def log_result(exp_id, scenario, metrics, elapsed, status, description):
    init_results()
    row = [
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        exp_id, scenario,
        f"{metrics.get('composite_score', 0):.4f}",
        f"{metrics.get('glossary_compliance', 0):.3f}",
        f"{metrics.get('completeness', 0):.3f}",
        f"{metrics.get('format_preservation', 0):.3f}",
        f"{metrics.get('hindi_quality', 0):.3f}",
        f"{metrics.get('no_transliteration', 0):.3f}",
        f"{metrics.get('exam_tag_preservation', 0):.3f}",
        f"{metrics.get('latency_score', 0):.3f}",
        f"{elapsed:.1f}", status, description,
    ]
    with open(RESULTS_TSV, "a", newline="", encoding="utf-8") as f:
        csv.writer(f, delimiter="\t").writerow(row)


def get_exp_id():
    return hashlib.md5(str(time.time()).encode()).hexdigest()[:8]


# ---------------------------------------------------------------------------
# Baseline
# ---------------------------------------------------------------------------
def run_baseline():
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")

    print("=" * 60)
    print("HINDI TRANSLATOR BASELINE EVALUATION")
    print("=" * 60)

    prompt = get_current_system_prompt()
    scores = {}

    for scenario in TEST_SCENARIOS:
        result = run_eval(scenario, prompt)
        log_result(
            f"baseline_{scenario['name']}", scenario["name"],
            result["metrics"], result["elapsed_seconds"],
            "baseline", "Initial baseline with current translator.js prompt",
        )
        scores[scenario["name"]] = result["metrics"]["composite_score"]

        # Print sample translations (handle Windows encoding)
        if result["translations"]:
            print(f"\n  Sample translation:")
            for i, (orig, trans) in enumerate(zip(scenario["paragraphs"][:2], result["translations"][:2])):
                try:
                    print(f"    EN: {orig[:80]}")
                    print(f"    HI: {trans[:80]}")
                except UnicodeEncodeError:
                    print(f"    EN: {orig[:80]}")
                    print(f"    HI: [Hindi text - {len(trans)} chars]")
        print()

    print("\n" + "=" * 60)
    print("BASELINE SUMMARY")
    print("=" * 60)
    for name, score in scores.items():
        print(f"  {name}: {score:.4f}")
    avg = sum(scores.values()) / len(scores) if scores else 0
    print(f"  AVERAGE: {avg:.4f}")

    with open(RESULTS_DIR / "baseline.json", "w", encoding="utf-8") as f:
        json.dump({"scores": scores, "average": avg, "timestamp": datetime.now().isoformat()}, f, indent=2)

    return scores


# ---------------------------------------------------------------------------
# Experiment
# ---------------------------------------------------------------------------
def run_experiment(description, scenario_name=None):
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")

    scenario_name = scenario_name or TEST_SCENARIOS[0]["name"]
    scenario = next((s for s in TEST_SCENARIOS if s["name"] == scenario_name), None)
    if not scenario:
        raise ValueError(f"Unknown scenario: {scenario_name}")

    exp_id = get_exp_id()
    print(f"\n{'='*60}")
    print(f"EXPERIMENT: {exp_id} - {description}")
    print(f"Scenario: {scenario_name}")
    print(f"{'='*60}")

    prompt = get_current_system_prompt()
    result = run_eval(scenario, prompt)
    score = result["metrics"]["composite_score"]

    baseline_file = RESULTS_DIR / "baseline.json"
    baseline_score = 0.0
    if baseline_file.exists():
        bl = json.loads(baseline_file.read_text())
        baseline_score = bl.get("scores", {}).get(scenario_name, 0.0)

    delta = score - baseline_score
    status = "keep" if delta > IMPROVEMENT_THRESHOLD else "discard"
    if score < MINIMUM_QUALITY_SCORE:
        status = "crash"

    log_result(exp_id, scenario_name, result["metrics"], result["elapsed_seconds"], status, description)

    print(f"\n  Score: {score:.4f} (baseline: {baseline_score:.4f}, delta: {delta:+.4f})")
    print(f"  Status: {status.upper()}")

    return {"experiment_id": exp_id, "score": score, "delta": delta, "status": status}


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
def print_summary():
    if not RESULTS_TSV.exists():
        print("No results. Run --baseline first.")
        return

    with open(RESULTS_TSV, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))

    if not rows:
        return

    print(f"\n{'='*60}")
    print(f"HINDI TRANSLATOR OPTIMIZATION - {len(rows)} experiments")
    print(f"{'='*60}")

    scores = [float(r["composite_score"]) for r in rows if r.get("composite_score")]
    keeps = [r for r in rows if r.get("status") == "keep"]
    baselines = [r for r in rows if r.get("status") == "baseline"]

    print(f"\n  Total: {len(rows)} | Baselines: {len(baselines)} | Kept: {len(keeps)}")
    if scores:
        print(f"  Best: {max(scores):.4f} | Worst: {min(scores):.4f} | Avg: {sum(scores)/len(scores):.4f}")

    if keeps:
        print(f"\n  Top improvements:")
        for r in sorted(keeps, key=lambda x: float(x["composite_score"]), reverse=True)[:5]:
            print(f"    [{r['experiment_id']}] {float(r['composite_score']):.4f} - {r['description'][:50]}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Hindi Translator Optimizer")
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--experiment", type=str)
    parser.add_argument("--scenario", type=str)
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
    init_results()

    if args.baseline:
        run_baseline()
    elif args.experiment:
        run_experiment(args.experiment, args.scenario)
    elif args.summary:
        print_summary()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
