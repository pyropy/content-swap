import { useState, useCallback } from 'react';
import type { Abi } from 'viem';
import * as api from '../utils/api';

export interface UseServerOptions {
  onLog?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
}

export function useServer(options: UseServerOptions = {}) {
  const { onLog } = options;

  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [serverAddress, setServerAddress] = useState<string | null>(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [contractAbi, setContractAbi] = useState<Abi | null>(null);
  const [contractBytecode, setContractBytecode] = useState<string | null>(null);

  const log = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    onLog?.(message, type);
  }, [onLog]);

  const loadServerInfo = useCallback(async () => {
    try {
      log('Fetching server info...', 'info');
      const info = await api.fetchServerInfo(serverUrl);
      setServerAddress(info.address);
      log(`Server address: ${info.address}`, 'success');

      const contract = await api.fetchContract(serverUrl);
      setContractAbi(contract.abi as Abi);
      setContractBytecode(contract.bytecode);
      log('Contract loaded', 'success');

      setServerConnected(true);
      return { serverAddress: info.address, defaultDeposit: info.defaultDeposit };
    } catch (error) {
      setServerConnected(false);
      log(`Failed to fetch server info: ${(error as Error).message}`, 'error');
      throw error;
    }
  }, [serverUrl, log]);

  return {
    serverUrl,
    setServerUrl,
    serverAddress,
    serverConnected,
    contractAbi,
    contractBytecode,
    loadServerInfo,
  };
}
