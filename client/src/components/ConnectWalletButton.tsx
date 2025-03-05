import { useState, useCallback, useLayoutEffect } from 'react';
import { ethers } from 'ethers';
import { fetchAavegotchis, Aavegotchi, calculateBRS } from '../phaser/FetchGotchis';
import { Game } from 'phaser';
import { AavegotchiSelectList } from './AavegotchiSelectList'; // Adjust path as needed

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
    const buttonWidth = 250 * scale;
    const buttonHeight = 50 * scale;
    const offsetX = 20 * scale;
    const offsetY = 20 * scale;
    const finalX = gameDimensions.left + offsetX;
    const finalY = offsetY + gameDimensions.top;

    console.log("Rendering - isConnected:", isConnected, "isFetching:", isFetching, "gotchis length:", gotchis.length);

    return (
        <div
            style={{
                position: 'absolute',
                right: `${finalX}px`,
                top: `${finalY}px`,
                zIndex: 2000,
                pointerEvents: 'auto',
            }}
        >
            {!isConnected && (
                <button
                    style={{
                        width: `${buttonWidth}px`,
                        height: `${buttonHeight}px`,
                        fontSize: `${24 * scale}px`,
                        fontFamily: "Pixelar",
                    }}
                    onClick={connectWallet}
                >
                    Connect Wallet
                </button>
            )}
            {isConnected && (
                <>
                    <button
                        style={{
                            width: `${buttonWidth}px`,
                            height: `${buttonHeight}px`,
                            fontSize: `${24 * scale}px`,
                            fontFamily: "Pixelar",
                            opacity: 0.5, // Greyed out effect
                        }}
                        disabled
                    >
                        Connected
                    </button>
                    {isFetching ? (
                        <div
                        style={{
                            position: 'absolute',
                            width: `${450 * scale}px`,
                            top: `${buttonHeight + 10 * scale}px`,
                            right: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            color: 'white',
                            fontFamily: 'Pixelar',
                            fontSize: `${24 * scale}px`,
                            padding: `${20 * scale}px`,
                            textAlign: 'center',
                        }}
                        >
                            Fetching Gotchis...
                        </div>
                    ) : gotchis.length === 0 ? (
                        <div
                            style={{
                                position: 'absolute',
                                width: `${450 * scale}px`,
                                top: `${buttonHeight + 10 * scale}px`,
                                right: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                color: 'white',
                                fontFamily: 'Pixelar',
                                fontSize: `${24 * scale}px`,
                                padding: `${20 * scale}px`,
                                textAlign: 'center',
                            }}
                        >
                            No gotchis were found on wallet 
                            <br />
                            {account} 
                            <br /><br />
                            You can rent or purchase a gotchi at{' '}
                            <a
                                href="https://dapp.aavegotchi.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#00ffff', textDecoration: 'underline' }}
                            >
                                dapp.aavegotchi.com
                            </a>
                        </div>
                    ) : (
                        <AavegotchiSelectList
                            gotchis={gotchis}
                            selectedGotchi={selectedGotchi}
                            onSelectGotchi={handleSelectGotchi}
                            gameDimensions={gameDimensions}
                            gameRef={gameRef}
                        />
                    )}
                </>
            )}
        </div>
    );
}