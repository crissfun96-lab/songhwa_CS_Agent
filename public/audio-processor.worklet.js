// Audio worklet processor — runs in the audio thread (not main thread).
// Reads mic input → downsamples to target rate → converts to 16-bit PCM →
// posts to main thread for WebSocket forwarding.
//
// Replaces the deprecated ScriptProcessorNode (Bug #9 from SaaS audit).
// Loaded from /audio-processor.worklet.js by AudioContext.audioWorklet.addModule().

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // `sampleRate` is a global in AudioWorkletGlobalScope = the AudioContext's rate
    this.sourceSampleRate = sampleRate;
    const opts = options?.processorOptions ?? {};
    this.targetSampleRate = opts.targetSampleRate ?? 16000;
    this.bufferSize = opts.bufferSize ?? 4096;
    this.accumulator = new Float32Array(this.bufferSize);
    this.accumulatorPos = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    for (let i = 0; i < input.length; i++) {
      this.accumulator[this.accumulatorPos++] = input[i];
      if (this.accumulatorPos >= this.bufferSize) {
        const downsampled = this.downsample(this.accumulator);
        const pcm = this.toPCM16(downsampled);
        // Transfer ownership of the underlying buffer — zero-copy.
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        // Fresh accumulator (old one was transferred above)
        this.accumulator = new Float32Array(this.bufferSize);
        this.accumulatorPos = 0;
      }
    }
    return true;
  }

  downsample(buffer) {
    const ratio = this.sourceSampleRate / this.targetSampleRate;
    if (ratio === 1) return buffer;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      result[i] = buffer[Math.min(Math.round(i * ratio), buffer.length - 1)];
    }
    return result;
  }

  toPCM16(buffer) {
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return result;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
