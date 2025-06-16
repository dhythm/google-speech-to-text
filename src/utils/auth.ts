import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

export class AuthHelper {
  private static tempCredentialFiles: string[] = [];

  /**
   * Prepares Google Cloud credentials from either a file path or base64-encoded string
   * @param credentialInput - Either a file path or base64-encoded JSON string
   * @returns Path to the credential file (may be temporary)
   */
  static prepareCredentials(credentialInput: string | undefined): string | undefined {
    if (!credentialInput) {
      return undefined;
    }

    // Check if it's already a file path
    if (this.isFilePath(credentialInput)) {
      if (!fs.existsSync(credentialInput)) {
        throw new Error(`Credential file not found: ${credentialInput}`);
      }
      return credentialInput;
    }

    // Otherwise, treat as base64-encoded string
    try {
      const decodedContent = Buffer.from(credentialInput, 'base64').toString('utf-8');
      
      // Validate JSON
      JSON.parse(decodedContent);
      
      // Create temporary file
      const tempDir = os.tmpdir();
      const tempFileName = `gcp-creds-${randomBytes(8).toString('hex')}.json`;
      const tempFilePath = path.join(tempDir, tempFileName);
      
      // Write with restricted permissions
      fs.writeFileSync(tempFilePath, decodedContent, {
        mode: 0o600, // Read/write for owner only
      });
      
      // Track for cleanup
      this.tempCredentialFiles.push(tempFilePath);
      
      return tempFilePath;
    } catch (error) {
      throw new Error(`Invalid credentials: Must be either a valid file path or base64-encoded JSON. Error: ${error}`);
    }
  }

  /**
   * Checks if a string looks like a file path
   */
  private static isFilePath(input: string): boolean {
    // Check if it's a path (contains .json or starts with / or ./ or ../ or C:\ etc.)
    return input.includes('.json') || 
           input.startsWith('/') || 
           input.startsWith('./') || 
           input.startsWith('../') ||
           /^[a-zA-Z]:\\/.test(input) || // Windows absolute path
           input.startsWith('~'); // Unix home directory
  }

  /**
   * Cleans up any temporary credential files created
   */
  static cleanup(): void {
    for (const filePath of this.tempCredentialFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.tempCredentialFiles = [];
  }

  /**
   * Gets credential configuration for Google Cloud clients
   */
  static getCredentialConfig(credentialInput: string | undefined): {
    keyFilename?: string;
    credentials?: any;
  } {
    if (!credentialInput) {
      return {};
    }

    const keyFilename = this.prepareCredentials(credentialInput);
    return keyFilename ? { keyFilename } : {};
  }

  /**
   * Validates that credentials contain required fields
   */
  static validateServiceAccountKey(credentialInput: string | undefined): void {
    if (!credentialInput) {
      return;
    }

    let jsonContent: string;
    
    if (this.isFilePath(credentialInput)) {
      if (!fs.existsSync(credentialInput)) {
        throw new Error(`Credential file not found: ${credentialInput}`);
      }
      jsonContent = fs.readFileSync(credentialInput, 'utf-8');
    } else {
      jsonContent = Buffer.from(credentialInput, 'base64').toString('utf-8');
    }

    try {
      const credentials = JSON.parse(jsonContent);
      
      // Validate required fields
      const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
      const missingFields = requiredFields.filter(field => !credentials[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Service account key missing required fields: ${missingFields.join(', ')}`);
      }
      
      if (credentials.type !== 'service_account') {
        throw new Error('Invalid credential type. Expected "service_account"');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON in credentials');
      }
      throw error;
    }
  }
}