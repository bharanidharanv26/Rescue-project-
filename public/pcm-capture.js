// AudioWorklet keeps continuous capture off React's/main-thread render loop.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = []
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }) }
    }
  }
  flush() {
    if (!this.samples.length) return
    const pcm = new ArrayBuffer(this.samples.length * 2)
    const view = new DataView(pcm)
    this.samples.forEach((sample, index) => view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true))
    this.port.postMessage(pcm, [pcm])
    this.samples = []
  }
  process(inputs) {
    const channels = inputs[0]
    if (channels?.length) {
      for (let index = 0; index < channels[0].length; index++) {
        let value = 0
        for (const channel of channels) value += channel[index]
        this.samples.push(value / channels.length)
      }
      if (this.samples.length >= sampleRate / 10) this.flush()
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
