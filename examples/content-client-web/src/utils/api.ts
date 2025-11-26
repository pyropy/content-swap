import type { ContentItem, Invoice, Commitment } from '../types';

export async function fetchCatalog(serverUrl: string): Promise<ContentItem[]> {
  const response = await fetch(`${serverUrl}/catalog`);
  const data = await response.json();
  return data.catalog || [];
}

export async function fetchServerInfo(serverUrl: string): Promise<{ address: string; defaultDeposit: string }> {
  const response = await fetch(`${serverUrl}/server-info`);
  const data = await response.json();
  if (!data.success) throw new Error('Failed to fetch server info');
  return { address: data.address, defaultDeposit: data.defaultDeposit };
}

export async function fetchContract(serverUrl: string): Promise<{ abi: unknown[]; bytecode: string }> {
  const response = await fetch(`${serverUrl}/contract`);
  const data = await response.json();
  if (!data.success) throw new Error('Failed to fetch contract');
  return { abi: data.abi, bytecode: data.bytecode };
}

export async function requestContent(
  serverUrl: string,
  contentId: string,
  channelAddress: string,
  aliceAddress: string
): Promise<{ invoice: Invoice }> {
  const response = await fetch(`${serverUrl}/request-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentId,
      channelAddress,
      aliceAddress,
    }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Request content failed');
  return { invoice: data.invoice };
}

export async function submitCommitment(
  serverUrl: string,
  invoiceId: string,
  commitment: Commitment,
  aliceSignature: string,
  aliceRevocationHash: string
): Promise<{ bobSignature: string; revocationSecret: string }> {
  const response = await fetch(`${serverUrl}/submit-commitment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId,
      commitment,
      aliceSignature,
      aliceRevocationHash,
    }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Submission failed');
  return { bobSignature: data.bobSignature, revocationSecret: data.revocationSecret };
}

export async function registerChannel(
  serverUrl: string,
  channelAddress: string,
  clientAddress: string
): Promise<{ totalBalance: string; depositA: string; depositB: string }> {
  const response = await fetch(`${serverUrl}/register-channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelAddress, clientAddress }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Channel registration failed');
  return { totalBalance: data.totalBalance, depositA: data.depositA, depositB: data.depositB };
}

export async function requestCloseChannel(
  serverUrl: string,
  channelAddress: string,
  balanceA: string,
  balanceB: string
): Promise<{ bobSignature: string; closeHash: string }> {
  const response = await fetch(`${serverUrl}/close-channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelAddress, balanceA, balanceB }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Close request failed');
  return { bobSignature: data.bobSignature, closeHash: data.closeHash };
}

export async function signInitialCommitment(
  serverUrl: string,
  channelAddress: string,
  clientAddress: string,
  clientDeposit: string,
  commitmentHash: string,
  clientSignature: string,
  clientRevocationHash: string
): Promise<{ serverSignature: string; serverRevocationHash: string }> {
  const response = await fetch(`${serverUrl}/sign-initial-commitment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelAddress,
      clientAddress,
      clientDeposit,
      commitmentHash,
      clientSignature,
      clientRevocationHash,
    }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Failed to get server signature');
  return { serverSignature: data.serverSignature, serverRevocationHash: data.serverRevocationHash };
}
