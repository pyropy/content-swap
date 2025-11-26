function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export async function decryptContent(encryptedData: string, revocationSecret: string): Promise<string> {
  const parts = encryptedData.split(':');
  const ivBytes = hexToBytes(parts[0]);
  const authTag = hexToBytes(parts[1]);
  const encrypted = hexToBytes(parts[2]);

  const keyMaterial = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(revocationSecret)
  );

  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Combine encrypted data with auth tag for AES-GCM
  const combined = new ArrayBuffer(encrypted.length + authTag.length);
  const combinedView = new Uint8Array(combined);
  combinedView.set(encrypted, 0);
  combinedView.set(authTag, encrypted.length);

  // Create proper ArrayBuffer for IV
  const iv = new ArrayBuffer(ivBytes.length);
  new Uint8Array(iv).set(ivBytes);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}
