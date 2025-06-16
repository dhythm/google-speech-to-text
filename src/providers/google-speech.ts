import { SpeechClient } from '@google-cloud/speech';
import * as fs from 'fs';
import {
  TranscriptionConfig,
  TranscriptionResult,
  TranscriptionProvider,
  AudioChunk,
  WordInfo,
  Alternative,
  AudioEncoding,
} from '../types';
import { Config } from '../config';
import { AuthHelper } from '../utils/auth';

export class GoogleSpeechProvider implements TranscriptionProvider {
  name = 'Google Cloud Speech-to-Text';
  private client: SpeechClient;
  private config: Config;

  constructor() {
    this.config = Config.getInstance();
    const googleConfig = this.config.getGoogleCloudConfig();
    
    this.client = new SpeechClient({
      projectId: googleConfig.projectId,
      keyFilename: googleConfig.keyFilename,
    });
  }

  async transcribe(audioPath: string, config: TranscriptionConfig): Promise<TranscriptionResult> {
    this.validateConfig(config);

    const audioBytes = fs.readFileSync(audioPath).toString('base64');

    const request = {
      audio: {
        content: audioBytes,
      },
      config: this.buildRecognitionConfig(config),
    };

    try {
      const [response] = await this.client.recognize(request);
      return this.processResponse(response);
    } catch (error) {
      throw new Error(`Google Speech transcription failed: ${error}`);
    }
  }

  async transcribeChunk(chunk: AudioChunk, config: TranscriptionConfig): Promise<TranscriptionResult> {
    this.validateConfig(config);

    const audioBytes = chunk.buffer.toString('base64');

    const request = {
      audio: {
        content: audioBytes,
      },
      config: this.buildRecognitionConfig(config),
    };

    try {
      const [response] = await this.client.recognize(request);
      const result = this.processResponse(response);
      
      // Adjust timestamps based on chunk offset
      if (result.words) {
        result.words = result.words.map(word => ({
          ...word,
          startTime: word.startTime + chunk.startTime,
          endTime: word.endTime + chunk.startTime,
        }));
      }

      return result;
    } catch (error) {
      throw new Error(`Google Speech chunk transcription failed: ${error}`);
    }
  }

  async transcribeLongAudio(audioPath: string, config: TranscriptionConfig): Promise<TranscriptionResult> {
    this.validateConfig(config);

    // For audio longer than 1 minute, use longRunningRecognize
    const audioBytes = fs.readFileSync(audioPath).toString('base64');

    const request = {
      audio: {
        content: audioBytes,
      },
      config: this.buildRecognitionConfig(config),
    };

    try {
      const [operation] = await this.client.longRunningRecognize(request);
      
      // Wait for the operation to complete
      const [response] = await operation.promise();
      
      return this.processLongRunningResponse(response);
    } catch (error) {
      throw new Error(`Google Speech long audio transcription failed: ${error}`);
    }
  }

  private buildRecognitionConfig(config: TranscriptionConfig): any {
    const recognitionConfig: any = {
      encoding: this.mapEncoding(config.encoding),
      sampleRateHertz: config.sampleRateHertz || 16000,
      languageCode: config.languageCode,
      enableWordTimeOffsets: config.enableWordTimeOffsets,
      enableAutomaticPunctuation: config.enableAutomaticPunctuation,
      enableWordConfidence: config.enableWordConfidence,
      maxAlternatives: config.maxAlternatives || 1,
      profanityFilter: config.profanityFilter,
      model: config.model,
      useEnhanced: config.useEnhanced,
    };

    if (config.speechContexts) {
      recognitionConfig.speechContexts = config.speechContexts;
    }

    if (config.diarizationConfig) {
      recognitionConfig.diarizationConfig = {
        enableSpeakerDiarization: config.diarizationConfig.enableSpeakerDiarization,
        minSpeakerCount: config.diarizationConfig.minSpeakerCount,
        maxSpeakerCount: config.diarizationConfig.maxSpeakerCount,
      };
    }

    if (config.metadata) {
      recognitionConfig.metadata = config.metadata;
    }

    return recognitionConfig;
  }

  private mapEncoding(encoding?: AudioEncoding): string {
    const encodingMap: Record<AudioEncoding, string> = {
      [AudioEncoding.ENCODING_UNSPECIFIED]: 'ENCODING_UNSPECIFIED',
      [AudioEncoding.LINEAR16]: 'LINEAR16',
      [AudioEncoding.FLAC]: 'FLAC',
      [AudioEncoding.MULAW]: 'MULAW',
      [AudioEncoding.AMR]: 'AMR',
      [AudioEncoding.AMR_WB]: 'AMR_WB',
      [AudioEncoding.OGG_OPUS]: 'OGG_OPUS',
      [AudioEncoding.SPEEX_WITH_HEADER_BYTE]: 'SPEEX_WITH_HEADER_BYTE',
      [AudioEncoding.MP3]: 'MP3',
      [AudioEncoding.WEBM_OPUS]: 'WEBM_OPUS',
    };

    return encodingMap[encoding || AudioEncoding.LINEAR16];
  }

  private processResponse(response: any): TranscriptionResult {
    const results = response.results || [];
    
    if (results.length === 0) {
      return {
        transcript: '',
        words: [],
        alternatives: [],
      };
    }

    const primaryResult = results[0];
    const primaryAlternative = primaryResult.alternatives?.[0] || {};

    const words: WordInfo[] = [];
    const alternatives: Alternative[] = [];

    // Process words with timestamps
    if (primaryAlternative.words) {
      primaryAlternative.words.forEach((word: any) => {
        words.push({
          word: word.word,
          startTime: this.timeToSeconds(word.startTime),
          endTime: this.timeToSeconds(word.endTime),
          confidence: word.confidence,
          speakerTag: word.speakerTag,
        });
      });
    }

    // Process alternatives
    primaryResult.alternatives?.forEach((alt: any, index: number) => {
      if (index > 0) { // Skip the primary alternative
        alternatives.push({
          transcript: alt.transcript,
          confidence: alt.confidence,
          words: alt.words?.map((word: any) => ({
            word: word.word,
            startTime: this.timeToSeconds(word.startTime),
            endTime: this.timeToSeconds(word.endTime),
            confidence: word.confidence,
          })),
        });
      }
    });

    // Combine all results for full transcript
    const fullTranscript = results
      .map((result: any) => result.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    return {
      transcript: fullTranscript,
      words,
      alternatives,
      confidence: primaryAlternative.confidence,
      languageCode: response.results?.[0]?.languageCode,
    };
  }

  private processLongRunningResponse(response: any): TranscriptionResult {
    return this.processResponse(response);
  }

  private timeToSeconds(time: any): number {
    if (!time) return 0;
    return Number(time.seconds || 0) + Number(time.nanos || 0) / 1e9;
  }

  validateConfig(config: TranscriptionConfig): void {
    if (!config.languageCode) {
      throw new Error('Language code is required for Google Speech-to-Text');
    }

    const googleConfig = this.config.getGoogleCloudConfig();
    if (!googleConfig.projectId) {
      throw new Error('Google Cloud project ID is not configured. Set GOOGLE_CLOUD_PROJECT_ID environment variable.');
    }

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('Google Cloud credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS environment variable.');
    }
    
    // Validate credentials
    try {
      AuthHelper.validateServiceAccountKey(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    } catch (error) {
      throw new Error(`Invalid Google Cloud credentials: ${error}`);
    }
  }
}