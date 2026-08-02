"""
Azure AI Speech — speech-to-text for capturing answers, text-to-speech
for reading questions aloud.
"""
import azure.cognitiveservices.speech as speechsdk
from config import Config


def _speech_config():
    return speechsdk.SpeechConfig(subscription=Config.SPEECH_KEY, region=Config.SPEECH_REGION)


def text_to_speech_bytes(text: str, voice: str = "en-US-JennyNeural") -> bytes:
    """Synthesizes speech and returns raw audio bytes (WAV) for the frontend to play."""
    speech_config = _speech_config()
    speech_config.speech_synthesis_voice_name = voice
    # PullAudioOutputStream avoids writing to disk / playing on the server itself
    pull_stream = speechsdk.audio.PullAudioOutputStream()
    audio_config = speechsdk.audio.AudioOutputConfig(stream=pull_stream)
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)

    result = synthesizer.speak_text_async(text).get()
    if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
        raise RuntimeError(f"TTS failed: {result.reason}")
    return result.audio_data


def speech_to_text_from_bytes(audio_bytes: bytes) -> str:
    """
    Transcribes a recorded answer. Expects 16kHz mono WAV bytes from the
    frontend mic capture. Adjust format via AudioStreamFormat if your
    frontend sends a different codec.
    """
    speech_config = _speech_config()
    stream = speechsdk.audio.PushAudioInputStream()
    audio_config = speechsdk.audio.AudioConfig(stream=stream)
    recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)

    stream.write(audio_bytes)
    stream.close()

    result = recognizer.recognize_once()
    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        return result.text
    elif result.reason == speechsdk.ResultReason.NoMatch:
        return ""
    else:
        raise RuntimeError(f"STT failed: {result.reason}")
