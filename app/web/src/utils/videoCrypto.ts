/**
 * Decrypt video segment data that was encrypted with AES-256-GCM using Web Crypto API
 */
export async function decryptSegment(encryptedData: string, revocationSecret: string): Promise<Uint8Array> {
  try {
    // Parse the combined encrypted data format: iv:authTag:encrypted
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = hexToBytes(parts[0]);
    const authTag = hexToBytes(parts[1]);
    const encrypted = hexToBytes(parts[2]);

    // Combine encrypted data with auth tag (required by Web Crypto API)
    const ciphertext = new Uint8Array(encrypted.length + authTag.length);
    ciphertext.set(encrypted);
    ciphertext.set(authTag, encrypted.length);

    // Derive key from revocation secret using SHA-256
    const encoder = new TextEncoder();
    const secretData = encoder.encode(revocationSecret);
    const hashBuffer = await crypto.subtle.digest('SHA-256', secretData);

    // Import the key for AES-GCM
    const key = await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt the data
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      ciphertext
    );

    // The decrypted data is base64 encoded, decode it
    const decoder = new TextDecoder();
    const base64String = decoder.decode(decryptedBuffer);

    // Convert base64 to binary
    return base64ToBytes(base64String);
  } catch (error) {
    console.error('Failed to decrypt segment:', error);
    throw new Error('Failed to decrypt video segment');
  }
}

/**
 * Helper function to convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Helper function to convert base64 to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Process response from server - detect if it's encrypted and decrypt if needed
 */
export async function processSegmentResponse(
  response: Response,
  revocationSecret?: string
): Promise<ArrayBuffer> {
  const isEncrypted = response.headers.get('X-Encrypted') === 'true';

  if (!isEncrypted) {
    // Return unencrypted data as-is
    return await response.arrayBuffer();
  }

  if (!revocationSecret) {
    throw new Error('Segment is encrypted but no decryption key available');
  }

  // Read encrypted data as text (it's sent as a combined string)
  const encryptedData = await response.text();

  // Decrypt and return as ArrayBuffer
  const decrypted = await decryptSegment(encryptedData, revocationSecret);
  return decrypted.buffer;
}