"""Offline evaluation over human-labelled windows; no model or network access."""

import json
import sys
from pathlib import Path


def iou(a: dict, b: dict) -> float:
    intersection = max(0, min(a["endMs"], b["endMs"]) - max(a["startMs"], b["startMs"]))
    union = max(a["endMs"], b["endMs"]) - min(a["startMs"], b["startMs"])
    return intersection / union if union > 0 else 0


def evaluate(data: dict, k: int = 5) -> dict:
    candidates = data["candidates"][:k]
    accepted = data.get("accepted")
    hours = data["sourceSeconds"] / 3600
    matches = [max((iou(c, a) for a in accepted or []), default=0) for c in candidates]
    duplicates = sum(
        any(iou(c, previous) > 0.3 for previous in candidates[:index]) for index, c in enumerate(candidates)
    )
    return {
        "k": k,
        "precisionAtK": sum(v >= 0.5 for v in matches) / len(candidates)
        if candidates and accepted is not None
        else None,
        "acceptedAtK": int(any(v >= 0.5 for v in matches)) if accepted is not None else None,
        "boundaryIoU": sum(matches) / len(matches) if matches and accepted is not None else None,
        "duplicateRate": duplicates / len(candidates) if candidates else 0,
        "candidatesPerSourceHour": len(data["candidates"]) / hours if hours else 0,
        "processingRatio": data["processingSeconds"] / data["sourceSeconds"] if hours else None,
        "costPerSourceHourUsd": data.get("costUsd", 0) / hours if hours else None,
        "labelled": accepted is not None,
    }


if __name__ == "__main__":
    print(json.dumps(evaluate(json.loads(Path(sys.argv[1]).read_text())), indent=2))
