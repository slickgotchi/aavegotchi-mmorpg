import { useRef, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import Phaser from 'phaser';
import { GameScene } from './phaser/GameScene';
import { fetchAavegotchis, Aavegotchi, calculateBRS } from './phaser/FetchGotchis';
import { UIScene } from './phaser/UIScene';

function App() {
    const gameRef = useRef<Phaser.Game | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [gotchis, setGotchis] = useState<Aavegotchi[]>([]);
    const [selectedGotchi, setSelectedGotchi] = useState<Aavegotchi | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize Phaser game with both GameScene and UIScene to handle UI in Phaser
        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: containerRef.current,
            scene: [GameScene, UIScene], // Add UIScene for UI management
            scale: {
                mode: Phaser.Scale.NONE, // Preserve existing scale mode as requested
            }
        };

        if (!gameRef.current) {
            gameRef.current = new Phaser.Game(config);
            // Set initial state to show the world even without a selected Gotchi
            gameRef.current.registry.set('initialState', 'worldOnly');
            gameRef.current.registry.set('account', null); // Initial account state
            gameRef.current.registry.set('gotchis', []); // Initial gotchis list
            gameRef.current.registry.set('selectedGotchi', null); // Initial selected Gotchi
        }

        return () => {
            if (gameRef.current) {
                gameRef.current.destroy(true);
                gameRef.current = null;
            }
        };
    }, []);

    const connectWallet = async () => {
        if (window.ethereum) {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum);
                const accounts = await provider.send('eth_requestAccounts', []);
                setAccount(accounts[0]);
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x89' }],
                });
                const gotchis = await fetchAavegotchis(accounts[0]);
                setGotchis(gotchis.sort((a, b) => calculateBRS(b.modifiedNumericTraits) - calculateBRS(a.modifiedNumericTraits)));
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
    };

    const selectGotchi = (gotchi: Aavegotchi) => {
        setSelectedGotchi(gotchi);
        if (gameRef.current) {
            gameRef.current.registry.set('selectedGotchi', gotchi); // Pass to Phaser
            gameRef.current.registry.set('initialState', 'spawnPlayer'); // Indicate player should spawn
            // Simulate joining the game—send join message via WebSocket
            const ws = new WebSocket('ws://localhost:8080/ws');
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'join', data: { gotchiID: gotchi.id } }));
                ws.close(); // Close after sending—GameScene handles the rest
            };
            ws.onclose = () => {
                console.log('WebSocket closed after join');
            };
        }
    };

    return (
        // <div style={{ position: 'relative', width: '1px', height: '800px' }}>
            <div ref={containerRef} style={{ width: '1920px', height: '1200px' }} />
        /* </div> */
    );
}

export default App;