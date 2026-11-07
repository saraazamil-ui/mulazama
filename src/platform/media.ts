/** C14 is explicitly unavailable: no microphone, upload, or third-party playback request is made. */
export function localMediaStatus() {
  return { version: 'local-media-1', available: false, recordingRef: null, microphoneRequested: false,
    referenceAudioAvailable: false, scheduledUpload: false,
    reason: 'الصوت المرجعي المرخص والتسجيل المحلي الاختياري غير مفعّلين. لا يتطلب المسار اليدوي إذن الميكروفون.' } as const;
}
