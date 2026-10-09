import json
import os
import sys
import warnings

# stdout is a machine-readable result; decoder/network diagnostics go to stderr.
warnings.filterwarnings("ignore")
try:
    from faster_whisper import WhisperModel
    audio_path = sys.argv[1]
    model_name = os.environ.get("NEXO_LOCAL_STT_MODEL", "tiny")
    language = os.environ.get("NEXO_LOCAL_STT_LANGUAGE", "es")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    # Decode with FFmpeg rather than PyAV: PyAV 19 dropped metadata_errors support.
    import subprocess
    import numpy as np
    ffmpeg = os.environ.get("NEXO_FFMPEG_PATH", r"C:\ffmpeg\bin\ffmpeg.exe")
    decoded = subprocess.run([ffmpeg, "-nostdin", "-loglevel", "error", "-i", audio_path,
        "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40, check=True)
    samples = np.frombuffer(decoded.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        raise RuntimeError("local_whisper_empty_audio")
    segments, info = model.transcribe(samples, language=language, beam_size=5, vad_filter=True)
    transcript = " ".join(seg.text.strip() for seg in segments).strip()
    if not transcript:
        raise RuntimeError("local_whisper_empty_transcription")
    print(json.dumps({"text":transcript,"model":"faster-whisper/"+model_name,"provider":"local"}, ensure_ascii=False), flush=True)
except Exception as exc:
    import traceback
    traceback.print_exc(file=sys.stderr)
    print("local-whisper error: "+str(exc), file=sys.stderr, flush=True)
    sys.exit(1)
