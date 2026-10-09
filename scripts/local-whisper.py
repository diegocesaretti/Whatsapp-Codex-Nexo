import json
import os
import sys
import warnings

# stdout is a machine-readable result; diagnostics go to stderr.
warnings.filterwarnings("ignore")
_dll_handles = []
if sys.platform == "win32":
    # Keep NVIDIA DLLs scoped to this worker process. Large CUDA packages can
    # live on another disk without changing the host PATH or Python venv.
    _cuda_roots = [
        os.environ.get("NEXO_LOCAL_STT_CUDA_ROOT", r"D:\sol\nexo-stt-cuda"),
        os.path.join(sys.prefix, "Lib", "site-packages"),
    ]
    for _root in _cuda_roots:
        for _name in ("cublas", "cudnn", "cuda_nvrtc"):
            _dir = os.path.join(_root, "nvidia", _name, "bin")
            if os.path.isdir(_dir):
                os.environ["PATH"] = _dir + os.pathsep + os.environ.get("PATH", "")
                _dll_handles.append(os.add_dll_directory(_dir))

try:
    from faster_whisper import WhisperModel
    import subprocess
    import numpy as np

    audio_path = sys.argv[1]
    model_name = os.environ.get("NEXO_LOCAL_STT_MODEL", "small")
    language = os.environ.get("NEXO_LOCAL_STT_LANGUAGE", "es")
    requested_device = os.environ.get("NEXO_LOCAL_STT_DEVICE", "auto").lower()

    # Use FFmpeg: installed PyAV 19 no longer supports metadata_errors.
    ffmpeg = os.environ.get("NEXO_FFMPEG_PATH", r"C:\ffmpeg\bin\ffmpeg.exe")
    decoded = subprocess.run(
        [ffmpeg, "-nostdin", "-loglevel", "error", "-i", audio_path,
         "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40, check=True,
    )
    samples = np.frombuffer(decoded.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        raise RuntimeError("local_whisper_empty_audio")

    def recognize(device, compute_type):
        model = WhisperModel(model_name, device=device, compute_type=compute_type,
                             cpu_threads=4, num_workers=1)
        segments, _ = model.transcribe(samples, language=language, beam_size=5,
                                        vad_filter=True)
        # Segment decoding is lazy; realize it inside try to catch CUDA errors.
        result = " ".join(seg.text.strip() for seg in segments).strip()
        if not result:
            raise RuntimeError("local_whisper_empty_transcription")
        return result

    if requested_device in ("auto", "cuda"):
        try:
            transcript = recognize("cuda", "int8_float16")
            device = "cuda"
        except Exception as gpu_error:
            print("local-whisper CUDA unavailable, switching to CPU: " + str(gpu_error),
                  file=sys.stderr, flush=True)
            transcript = recognize("cpu", "int8")
            device = "cpu"
    else:
        transcript = recognize("cpu", "int8")
        device = "cpu"

    print(json.dumps({"text": transcript, "model": "faster-whisper/" + model_name,
                      "provider": "local", "device": device}, ensure_ascii=False),
          flush=True)
except Exception as exc:
    import traceback
    traceback.print_exc(file=sys.stderr)
    print("local-whisper error: " + str(exc), file=sys.stderr, flush=True)
    sys.exit(1)
