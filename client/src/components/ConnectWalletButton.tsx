import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { fetchAavegotchis, Aavegotchi, calculateBRS } from '../phaser/FetchGotchis';
import { Game } from 'phaser';

interface ConnectWalletButtonProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    onAccountChange: (account: string | null, gotchis: Aavegotchi[]) => void;
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function ConnectWalletButton({ gameRef, onAccountChange, gameDimensions }: ConnectWalletButtonProps) {
    const [isConnected, setIsConnected] = useState(false);
    const [account, setAccount] = useState<string | null>(null);

    const connectWallet = useCallback(async () => {
        if (window.ethereum) {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum);
                const accounts = await provider.send('eth_requestAccounts', []);
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x89' }],
                });
                const gotchis = await fetchAavegotchis(accounts[0]);
                gotchis.sort((a, b) => calculateBRS(b.modifiedNumericTraits) - calculateBRS(a.modifiedNumericTraits));
                setAccount(accounts[0]);
                setIsConnected(true);
                onAccountChange(accounts[0], gotchis);
                if (gameRef.current) {
                    gameRef.current.registry.set('account', accounts[0]);
                    gameRef.current.registry.set('gotchis', gotchis);
                }
            } catch (err) {
                console.error('Wallet connection or Gotchi fetch failed:', err.message || err);
            }
        } else {
            console.error('MetaMask not detected');
        }
    }, [gameRef, onAccountChange]);

    // Scale button dimensions and position
    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200); // Using GAME_WIDTH and GAME_HEIGHT
    const buttonWidth = 250 * scale;
    const buttonHeight = 50 * scale;
    const offsetX = 20 * scale; // Margin from right
    const offsetY = 20 * scale; // Margin from top
    const finalX = gameDimensions.width - buttonWidth - offsetX + gameDimensions.left;
    const finalY = offsetY + gameDimensions.top;

    return (
        <button
            style={{
                position: 'absolute',
                width: `${buttonWidth}px`,
                height: `${buttonHeight}px`,
                left: `${finalX}px`,
                top: `${finalY}px`,
                fontSize: `${24 * scale}px`,
                fontFamily: "Pixelar",
                zIndex: 2000, // Ensure above Phaser canvas
                pointerEvents: 'auto', // Allow interaction
            }}
            onClick={connectWallet}
        >
            {isConnected ? 'Connected' : 'Connect Wallet'}
        </button>
    );
}