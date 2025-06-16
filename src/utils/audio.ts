import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { AudioChunk, AudioEncoding } from '../types';
import { Config } from '../config';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export class AudioProcessor {
  private config: Config;

  constructor() {
    this.config = Config.getInstance();
  }

  async extractAudio(inputPath: string, outputPath?: string): Promise<string> {
    const ext = path.extname(inputPath).toLowerCase();
    const isVideo = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'].includes(ext);
    
    if (!isVideo && ['.wav', '.mp3', '.flac', '.m4a', '.aac'].includes(ext)) {
      // For MP3 files, always convert to WAV for better compatibility
      if (ext === '.mp3') {
        const tempDir = this.config.getProcessingOptions().tempDir || '.temp';
        this.config.ensureTempDir();
        const wavOutput = outputPath || path.join(tempDir, `audio_${Date.now()}.wav`);
        return this.convertAudio(inputPath, wavOutput, AudioEncoding.LINEAR16);
      }
      
      // For other audio files, convert if output path is specified
      if (outputPath && outputPath !== inputPath) {
        return this.convertAudio(inputPath, outputPath);
      }
      return inputPath;
    }

    const tempDir = this.config.getProcessingOptions().tempDir || '.temp';
    this.config.ensureTempDir();
    
    const audioOutput = outputPath || path.join(tempDir, `audio_${Date.now()}.wav`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .on('end', () => resolve(audioOutput))
        .on('error', (err: any) => reject(new Error(`Audio extraction failed: ${err.message}`)))
        .save(audioOutput);
    });
  }

  async convertAudio(inputPath: string, outputPath: string, encoding?: AudioEncoding): Promise<string> {
    const codecMap: Record<string, string> = {
      [AudioEncoding.LINEAR16]: 'pcm_s16le',
      [AudioEncoding.FLAC]: 'flac',
      [AudioEncoding.MP3]: 'libmp3lame',
      [AudioEncoding.OGG_OPUS]: 'libopus',
    };

    const codec = encoding ? codecMap[encoding] : 'pcm_s16le';

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .audioCodec(codec)
        .audioFrequency(16000)
        .audioChannels(1);

      if (encoding === AudioEncoding.LINEAR16) {
        command.format('wav');
      }

      command
        .on('end', () => resolve(outputPath))
        .on('error', (err: any) => reject(new Error(`Audio conversion failed: ${err.message}`)))
        .save(outputPath);
    });
  }

  async splitAudioIntoChunks(
    audioPath: string,
    chunkDuration: number = 59,
    overlap: number = 1
  ): Promise<AudioChunk[]> {
    const duration = await this.getAudioDuration(audioPath);
    const chunks: AudioChunk[] = [];
    const tempDir = this.config.getProcessingOptions().tempDir || '.temp';
    this.config.ensureTempDir();

    let currentTime = 0;
    let chunkIndex = 0;

    while (currentTime < duration) {
      const startTime = Math.max(0, currentTime - overlap);
      const chunkLength = Math.min(chunkDuration, duration - startTime);
      const outputPath = path.join(tempDir, `chunk_${chunkIndex}.wav`);

      await this.extractChunk(audioPath, outputPath, startTime, chunkLength);

      const buffer = fs.readFileSync(outputPath);
      chunks.push({
        buffer,
        startTime,
        endTime: startTime + chunkLength,
        index: chunkIndex,
      });

      currentTime += chunkDuration - overlap;
      chunkIndex++;
    }

    return chunks;
  }

  private async extractChunk(
    inputPath: string,
    outputPath: string,
    startTime: number,
    duration: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .duration(duration)
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('end', () => resolve())
        .on('error', (err: any) => reject(new Error(`Chunk extraction failed: ${err.message}`)))
        .save(outputPath);
    });
  }

  async getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to get audio duration: ${err.message}`));
        } else {
          resolve(metadata.format.duration || 0);
        }
      });
    });
  }

  async getAudioInfo(audioPath: string): Promise<{
    duration: number;
    bitrate: number;
    codec: string;
    sampleRate: number;
    channels: number;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(new Error(`Failed to get audio info: ${err.message}`));
        } else {
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
          if (!audioStream) {
            reject(new Error('No audio stream found'));
            return;
          }

          resolve({
            duration: metadata.format.duration || 0,
            bitrate: metadata.format.bit_rate || 0,
            codec: audioStream.codec_name || 'unknown',
            sampleRate: audioStream.sample_rate || 0,
            channels: audioStream.channels || 0,
          });
        }
      });
    });
  }

  cleanupTempFiles(): void {
    this.config.cleanupTempDir();
  }

  /**
   * Detects the appropriate AudioEncoding based on file extension
   */
  detectEncoding(filePath: string): AudioEncoding {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.wav':
        return AudioEncoding.LINEAR16;
      case '.mp3':
        return AudioEncoding.MP3;
      case '.flac':
        return AudioEncoding.FLAC;
      case '.ogg':
        return AudioEncoding.OGG_OPUS;
      case '.webm':
        return AudioEncoding.WEBM_OPUS;
      default:
        return AudioEncoding.LINEAR16; // Default to LINEAR16
    }
  }

  async validateAudioFile(audioPath: string): Promise<void> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const stats = fs.statSync(audioPath);
    if (stats.size === 0) {
      throw new Error('Audio file is empty');
    }

    // Check if it's a valid audio/video file
    try {
      await this.getAudioInfo(audioPath);
    } catch (error) {
      throw new Error(`Invalid audio/video file: ${error}`);
    }
  }
}