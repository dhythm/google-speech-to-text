#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import { Transcriber } from './transcriber';
import { Config } from './config';
import { TranscriptionConfig, OutputFormat, CLIOptions } from './types';
import { AuthHelper } from './utils/auth';

const program = new Command();

program
  .name('speech-to-text')
  .description('Transcribe audio and video files using Google Cloud Speech-to-Text or Vertex AI')
  .version('1.0.0');

program
  .argument('<input>', 'Path to audio or video file')
  .option('-o, --output <path>', 'Output file path')
  .option('-p, --provider <provider>', 'Speech provider (google-speech or vertex-ai)', 'google-speech')
  .option('-l, --language <code>', 'Language code (e.g., ja-JP, en-US)', 'ja-JP')
  .option('-f, --format <format>', 'Output format (json, txt, srt, vtt, csv)')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--chunk-duration <seconds>', 'Duration of audio chunks in seconds', '59')
  .option('--max-concurrent <number>', 'Maximum concurrent chunk processing', '3')
  .option('--no-retry', 'Disable retry of failed chunks')
  .option('--project-id <id>', 'Google Cloud project ID')
  .option('--location <location>', 'Google Cloud location', 'us-central1')
  .option('--key-file <path>', 'Google Cloud service account key (file path or base64-encoded JSON)')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (input: string, options: CLIOptions) => {
    try {
      console.log(chalk.blue.bold('\n🎤 Speech-to-Text Transcription\n'));

      // Validate input file
      if (!fs.existsSync(input)) {
        throw new Error(`Input file not found: ${input}`);
      }

      // Set environment variables if provided
      if (options.projectId) {
        process.env.GOOGLE_CLOUD_PROJECT_ID = options.projectId;
      }
      if (options.location) {
        process.env.GOOGLE_CLOUD_LOCATION = options.location;
        process.env.VERTEX_AI_LOCATION = options.location;
      }
      if (options.keyFile) {
        // Support both file path and base64-encoded credentials
        process.env.GOOGLE_APPLICATION_CREDENTIALS = options.keyFile;
      }

      // Initialize config
      const config = Config.getInstance();
      
      // Load config file if provided
      if (options.config) {
        if (!fs.existsSync(options.config)) {
          throw new Error(`Config file not found: ${options.config}`);
        }
        config.loadFromFile(options.config);
      }

      // Build transcription config
      const transcriptionConfig: TranscriptionConfig = {
        provider: options.provider,
        languageCode: options.language,
        ...config.getTranscriptionConfig(),
      };

      // Build processing options
      const processingOptions = {
        ...config.getProcessingOptions(),
        chunkDuration: parseInt(String(options.chunkDuration || '59')),
        maxConcurrentChunks: parseInt(String(options.maxConcurrent || '3')),
        retryFailedChunks: !options.noRetry,
        verbose: options.verbose,
        outputPath: options.output,
        outputFormat: options.format as OutputFormat,
      };

      // Display configuration
      if (options.verbose) {
        console.log(chalk.gray('Configuration:'));
        console.log(chalk.gray(`  Provider: ${options.provider}`));
        console.log(chalk.gray(`  Language: ${options.language}`));
        console.log(chalk.gray(`  Input: ${input}`));
        if (options.output) {
          console.log(chalk.gray(`  Output: ${options.output}`));
        }
        console.log();
      }

      // Create transcriber
      const transcriber = new Transcriber(options.provider);

      // Transcribe file
      const result = await transcriber.transcribeFile(
        input,
        transcriptionConfig,
        processingOptions
      );

      // Display results
      console.log(chalk.green.bold('\n✅ Transcription Complete!\n'));

      if (!options.output || options.verbose) {
        console.log(chalk.white.bold('Transcript:'));
        console.log(chalk.white(result.transcript));
        
        if (result.confidence) {
          console.log(chalk.gray(`\nConfidence: ${(result.confidence * 100).toFixed(1)}%`));
        }
        
        if (result.words && result.words.length > 0) {
          console.log(chalk.gray(`Word count: ${result.words.length}`));
        }
      }

      if (options.output) {
        console.log(chalk.green(`\n📄 Output saved to: ${options.output}`));
      }

    } catch (error: any) {
      console.error(chalk.red.bold('\n❌ Error:'), chalk.red(error.message));
      
      if (options.verbose && error.stack) {
        console.error(chalk.gray('\nStack trace:'));
        console.error(chalk.gray(error.stack));
      }

      process.exit(1);
    } finally {
      // Clean up any temporary credential files
      AuthHelper.cleanup();
    }
  });

// Add examples command
program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.blue.bold('\n📚 Usage Examples:\n'));
    
    console.log(chalk.white('1. Basic transcription:'));
    console.log(chalk.gray('   speech-to-text audio.mp3'));
    
    console.log(chalk.white('\n2. Transcribe video with output:'));
    console.log(chalk.gray('   speech-to-text video.mp4 -o transcript.txt'));
    
    console.log(chalk.white('\n3. Use Vertex AI with Japanese:'));
    console.log(chalk.gray('   speech-to-text audio.wav -p vertex-ai -l ja-JP'));
    
    console.log(chalk.white('\n4. Generate SRT subtitles:'));
    console.log(chalk.gray('   speech-to-text video.mp4 -o subtitles.srt -f srt'));
    
    console.log(chalk.white('\n5. With Google Cloud credentials (file):'));
    console.log(chalk.gray('   speech-to-text audio.mp3 --project-id my-project --key-file ./key.json'));
    
    console.log(chalk.white('\n6. With base64-encoded credentials:'));
    console.log(chalk.gray('   speech-to-text audio.mp3 --key-file "$(base64 -i key.json)"'));
    
    console.log(chalk.white('\n7. Long file with parallel processing:'));
    console.log(chalk.gray('   speech-to-text long-audio.mp3 --max-concurrent 5 -v'));
    
    console.log(chalk.white('\n8. Using config file:'));
    console.log(chalk.gray('   speech-to-text audio.mp3 -c config.json'));
  });

// Add config template command
program
  .command('init-config')
  .description('Create a sample configuration file')
  .option('-o, --output <path>', 'Output path for config file', 'speech-config.json')
  .action((options) => {
    const configTemplate = {
      transcription: {
        languageCode: 'ja-JP',
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        model: 'latest_long',
        useEnhanced: true,
        speechContexts: [
          {
            phrases: ['固有名詞1', '固有名詞2'],
            boost: 10
          }
        ],
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2,
          maxSpeakerCount: 6
        }
      },
      processing: {
        chunkDuration: 59,
        overlap: 1,
        maxConcurrentChunks: 3,
        retryFailedChunks: true,
        maxRetries: 3,
        outputFormat: 'txt',
        verbose: false
      }
    };

    fs.writeFileSync(options.output, JSON.stringify(configTemplate, null, 2));
    console.log(chalk.green(`✅ Config template created: ${options.output}`));
  });

program.parse();