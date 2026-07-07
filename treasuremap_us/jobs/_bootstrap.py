"""Path bootstrap so jobs run as plain scripts: `python jobs/<job>.py`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
