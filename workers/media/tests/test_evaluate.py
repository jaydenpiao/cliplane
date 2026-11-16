import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate import evaluate


class EvaluationTests(unittest.TestCase):
    def test_precision_duplicates_latency_and_boundary_overlap(self):
        report = evaluate(
            {
                "sourceSeconds": 3600,
                "processingSeconds": 900,
                "costUsd": 1.5,
                "candidates": [
                    {"startMs": 0, "endMs": 10000},
                    {"startMs": 1000, "endMs": 11000},
                    {"startMs": 50000, "endMs": 60000},
                ],
                "accepted": [{"startMs": 0, "endMs": 10000}],
            },
            k=3,
        )
        self.assertAlmostEqual(report["precisionAtK"], 2 / 3)
        self.assertEqual(report["acceptedAtK"], 1)
        self.assertAlmostEqual(report["duplicateRate"], 1 / 3)
        self.assertEqual(report["processingRatio"], 0.25)
        self.assertEqual(report["costPerSourceHourUsd"], 1.5)

    def test_unlabelled_data_does_not_claim_precision(self):
        report = evaluate(
            {"sourceSeconds": 60, "processingSeconds": 5, "costUsd": 0, "candidates": [], "accepted": None}
        )
        self.assertIsNone(report["precisionAtK"])


if __name__ == "__main__":
    unittest.main()
