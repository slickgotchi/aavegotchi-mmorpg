import { useState, useCallback, useLayoutEffect } from 'react';
import { ethers } from 'ethers';
import { fetchAavegotchis, Aavegotchi, calculateBRS } from '../phaser/FetchGotchis';
import { Game } from 'phaser';
import { AavegotchiSelectList } from './AavegotchiSelectList'; // Adjust path as needed
import './ConnectWalletButton.css'

interface ConnectWalletButtonProps {
  gameRef: React.MutableRefObject<Phaser.Game | null>;
  onAccountChange: (account: string | null, gotchis: Aavegotchi[]) => void;
  gameDimensions: { width: number; height: number; left: number; top: number };
}

export function ConnectWalletButton({ gameRef, onAccountChange, gameDimensions }: ConnectWalletButtonProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [gotchis, setGotchis] = useState<Aavegotchi[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [selectedGotchi, setSelectedGotchi] = useState<Aavegotchi | null>(null);

  const connectWallet = useCallback(async () => {
    if (window.ethereum) {
      try {
        console.log("Attempting wallet connection...");
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x89' }],
        });
        setAccount(accounts[0]);
        setIsConnected(true);
        setIsFetching(true);
        console.log("Fetching gotchis for account:", accounts[0]);
        const fetchedGotchis = await fetchAavegotchis(accounts[0]);
        console.log("Fetched gotchis:", fetchedGotchis);
        fetchedGotchis.sort((a, b) => calculateBRS(b.modifiedNumericTraits) - calculateBRS(a.modifiedNumericTraits));
        setGotchis(fetchedGotchis);
        setIsFetching(false);
        onAccountChange(accounts[0], fetchedGotchis);
        if (gameRef.current) {
          gameRef.current.registry.set('account', accounts[0]);
          gameRef.current.registry.set('gotchis', fetchedGotchis);
        }
      } catch (err: any) {
        console.error('Wallet connection or Gotchi fetch failed:', err.message || err);
        setIsFetching(false);
        setIsConnected(false); // Reset on failure to allow retry
      }
    } else {
      console.error('MetaMask not detected');
    }
  }, [gameRef, onAccountChange]);

  const handleSelectGotchi = useCallback((gotchi: Aavegotchi) => {
    setSelectedGotchi(gotchi);
    console.log("Selected gotchi:", gotchi);
  }, []);


  const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);

  const isActive = false;

  return (
    <div>
      <div className={`btn btn-small + ${isActive ? "" : "btn-inactive"}`} >
        Connect Wallet
      </div>
    </div>
  );
}