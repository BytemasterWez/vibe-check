"""Score all counties for a recipe using its event's latest experiment model,
persist to score.*, and export the evidence-backed scorecard CSV.

    python -m scripts.run_scoring --recipe labour_shock_monitor
"""

from __future__ import annotations

import argparse
from datetime import date

import pandas as pd

from engine.config import EXPORTS_DIR
from engine.contracts import load_event_contracts, load_recipe_contracts
from engine.db import get_engine
from engine.events.engine import build_case_control_set, detect_occurrences
from engine.experiments.engine import run_experiment
from engine.exports.csv_export import export_scorecard_csv
from engine.features.engine import matrix_as_of
from engine.orchestration import (
    county_names,
    latest_feature_run_id,
    load_feature_matrix,
    load_observations,
    persist_experiment,
    persist_scores,
)
from engine.scoring.engine import score_counties


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--feature-run", type=int, default=None)
    args = parser.parse_args()

    recipes = load_recipe_contracts()
    if args.recipe not in recipes:
        raise SystemExit(f"no recipe contract '{args.recipe}' under contracts/recipes/")
    recipe = recipes[args.recipe]
    event = load_event_contracts()[recipe.event_id]

    with get_engine().begin() as conn:
        run_id = args.feature_run or latest_feature_run_id(conn)
        matrix = load_feature_matrix(conn, run_id)
        observations = load_observations(conn, scoring_only=True)

        # Train (or retrain) on the event's case/control set. Recipes reuse
        # the experiment machinery — nothing recipe-specific in the engine.
        occurrences = detect_occurrences(event, matrix, observations)
        case_control = build_case_control_set(event, occurrences, matrix)
        result = run_experiment(event, case_control, matrix)
        experiment_id, model_id = persist_experiment(conn, result, run_id)

        latest_period = pd.to_datetime(matrix["period"]).max()
        latest = matrix_as_of(matrix, latest_period)
        scores = score_counties(
            recipe, result.best_model, latest,
            period=str(latest_period.date()),
            model_version=f"exp{experiment_id}-{result.best_model.model_type}",
        )
        score_version_id = persist_scores(conn, recipe, experiment_id, model_id,
                                          result.best_model, scores)
        names = county_names(conn)

    out = EXPORTS_DIR / f"{recipe.recipe_id}_scorecard_{date.today().isoformat()}.csv"
    export_scorecard_csv(scores, out, county_names=names)
    print(f"recipe={recipe.recipe_id} score_version={score_version_id} "
          f"counties_scored={len(scores)} scorecard={out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
