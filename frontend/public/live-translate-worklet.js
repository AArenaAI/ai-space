class LiveTranslatePCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.sourceSampleRate = sampleRate;
    this.chunkSize = Math.round(this.targetSampleRate * 0.1);
    this.buffer = [];
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || !input.length) return true;

    let sumSquares = 0;
    for (let i = 0; i < input.length; i += 1) {
      const sample = input[i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
    this.port.postMessage({ type: 'level', level: Math.min(100, Math.round(rms * 260)) });

    const ratio = this.sourceSampleRate / this.targetSampleRate;
    const outputLength = this.sourceSampleRate === this.targetSampleRate ? input.length : Math.floor(input.length / ratio);
    for (let i = 0; i < outputLength; i += 1) {
      let sample = input[i];
      if (this.sourceSampleRate !== this.targetSampleRate) {
        const start = Math.floor(i * ratio);
        const end = Math.min(Math.floor((i + 1) * ratio), input.length);
        let sum = 0;
        for (let j = start; j < end; j += 1) sum += input[j];
        sample = sum / Math.max(1, end - start);
      }
      this.buffer.push(Math.max(-1, Math.min(1, sample)));
    }

    while (this.buffer.length >= this.chunkSize) {
      const pcm = new ArrayBuffer(this.chunkSize * 2);
      const view = new DataView(pcm);
      for (let i = 0; i < this.chunkSize; i += 1) {
        const sample = this.buffer.shift();
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      this.port.postMessage({ type: 'audio', buffer: pcm }, [pcm]);
    }
    return true;
  }
}

registerProcessor('live-translate-pcm-processor', LiveTranslatePCMProcessor);
