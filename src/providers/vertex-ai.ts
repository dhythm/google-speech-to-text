import { PredictionServiceClient } from '@google-cloud/aiplatform';
import * as fs from 'fs';
import {
  TranscriptionConfig,
  TranscriptionResult,
  TranscriptionProvider,
  AudioChunk,
  WordInfo,
  AudioEncoding,
} from '../types';
import { Config } from '../config';

export class VertexAISpeechProvider implements TranscriptionProvider {
  name = 'Vertex AI Speech';
  private client: PredictionServiceClient;
  private config: Config;
  private project: string;
  private location: string;
  private endpointId: string;

  constructor() {
    this.config = Config.getInstance();
    const vertexConfig = this.config.getVertexAIConfig();
    
    this.project = vertexConfig.project || '';
    this.location = vertexConfig.location || 'us-central1';
    this.endpointId = process.env.VERTEX_AI_SPEECH_ENDPOINT_ID || '';

    const options: any = {};
    if (vertexConfig.apiEndpoint) {
      options.apiEndpoint = vertexConfig.apiEndpoint;
    }

    this.client = new PredictionServiceClient(options);
  }

  async transcribe(audioPath: string, config: TranscriptionConfig): Promise<TranscriptionResult> {
    this.validateConfig(config);

    const audioContent = fs.readFileSync(audioPath);
    const audioBytes = audioContent.toString('base64');

    const instance = {
      content: audioBytes,
      mimeType: this.getMimeType(config.encoding),
    };

    const parameters = this.buildParameters(config);

    const endpoint = `projects/${this.project}/locations/${this.location}/endpoints/${this.endpointId}`;

    const request = {
      endpoint,
      instances: [{ structValue: { fields: this.objectToValue(instance) } }],
      parameters: { structValue: { fields: this.objectToValue(parameters) } },
    };

    try {
      const [response] = await this.client.predict(request);
      return this.processResponse(response);
    } catch (error) {
      throw new Error(`Vertex AI Speech transcription failed: ${error}`);
    }
  }

  async transcribeChunk(chunk: AudioChunk, config: TranscriptionConfig): Promise<TranscriptionResult> {
    this.validateConfig(config);

    const audioBytes = chunk.buffer.toString('base64');

    const instance = {
      content: audioBytes,
      mimeType: this.getMimeType(config.encoding),
    };

    const parameters = this.buildParameters(config);

    const endpoint = `projects/${this.project}/locations/${this.location}/endpoints/${this.endpointId}`;

    const request = {
      endpoint,
      instances: [{ structValue: { fields: this.objectToValue(instance) } }],
      parameters: { structValue: { fields: this.objectToValue(parameters) } },
    };

    try {
      const [response] = await this.client.predict(request);
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
      throw new Error(`Vertex AI Speech chunk transcription failed: ${error}`);
    }
  }

  private buildParameters(config: TranscriptionConfig): any {
    const parameters: any = {
      languageCode: config.languageCode,
      maxAlternatives: config.maxAlternatives || 1,
      enableWordTimeOffsets: config.enableWordTimeOffsets || false,
      enableWordConfidence: config.enableWordConfidence || false,
      enableAutomaticPunctuation: config.enableAutomaticPunctuation || false,
      profanityFilter: config.profanityFilter || false,
    };

    if (config.model) {
      parameters.model = config.model;
    }

    if (config.speechContexts) {
      parameters.speechContexts = config.speechContexts;
    }

    if (config.diarizationConfig) {
      parameters.enableSpeakerDiarization = config.diarizationConfig.enableSpeakerDiarization;
      if (config.diarizationConfig.minSpeakerCount) {
        parameters.minSpeakerCount = config.diarizationConfig.minSpeakerCount;
      }
      if (config.diarizationConfig.maxSpeakerCount) {
        parameters.maxSpeakerCount = config.diarizationConfig.maxSpeakerCount;
      }
    }

    return parameters;
  }

