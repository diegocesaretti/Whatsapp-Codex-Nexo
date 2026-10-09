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
    segments, info = model.transcribe(audio_path, language=language, beam_size=5, vad_filter=True)
    transcript = " ".join(seg.text.strip() for seg in segments).strip()
    if not transcript:
        raise RuntimeError("local_whisper_empty_transcription")
    print(json.dumps({"text":transcript,"model":"faster-whisper/"+model_name,"provider":"local"}, ensure_ascii=False), flush=True)
except Exception as exc:
    print("local-whisper error: "+str(exc), file=sys.stderr, flush=True)
    sys.exit(1)
