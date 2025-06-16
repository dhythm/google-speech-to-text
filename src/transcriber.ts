import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import {
  TranscriptionConfig,
  TranscriptionResult,
  TranscriptionProvider,
  ProcessingOptions,
  OutputFormat,
  WordInfo,
} from './types';
import { Config } from './config';
import { AudioProcessor } from './utils/audio';
import { GoogleSpeechProvider } from './providers/google-speech';
import { VertexAISpeechProvider } from './providers/vertex-ai';
import { AuthHelper } from './utils/auth';

export class Transcriber {
  private config: Config;
  private audioProcessor: AudioProcessor;
  private provider: TranscriptionProvider;

  constructor(providerName: 'google-speech' | 'vertex-ai') {
    this.config = Config.getInstance();
    this.audioProcessor = new AudioProcessor();
    
    switch (providerName) {
      case 'google-speech':
        this.provider = new GoogleSpeechProvider();
        break;
      case 'vertex-ai':
        this.provider = new VertexAISpeechProvider();
        break;
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  async transcribeFile(
    inputPath: string,
    transcriptionConfig: TranscriptionConfig,
    processingOptions?: ProcessingOptions
  ): Promise<TranscriptionResult> {
    const options = { ...this.config.getProcessingOptions(), ...processingOptions };
    const spinner = options.verbose ? ora('Processing audio file...').start() : null;

    try {
      // Validate input file
      await this.audioProcessor.validateAudioFile(inputPath);

      // Extract audio from video if needed and convert to appropriate format
      if (spinner) spinner.text = 'Extracting and converting audio...';
      const audioPath = await this.audioProcessor.extractAudio(inputPath);

      // Detect and set appropriate encoding
      const detectedEncoding = this.audioProcessor.detectEncoding(audioPath);
      transcriptionConfig.encoding = detectedEncoding;
      transcriptionConfig.sampleRateHertz = 16000; // Ensure sample rate is set

      // Get audio duration
      const duration = await this.audioProcessor.getAudioDuration(audioPath);
      
      if (options.verbose) {
        console.log(chalk.blue(`\nAudio file: ${audioPath}`));
        console.log(chalk.blue(`Audio encoding: ${detectedEncoding}`));
        console.log(chalk.blue(`Audio duration: ${this.formatDuration(duration)}`));
      }

      let result: TranscriptionResult;

      // For long audio files, split into chunks
      if (duration > (options.chunkDuration || 59)) {
        if (spinner) spinner.text = 'Splitting audio into chunks...';
        const chunks = await this.audioProcessor.splitAudioIntoChunks(
          audioPath,
          options.chunkDuration,
          options.overlap
        );

        if (options.verbose) {
          console.log(chalk.blue(`Split into ${chunks.length} chunks`));
        }

        result = await this.transcribeChunks(chunks, transcriptionConfig, spinner);
      } else {
        // For short audio, transcribe directly
        if (spinner) spinner.text = 'Transcribing audio...';
        result = await this.provider.transcribe(audioPath, transcriptionConfig);
      }

      spinner?.succeed('Transcription completed!');

      // Save output if requested
      if (options.outputPath) {
        await this.saveOutput(result, options.outputPath, options.outputFormat);
        if (options.verbose) {
          console.log(chalk.green(`Output saved to: ${options.outputPath}`));
        }
      }

      // Cleanup temporary files
      this.audioProcessor.cleanupTempFiles();
      AuthHelper.cleanup();

      return result;
    } catch (error) {
      spinner?.fail('Transcription failed');
      this.audioProcessor.cleanupTempFiles();
      AuthHelper.cleanup();
      throw error;
    }
  }

  private async transcribeChunks(
    chunks: any[],
    config: TranscriptionConfig,
    spinner: any
  ): Promise<TranscriptionResult> {
    const options = this.config.getProcessingOptions();
    const maxConcurrent = options.maxConcurrentChunks || 3;
    const results: (TranscriptionResult | null)[] = new Array(chunks.length).fill(null);
    const failedChunks: number[] = [];
    
    if (options.verbose) {
      console.log(chalk.blue(`Processing ${chunks.length} chunks with max ${maxConcurrent} parallel...`));
    }

    // Process chunks in batches with limited concurrency
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
      const batch = chunks.slice(i, Math.min(i + maxConcurrent, chunks.length));
      const batchIndices = Array.from({ length: batch.length }, (_, idx) => i + idx);
      
      if (spinner) {
        spinner.text = `Processing batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(chunks.length / maxConcurrent)} (chunks ${i + 1}-${Math.min(i + maxConcurrent, chunks.length)}/${chunks.length})`;
      }
      
      const batchPromises = batch.map(async (chunk, batchIdx) => {
        const chunkIndex = batchIndices[batchIdx];
        try {
          const startTime = Date.now();
          const result = await this.provider.transcribeChunk(chunk, config);
          const endTime = Date.now();
          
          if (options.verbose) {
            const duration = ((endTime - startTime) / 1000).toFixed(1);
            console.log(chalk.green(`✓ Chunk ${chunkIndex + 1} completed in ${duration}s`));
          }
          
          return { index: chunkIndex, result };
        } catch (error) {
          console.error(chalk.red(`✗ Chunk ${chunkIndex + 1} failed: ${error}`));
          failedChunks.push(chunkIndex);
          return { index: chunkIndex, result: null };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Store results in correct positions
      batchResults.forEach(({ index, result }) => {
        results[index] = result;
      });
      
      // Add small delay between batches to avoid rate limiting
      if (i + maxConcurrent < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Retry failed chunks if enabled
    if (options.retryFailedChunks && failedChunks.length > 0) {
      console.log(chalk.yellow(`Retrying ${failedChunks.length} failed chunks...`));
      await this.retryFailedChunks(chunks, failedChunks, config, results, options);
    }

    // Filter out null results and merge
    const validResults = results.filter((result): result is TranscriptionResult => result !== null);
    
    if (validResults.length === 0) {
      throw new Error('All chunks failed to transcribe');
    }
    
    if (options.verbose) {
      console.log(chalk.blue(`Successfully transcribed ${validResults.length}/${chunks.length} chunks`));
    }

    return this.mergeResults(validResults);
  }

  private async retryFailedChunks(
    chunks: any[],
    failedIndices: number[],
    config: TranscriptionConfig,
    results: (TranscriptionResult | null)[],
    options: any
  ): Promise<void> {
    const maxRetries = options.maxRetries || 3;
    
    for (const chunkIndex of failedIndices) {
      let retryCount = 0;
      let success = false;
      
      while (retryCount < maxRetries && !success) {
        try {
          console.log(chalk.yellow(`Retrying chunk ${chunkIndex + 1} (attempt ${retryCount + 1}/${maxRetries})`));
          
          // Add exponential backoff delay
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          
          const result = await this.provider.transcribeChunk(chunks[chunkIndex], config);
          results[chunkIndex] = result;
          success = true;
          
          console.log(chalk.green(`✓ Chunk ${chunkIndex + 1} succeeded on retry ${retryCount + 1}`));
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            console.error(chalk.red(`✗ Chunk ${chunkIndex + 1} failed after ${maxRetries} retries: ${error}`));
          }
        }
      }
    }
  }

  private mergeResults(results: TranscriptionResult[]): TranscriptionResult {
    const mergedResult: TranscriptionResult = {
      transcript: '',
      words: [],
      alternatives: [],
      confidence: 0,
    };

    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const result of results) {
      // Merge transcripts
      if (result.transcript) {
        mergedResult.transcript += (mergedResult.transcript ? ' ' : '') + result.transcript;
      }

      // Merge words
      if (result.words) {
        mergedResult.words!.push(...result.words);
      }

      // Calculate average confidence
      if (result.confidence) {
        totalConfidence += result.confidence;
        confidenceCount++;
      }

      // Take language code from first result
      if (!mergedResult.languageCode && result.languageCode) {
        mergedResult.languageCode = result.languageCode;
      }
    }

    if (confidenceCount > 0) {
      mergedResult.confidence = totalConfidence / confidenceCount;
    }

    // Sort words by start time
    mergedResult.words!.sort((a, b) => a.startTime - b.startTime);

    return mergedResult;
  }

  private async saveOutput(
    result: TranscriptionResult,
    outputPath: string,
    format?: OutputFormat
  ): Promise<void> {
    const ext = path.extname(outputPath).toLowerCase();
    const outputFormat = format || this.detectFormat(ext);

    let content: string;

    switch (outputFormat) {
      case OutputFormat.JSON:
        content = JSON.stringify(result, null, 2);
        break;
      case OutputFormat.TXT:
        content = result.transcript;
        break;
      case OutputFormat.SRT:
        content = this.generateSRT(result);
        break;
      case OutputFormat.VTT:
        content = this.generateVTT(result);
        break;
      case OutputFormat.CSV:
        content = this.generateCSV(result);
        break;
      default:
        content = result.transcript;
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  private detectFormat(ext: string): OutputFormat {
    switch (ext) {
      case '.json':
        return OutputFormat.JSON;
      case '.srt':
        return OutputFormat.SRT;
      case '.vtt':
        return OutputFormat.VTT;
      case '.csv':
        return OutputFormat.CSV;
      default:
        return OutputFormat.TXT;
    }
  }

  private generateSRT(result: TranscriptionResult): string {
    if (!result.words || result.words.length === 0) {
      return '';
    }

    const subtitles: string[] = [];
    let currentSubtitle: WordInfo[] = [];
    let subtitleIndex = 1;

    for (const word of result.words) {
      currentSubtitle.push(word);

      // Create subtitle every ~3 seconds or at sentence boundaries
      const duration = currentSubtitle[currentSubtitle.length - 1].endTime - currentSubtitle[0].startTime;
      const isEndOfSentence = /[.!?]$/.test(word.word);

      if (duration >= 3 || (isEndOfSentence && duration >= 1)) {
        const startTime = this.formatSRTTime(currentSubtitle[0].startTime);
        const endTime = this.formatSRTTime(currentSubtitle[currentSubtitle.length - 1].endTime);
        const text = currentSubtitle.map(w => w.word).join(' ');

        subtitles.push(`${subtitleIndex}\n${startTime} --> ${endTime}\n${text}\n`);
        
        subtitleIndex++;
        currentSubtitle = [];
      }
    }

    // Add remaining words
    if (currentSubtitle.length > 0) {
      const startTime = this.formatSRTTime(currentSubtitle[0].startTime);
      const endTime = this.formatSRTTime(currentSubtitle[currentSubtitle.length - 1].endTime);
      const text = currentSubtitle.map(w => w.word).join(' ');

      subtitles.push(`${subtitleIndex}\n${startTime} --> ${endTime}\n${text}\n`);
    }

    return subtitles.join('\n');
  }

  private generateVTT(result: TranscriptionResult): string {
    const srt = this.generateSRT(result);
    if (!srt) return 'WEBVTT\n\n';

    // Convert SRT to VTT format
    const vtt = srt
      .replace(/(\d+)\n/g, '') // Remove subtitle numbers
      .replace(/,/g, '.'); // Replace comma with period in timestamps

    return `WEBVTT\n\n${vtt}`;
  }

  private generateCSV(result: TranscriptionResult): string {
    const headers = ['Start Time', 'End Time', 'Word', 'Confidence', 'Speaker'];
    const rows = [headers.join(',')];

    if (result.words) {
      for (const word of result.words) {
        const row = [
          word.startTime.toFixed(3),
          word.endTime.toFixed(3),
          `"${word.word.replace(/"/g, '""')}"`,
          word.confidence?.toFixed(3) || '',
          word.speakerTag || '',
        ];
        rows.push(row.join(','));
      }
    }

    return rows.join('\n');
  }

  private formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    const ms = Math.floor((secs % 1) * 1000).toString().padStart(3, '0');

    return `${pad(hours)}:${pad(minutes)}:${pad(Math.floor(secs))},${ms}`;
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
}