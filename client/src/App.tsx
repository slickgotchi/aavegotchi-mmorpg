import { useRef, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import Phaser from 'phaser';
import { GameScene } from './phaser/GameScene';
import { fetchAavegotchis, Aavegotchi, calculateBRS } from './phaser/FetchGotchis';
import { UIScene } from './phaser/UIScene';

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;

function App() {
    const gameRef = useRef<Phaser.Game | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [gotchis, setGotchis] = useState<Aavegotchi[]>([]);
    const [selectedGotchi, setSelectedGotchi] = useState<Aavegotchi | null>(null);
    const [gameDimensions, setGameDimensions] = useState({ width: GAME_WIDTH, height: GAME_HEIGHT });

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize Phaser game with both GameScene and UIScene to handle UI in Phaser
        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: containerRef.current,
            scene: [GameScene, UIScene], // Add UIScene for UI management
            scale: {
                mode: Phaser.Scale.NONE, // Preserve existing scale mode as requested
                // autoCenter: Phaser.Scale.CENTER_HORIZONTALLY
            },
            pixelArt: true,
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
    

    return (
            <div ref={containerRef} style={{ width: '1920px', height: '1200px' }} />
    );
}

export default App;