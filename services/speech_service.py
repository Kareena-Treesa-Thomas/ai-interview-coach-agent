"""
Azure AI Speech — speech-to-text for capturing answers, text-to-speech
for reading questions aloud.

STT uses continuous recognition rather than recognize_once(): recognize_once
stops at the FIRST detected pause, silently truncating any answer with a
natural breath or thinking-pause mid-sentence. Continuous recognition keeps
listening across the whole submitted audio and concatenates every
recognized phrase, so a full multi-sentence answer is actually scored.

Both functions retry once on a transient 'Canceled' result (common on
lower Speech resource tiers under brief load, or momentary network blips)
before raising, so a single flaky request doesn't surface as a 500 mid-demo.
"""
import time
import threading
import azure.cognitiveservices.speech as speechsdk
from config import Config

RETRY_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 1.0
MIN_TIMEOUT_SECONDS = 30
TIMEOUT_BUFFER_SECONDS = 20   # extra headroom for network/service round trip
WAV_BYTES_PER_SECOND = 16000 * 2 * 1  # 16kHz, 16-bit, mono — matches the frontend's WAV encoder


def _recognition_timeout(audio_bytes: bytes) -> float:
    """Scales the wait time to the actual recording length, so longer
    answers (now fully supported since the recognize_once fix) don't get
    cut off by an arbitrary fixed timeout."""
    duration_seconds = len(audio_bytes) / WAV_BYTES_PER_SECOND
    return max(MIN_TIMEOUT_SECONDS, duration_seconds * 1.5 + TIMEOUT_BUFFER_SECONDS)


def _speech_config():
    return speechsdk.SpeechConfig(subscription=Config.SPEECH_KEY, region=Config.SPEECH_REGION)


def _cancellation_detail(result) -> str:
    if result.reason != speechsdk.ResultReason.Canceled:
        return ""
    cancellation = speechsdk.CancellationDetails.from_result(result)
    return f" | cancellation_reason={cancellation.reason} error_details={cancellation.error_details}"


def text_to_speech_bytes(text: str, voice: str = "en-US-JennyNeural") -> bytes:
    """Synthesizes speech and returns raw audio bytes (WAV) for the frontend to play."""
    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        speech_config = _speech_config()
        speech_config.speech_synthesis_voice_name = voice
        pull_stream = speechsdk.audio.PullAudioOutputStream()
        audio_config = speechsdk.audio.AudioOutputConfig(stream=pull_stream)
        synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)

        result = synthesizer.speak_text_async(text).get()
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return result.audio_data

        last_error = f"TTS failed: {result.reason}{_cancellation_detail(result)}"
        if attempt < RETRY_ATTEMPTS:
            time.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError(last_error)


def speech_to_text_from_bytes(audio_bytes: bytes) -> str:
    """
    Transcribes a recorded answer using CONTINUOUS recognition, so the full
    answer is captured even across natural pauses — not just the first
    phrase. Expects 16kHz mono WAV bytes from the frontend mic capture.
    """
    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        speech_config = _speech_config()
        stream = speechsdk.audio.PushAudioInputStream()
        audio_config = speechsdk.audio.AudioConfig(stream=stream)
        recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)

        segments = []
        done_event = threading.Event()
        cancel_detail = {"reason": None, "error_details": None}

        def on_recognized(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech and evt.result.text:
                segments.append(evt.result.text)

        def on_canceled(evt):
            cancel_detail["reason"] = evt.reason
            cancel_detail["error_details"] = getattr(evt, "error_details", None)
            done_event.set()

        def on_session_stopped(evt):
            done_event.set()

        recognizer.recognized.connect(on_recognized)
        recognizer.canceled.connect(on_canceled)
        recognizer.session_stopped.connect(on_session_stopped)

        recognizer.start_continuous_recognition_async().get()

        # Feed the whole answer, then signal end-of-stream so the engine
        # flushes any buffered audio and fires session_stopped.
        stream.write(audio_bytes)
        stream.close()

        finished = done_event.wait(timeout=_recognition_timeout(audio_bytes))
        recognizer.stop_continuous_recognition_async().get()

        if not finished:
            last_error = "STT failed: timed out waiting for recognition to complete"
        elif cancel_detail["reason"] is not None and not segments:
            last_error = f"STT failed: Canceled | cancellation_reason={cancel_detail['reason']} error_details={cancel_detail['error_details']}"
        else:
            final_text = " ".join(segments).strip()
            print(f"[STT] captured {len(segments)} segment(s), {len(final_text)} chars: {final_text!r}")
            return final_text

        if attempt < RETRY_ATTEMPTS:
            time.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError(last_error)