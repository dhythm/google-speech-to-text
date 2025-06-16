export interface TranscriptionConfig {
  provider: 'google-speech' | 'vertex-ai';
  languageCode: string;
  encoding?: AudioEncoding;
  sampleRateHertz?: number;
  enableAutomaticPunctuation?: boolean;
  enableWordTimeOffsets?: boolean;
  enableWordConfidence?: boolean;
  model?: string;
  useEnhanced?: boolean;
  maxAlternatives?: number;
  profanityFilter?: boolean;
  speechContexts?: SpeechContext[];
  diarizationConfig?: DiarizationConfig;
  metadata?: RecognitionMetadata;
}

export enum AudioEncoding {
  ENCODING_UNSPECIFIED = 'ENCODING_UNSPECIFIED',
  LINEAR16 = 'LINEAR16',
  FLAC = 'FLAC',
  MULAW = 'MULAW',
  AMR = 'AMR',
  AMR_WB = 'AMR_WB',
  OGG_OPUS = 'OGG_OPUS',
  SPEEX_WITH_HEADER_BYTE = 'SPEEX_WITH_HEADER_BYTE',
  MP3 = 'MP3',
  WEBM_OPUS = 'WEBM_OPUS',
}

export interface SpeechContext {
  phrases: string[];
  boost?: number;
}

export interface DiarizationConfig {
  enableSpeakerDiarization: boolean;
  minSpeakerCount?: number;
  maxSpeakerCount?: number;
}

export interface RecognitionMetadata {
  interactionType?: InteractionType;
  industryNaicsCodeOfAudio?: number;
  microphoneDistance?: MicrophoneDistance;
  originalMediaType?: OriginalMediaType;
  recordingDeviceType?: RecordingDeviceType;
  recordingDeviceName?: string;
  originalMimeType?: string;
  audioTopic?: string;
}

export enum InteractionType {
  INTERACTION_TYPE_UNSPECIFIED = 'INTERACTION_TYPE_UNSPECIFIED',
  DISCUSSION = 'DISCUSSION',
  PRESENTATION = 'PRESENTATION',
  PHONE_CALL = 'PHONE_CALL',
  VOICEMAIL = 'VOICEMAIL',
  PROFESSIONALLY_PRODUCED = 'PROFESSIONALLY_PRODUCED',
  VOICE_SEARCH = 'VOICE_SEARCH',
  VOICE_COMMAND = 'VOICE_COMMAND',
  DICTATION = 'DICTATION',
}

export enum MicrophoneDistance {
  MICROPHONE_DISTANCE_UNSPECIFIED = 'MICROPHONE_DISTANCE_UNSPECIFIED',
  NEARFIELD = 'NEARFIELD',
  MIDFIELD = 'MIDFIELD',
  FARFIELD = 'FARFIELD',
}

export enum OriginalMediaType {
  ORIGINAL_MEDIA_TYPE_UNSPECIFIED = 'ORIGINAL_MEDIA_TYPE_UNSPECIFIED',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
}

export enum RecordingDeviceType {
  RECORDING_DEVICE_TYPE_UNSPECIFIED = 'RECORDING_DEVICE_TYPE_UNSPECIFIED',
  SMARTPHONE = 'SMARTPHONE',
  PC = 'PC',
  PHONE_LINE = 'PHONE_LINE',
  VEHICLE = 'VEHICLE',
  OTHER_OUTDOOR_DEVICE = 'OTHER_OUTDOOR_DEVICE',
  OTHER_INDOOR_DEVICE = 'OTHER_INDOOR_DEVICE',
}

export interface TranscriptionResult {
  transcript: string;
  words?: WordInfo[];
  alternatives?: Alternative[];
  languageCode?: string;
  confidence?: number;
  duration?: number;
  speakerTags?: SpeakerTag[];
}

export interface WordInfo {
  word: string;
  startTime: number;
  endTime: number;
  confidence?: number;
  speakerTag?: number;
}

export interface Alternative {
  transcript: string;
  confidence?: number;
  words?: WordInfo[];
}

export interface SpeakerTag {
  speakerTag: number;
  startTime: number;
  endTime: number;
}

export interface AudioChunk {
  buffer: Buffer;
  startTime: number;
  endTime: number;
  index: number;
}

export interface ProcessingOptions {
  chunkDuration?: number; // in seconds, default 59 for < 1min limit
  overlap?: number; // overlap in seconds between chunks
  outputFormat?: OutputFormat;
  outputPath?: string;
  tempDir?: string;
  verbose?: boolean;
}

export enum OutputFormat {
  JSON = 'json',
  SRT = 'srt',
  VTT = 'vtt',
  TXT = 'txt',
  CSV = 'csv',
}

export interface TranscriptionProvider {
  name: string;
  transcribe(audioPath: string, config: TranscriptionConfig): Promise<TranscriptionResult>;
  transcribeChunk(chunk: AudioChunk, config: TranscriptionConfig): Promise<TranscriptionResult>;
  validateConfig(config: TranscriptionConfig): void;
}

export interface CLIOptions {
  input: string;
  output?: string;
  provider: 'google-speech' | 'vertex-ai';
  language: string;
  format?: OutputFormat;
  config?: string;
  verbose?: boolean;
  chunkDuration?: number;
  projectId?: string;
  location?: string;
  keyFile?: string;
}