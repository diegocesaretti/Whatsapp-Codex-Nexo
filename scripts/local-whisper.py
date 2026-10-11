import json
import os
import subprocess
import sys
import numpy as np
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        raise ValueError("audio_path_required")
    audio = sys.argv[1]
    ffmpeg = os.environ.get("NEXO_FFMPEG_PATH", r"C:\ffmpeg\bin\ffmpeg.exe")
    result = subprocess.run(
        [ffmpeg, "-nostdin", "-loglevel", "error", "-i", audio,
         "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
    samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768
    if not samples.size:
        raise ValueError("empty_audio")
    model_name = os.environ.get("NEXO_LOCAL_STT_MODEL", "small")
    model = WhisperModel(model_name, device="cpu", compute_type="int8",
                         cpu_threads=2, num_workers=1, local_files_only=True)
    segments, _ = model.transcribe(
        samples, language=os.environ.get("NEXO_LOCAL_STT_LANGUAGE") or "es",
        beam_size=1, vad_filter=False, without_timestamps=True,
        condition_on_previous_text=False)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise ValueError("empty_transcription")
    print(json.dumps({"text": text, "model": "faster-whisper/" + model_name,
                      "provider": "local", "device": "cpu"}, ensure_ascii=False),
          flush=True)

try:
    main()
except Exception as error:
    print("local_stt_failure: " + str(error), file=sys.stderr, flush=True)
    sys.exit(1)