"""Standalone TTS spawner. Called by jarvis.py: `python speak.py "<text>"`.

Uses pyttsx3 (offline, fast, no network). Fails silently if TTS isn't available
so the agent loop doesn't crash on a missing speaker.
"""

import sys


def main() -> int:
    text = sys.argv[1] if len(sys.argv) > 1 else ""
    if not text.strip():
        return 0
    try:
        import pyttsx3
    except Exception:
        # No TTS available — nothing to say. Don't take down the agent.
        return 0
    try:
        import re
        # Pronounce "Xova" as "Zova" — Adam's preferred pronunciation.
        spoken = re.sub(r"\bX(ova)\b", r"Z\1", text[:300])
        spoken = re.sub(r"\bx(ova)\b", r"z\1", spoken)
        engine = pyttsx3.init()
        engine.say(spoken)
        engine.runAndWait()
    except Exception:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
