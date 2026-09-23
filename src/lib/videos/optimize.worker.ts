import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion } from "mediabunny";
self.onmessage = async (event: MessageEvent<File>) => {
  const file = event.data;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let compatible = false;
  try {
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120.1) throw new Error("Selecione um vídeo de até 2 minutos.");
    const track = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    compatible = track?.codec === "avc" && (!audio || audio.codec === "aac") && (await input.getFormat()).name === "MP4";
    if (!track) throw new Error("Vídeo não encontrado no arquivo.");
    const width = await track.getDisplayWidth();
    const height = await track.getDisplayHeight();
    const scale = Math.min(1, 1920 / Math.max(width, height), 1080 / Math.min(width, height));
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const conversion = await Conversion.init({ input, output,
      video: { codec: "avc", width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2), fit: "contain", frameRate: 30, bitrate: 4000000 },
      audio: { codec: "aac", bitrate: 128000 },
    });
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error("O aparelho não consegue otimizar este formato preservando o áudio.");
    conversion.onProgress = value => self.postMessage({ progress: value });
    await conversion.execute();
    if (!target.buffer) throw new Error("Não foi possível otimizar.");
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    self.postMessage({ blob: compatible && file.size <= blob.size ? file : blob, duration });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Falha na otimização.", compatible });
  } finally { input.dispose(); }
};