  private getMimeType(encoding?: AudioEncoding): string {
    const mimeTypeMap: Record<AudioEncoding, string> = {
      [AudioEncoding.ENCODING_UNSPECIFIED]: 'audio/wav',
      [AudioEncoding.LINEAR16]: 'audio/wav',
      [AudioEncoding.FLAC]: 'audio/flac',
      [AudioEncoding.MULAW]: 'audio/basic',
      [AudioEncoding.AMR]: 'audio/amr',
      [AudioEncoding.AMR_WB]: 'audio/amr-wb',
      [AudioEncoding.OGG_OPUS]: 'audio/ogg',
      [AudioEncoding.SPEEX_WITH_HEADER_BYTE]: 'audio/speex',
      [AudioEncoding.MP3]: 'audio/mp3',
      [AudioEncoding.WEBM_OPUS]: 'audio/webm',
    };

    return mimeTypeMap[encoding || AudioEncoding.LINEAR16];
  }

  private processResponse(response: any): TranscriptionResult {
    const predictions = response.predictions || [];
    
    if (predictions.length === 0) {
      return {
        transcript: '',
        words: [],
        alternatives: [],
      };
    }

    const prediction = predictions[0];
    const structValue = prediction.structValue || prediction;
    const fields = structValue.fields || {};

    const transcript = this.getStringValue(fields.transcript);
    const confidence = this.getNumberValue(fields.confidence);

    const words: WordInfo[] = [];
    const wordsArray = this.getListValue(fields.words);
    
    if (wordsArray) {
      wordsArray.forEach((wordObj: any) => {
        const wordFields = wordObj.structValue?.fields || {};
        words.push({
          word: this.getStringValue(wordFields.word),
          startTime: this.getNumberValue(wordFields.startTime),
          endTime: this.getNumberValue(wordFields.endTime),
          confidence: this.getNumberValue(wordFields.confidence),
          speakerTag: this.getNumberValue(wordFields.speakerTag),
        });
      });
    }

    const alternatives: any[] = [];
    const alternativesArray = this.getListValue(fields.alternatives);
    
    if (alternativesArray && alternativesArray.length > 1) {
      alternativesArray.slice(1).forEach((altObj: any) => {
        const altFields = altObj.structValue?.fields || {};
        alternatives.push({
          transcript: this.getStringValue(altFields.transcript),
          confidence: this.getNumberValue(altFields.confidence),
        });
      });
    }

    return {
      transcript,
      words,
      alternatives,
      confidence,
      languageCode: this.getStringValue(fields.languageCode),
    };
  }

  private objectToValue(obj: any): any {
    const fields: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      
      if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (typeof value === 'number') {
        fields[key] = { numberValue: value };
      } else if (typeof value === 'boolean') {
        fields[key] = { boolValue: value };
      } else if (Array.isArray(value)) {
        fields[key] = { 
          listValue: { 
            values: value.map(v => this.objectToValue({ value: v }).value) 
          } 
        };
      } else if (typeof value === 'object') {
        fields[key] = { structValue: { fields: this.objectToValue(value) } };
      }
    }
    
    return fields;
  }

  private getStringValue(field: any): string {
    return field?.stringValue || '';
  }

  private getNumberValue(field: any): number {
    return field?.numberValue || 0;
  }

  private getListValue(field: any): any[] {
    return field?.listValue?.values || [];
  }

  validateConfig(config: TranscriptionConfig): void {
    if (!config.languageCode) {
      throw new Error('Language code is required for Vertex AI Speech');
    }

    if (!this.project) {
      throw new Error('Vertex AI project is not configured. Set VERTEX_AI_PROJECT_ID or GOOGLE_CLOUD_PROJECT_ID environment variable.');
    }

    if (!this.endpointId) {
      throw new Error('Vertex AI Speech endpoint ID is not configured. Set VERTEX_AI_SPEECH_ENDPOINT_ID environment variable.');
    }
  }
}