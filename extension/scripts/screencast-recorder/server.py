"""Voice-over recorder for the screencast.

Serves a page that records each sentence of voice-over.json, shows the time each one has, and mixes
the recordings into screencast-voiced.mp4. Run: python3 scripts/screencast-recorder/server.py, then open
http://localhost:8765. Everything it reads and writes lives in reports/screencast/.

voice-over.json comes from the screen recording (npm run screencast:docs): each sentence starts at the
action it describes, and the recording waited for the takes in voice/ that existed at the time.
"""
import json
import re
import subprocess
import sys
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
SCREENCAST = HERE.parent.parent / "reports" / "screencast"
VOICE = SCREENCAST / "voice"
VIDEO = SCREENCAST / "screencast.mp4"
OUTPUT = SCREENCAST / "screencast-voiced.mp4"
PORT = 8765

# The Space press that starts a take lands in its first 170 ms; nobody starts speaking that fast (the
# earliest of the first 57 takes began after 380 ms), so that much is cut before anything else.
KEY_CLICK_S = 0.25

# Must match SENTENCE_GAP_MS and SCENE_TAIL_MS in screencast.shots.ts: the silence the screen
# recording leaves after each sentence and after a scene's last one.
GAP, TAIL = 0.25, 0.8


def duration(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    try:
        return float(out)
    except ValueError:
        return 0.0


def peak_db(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    match = re.search(r"max_volume: (-?[\d.]+) dB", out)
    return float(match.group(1)) if match else -91.0


def recording(scene, sentence):
    return VOICE / f"scene{scene:02d}-{sentence:02d}.wav"


def load_script():
    """Scenes from voice-over.json; a sentence's budget is the time until the next one starts."""
    scenes = json.loads((SCREENCAST / "voice-over.json").read_text())
    for scene in scenes:
        sentences = scene["sentences"]
        for index, sentence in enumerate(sentences):
            until = sentences[index + 1]["start"] - GAP if index + 1 < len(sentences) else scene["end"] - TAIL
            seconds = duration(recording(scene["id"], index)) if recording(scene["id"], index).exists() else 0.0
            sentence["budget"] = round(until - sentence["start"], 2)
            sentence["recorded"] = round(seconds, 2) if seconds > 0 else None
        scene["room"] = round(sum(s["budget"] for s in sentences), 2)
    return scenes


def convert(source, target, filters):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-af", filters,
                    "-ac", "1", "-ar", "48000", str(target)], check=True)


def process(raw, target):
    """Turns an upload into the take at `target`: key click cut, silence trimmed at both ends,
    brought to a fixed peak. Returns the peak in dB, or None (and leaves `target` alone) without signal.
    """
    clipped = target.with_suffix(".clipped.wav")
    convert(raw, clipped, f"atrim=start={KEY_CLICK_S},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,highpass=f=70")
    peak = peak_db(clipped)
    if peak < -60:
        clipped.unlink()
        return None
    # Silence is judged against this take's own peak, so a quiet microphone is not cut away entirely.
    trim = f"silenceremove=start_periods=1:start_threshold={peak - 35:.0f}dB:start_silence=0.1"
    level = f"volume={-3 - peak:.1f}dB"
    staged = target.with_suffix(".staged.wav")
    convert(clipped, staged, f"{trim},areverse,{trim},areverse,{level}")
    if duration(staged) < 0.3:
        convert(clipped, staged, level)
    clipped.unlink()
    staged.replace(target)
    return peak


def save_recording(scene, sentence, body, content_type):
    """Stores the browser's recording as a take. Every upload is kept in voice/raw, and a take
    without signal never replaces an existing one."""
    raw_dir = VOICE / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    extension = ".mp4" if "mp4" in content_type else ".ogg" if "ogg" in content_type else ".webm"
    raw = raw_dir / f"scene{scene:02d}-{sentence:02d}-{int(time.time() * 1000)}{extension}"
    raw.write_bytes(body)
    peak = process(raw, recording(scene, sentence))
    if peak is None:
        return {"error": "No sound in this take. Check the microphone; the previous take is kept."}
    return {"recorded": round(duration(recording(scene, sentence)), 2), "peak": round(peak, 1)}


def reprocess():
    """Rebuilds every take from its newest upload, after a change to `process`."""
    newest = {}
    for raw in sorted((VOICE / "raw").iterdir()):
        newest[raw.name.rsplit("-", 1)[0]] = raw
    for key, raw in sorted(newest.items()):
        scene, sentence = (int(part[-2:]) for part in key.split("-"))
        peak = process(raw, recording(scene, sentence))
        print(f"{key}: {'no signal' if peak is None else f'{duration(recording(scene, sentence)):.2f}s'}")


def build_video():
    """Lays each take on the moment its sentence starts in the video; the picture stays as it is."""
    scenes = load_script()
    takes = [(scene, index, sentence) for scene in scenes for index, sentence in enumerate(scene["sentences"])]
    missing = [f"{scene['id']}.{index + 1}" for scene, index, sentence in takes if sentence["recorded"] is None]
    if missing:
        return {"ok": False, "error": "Not recorded yet: " + ", ".join(missing)}

    inputs, audio = [], []
    for scene, index, sentence in takes:
        inputs += ["-i", str(recording(scene["id"], index))]
        audio.append(f"[{len(audio) + 1}:a]adelay={int(sentence['start'] * 1000)}:all=1[a{len(audio)}]")
    graph = ";".join(audio + [
        "".join(f"[a{i}]" for i in range(len(audio))) + f"amix=inputs={len(audio)}:normalize=0,loudnorm=I=-16:TP=-1.5[aout]",
    ])
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(VIDEO), *inputs,
        "-filter_complex", graph, "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(OUTPUT),
    ], capture_output=True, text=True)
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr[-2000:]}
    subprocess.run(["open", "-a", "QuickTime Player", str(OUTPUT)])
    # A take recorded after the screen recording can run into the next sentence.
    overlaps = [f"{scene['id']}.{index + 1} +{sentence['recorded'] - sentence['budget']:.1f}s"
                for scene, index, sentence in takes if sentence["recorded"] > sentence["budget"]]
    return {"ok": True, "path": str(OUTPUT), "length": round(duration(OUTPUT), 1), "overlaps": overlaps}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/script":
            return self.send_json(load_script())
        if url.path == "/api/audio":
            query = parse_qs(url.query)
            path = recording(int(query["scene"][0]), int(query["sentence"][0]))
            if not path.exists():
                return self.send_error(404)
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return None
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/record":
            query = parse_qs(url.query)
            body = self.rfile.read(int(self.headers["Content-Length"]))
            return self.send_json(save_recording(int(query["scene"][0]), int(query["sentence"][0]), body, self.headers.get("Content-Type", "")))
        if url.path == "/api/build":
            return self.send_json(build_video())
        return self.send_error(404)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    if "--reprocess" in sys.argv:
        reprocess()
        sys.exit()
    print(f"Voice-over recorder on http://localhost:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
