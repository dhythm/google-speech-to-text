import { TranscriptionConfig, ProcessingOptions, AudioEncoding } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AuthHelper } from './utils/auth';

dotenv.config();

export class Config {
  private static instance: Config;
  private transcriptionConfig: Partial<TranscriptionConfig>;
  private processingOptions: ProcessingOptions;

  private constructor() {
    this.transcriptionConfig = this.loadDefaultTranscriptionConfig();
    this.processingOptions = this.loadDefaultProcessingOptions();
  }

  static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  private loadDefaultTranscriptionConfig(): Partial<TranscriptionConfig> {
    return {
      languageCode: 'ja-JP',
      encoding: AudioEncoding.LINEAR16,
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      model: 'latest_long',
      useEnhanced: true,
      maxAlternatives: 1,
      profanityFilter: false,
    };
  }

  private loadDefaultProcessingOptions(): ProcessingOptions {
    return {
      chunkDuration: 59, // 59 seconds to stay under 1-minute limit
      overlap: 1, // 1 second overlap between chunks
      outputFormat: undefined,
      tempDir: path.join(process.cwd(), '.temp'),
      verbose: false,
    };
  }

  loadFromFile(configPath: string): void {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      
      if (config.transcription) {
        this.transcriptionConfig = { ...this.transcriptionConfig, ...config.transcription };
      }
      
      if (config.processing) {
        this.processingOptions = { ...this.processingOptions, ...config.processing };
      }
    } catch (error) {
      throw new Error(`Failed to load config file: ${error}`);
    }
  }

  getTranscriptionConfig(): Partial<TranscriptionConfig> {
    return { ...this.transcriptionConfig };
  }

  getProcessingOptions(): ProcessingOptions {
    return { ...this.processingOptions };
  }

  updateTranscriptionConfig(config: Partial<TranscriptionConfig>): void {
    this.transcriptionConfig = { ...this.transcriptionConfig, ...config };
  }

  updateProcessingOptions(options: Partial<ProcessingOptions>): void {
    this.processingOptions = { ...this.processingOptions, ...options };
  }

  getGoogleCloudConfig() {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const credentialConfig = AuthHelper.getCredentialConfig(credentials);
    
    return {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || process.env.GCLOUD_PROJECT,
      ...credentialConfig,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    };
  }

  getVertexAIConfig() {
    return {
      project: process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID,
      location: process.env.VERTEX_AI_LOCATION || 'us-central1',
      apiEndpoint: process.env.VERTEX_AI_ENDPOINT,
    };
  }

  ensureTempDir(): void {
    const tempDir = this.processingOptions.tempDir;
    if (tempDir && !fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  }

  cleanupTempDir(): void {
    const tempDir = this.processingOptions.tempDir;
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}