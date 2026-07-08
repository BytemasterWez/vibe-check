"""CSV replay adapter — replays recorded/synthetic data from data/mock/*.csv.

Expected CSV columns (long format):
  t_seconds,sensor_type,metric,value,unit,quality_score
Rows sharing (t_seconds, sensor_type) are grouped into one sample envelope.
"""
import csv
from pathlib import Path

from .base_adapter import BaseSensorAdapter


class CsvReplayAdapter(BaseSensorAdapter):
    adapter_name = "csv_replay_adapter"
    sensor_type = "csv_replay"

    def __init__(self, csv_path: str) -> None:
        super().__init__()
        self.csv_path = Path(csv_path)
        self._samples: list[dict] = []
        self._index = 0

    def connect(self) -> bool:
        if not self.csv_path.exists():
            self.connected = False
            return False
        grouped: dict[tuple[float, str], dict] = {}
        with open(self.csv_path, newline="") as f:
            for row in csv.DictReader(f):
                key = (float(row["t_seconds"]), row["sensor_type"])
                entry = grouped.setdefault(
                    key, {"metrics": {}, "quality": [], "units": {}}
                )
                entry["metrics"][row["metric"]] = float(row["value"])
                if row.get("unit"):
                    entry["units"][row["metric"]] = row["unit"]
                if row.get("quality_score"):
                    entry["quality"].append(float(row["quality_score"]))
        self._samples = []
        for (t, sensor_type), entry in sorted(grouped.items(), key=lambda kv: kv[0][0]):
            quality = sum(entry["quality"]) / len(entry["quality"]) if entry["quality"] else 0.5
            self._samples.append(
                self.envelope(
                    sensor_type,
                    entry["metrics"],
                    quality_score=quality,
                    status="good" if quality >= 0.8 else "fair",
                    raw_payload={
                        "replay_file": self.csv_path.name,
                        "t_seconds": t,
                        "units": entry["units"],
                        "simulated": True,
                    },
                )
            )
        self._index = 0
        self.connected = True
        return True

    def read_sample(self) -> dict:
        if not self.connected:
            raise RuntimeError("CsvReplayAdapter not connected")
        if self._index >= len(self._samples):
            raise StopIteration("Replay finished")
        sample = self._samples[self._index]
        self._index += 1
        return sample

    def finished(self) -> bool:
        return self._index >= len(self._samples)

    def health_check(self) -> dict:
        info = super().health_check()
        info.update(
            {
                "file": str(self.csv_path),
                "total_samples": len(self._samples),
                "position": self._index,
            }
        )
        return info
