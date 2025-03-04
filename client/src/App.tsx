import { useRef, useEffect, useState } from 'react';
import Phaser from 'phaser';
import { GameScene } from './phaser/GameScene';
import './App.css';
import { ConnectWalletButton } from './components/ConnectWalletButton';
import { AavegotchiSelectList } from './components/AavegotchiSelectList';
import { PlayerStatsBars } from './components/PlayerStatsBars';
import { SelectedGotchiDisplay } from './components/SelectedGotchiDisplay';
import { Aavegotchi } from './phaser/FetchGotchis';

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;

function App() {
    const gameRef = useRef<Phaser.Game | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [gotchis, setGotchis] = useState<Aavegotchi[]>([]);
    const [selectedGotchi, setSelectedGotchi] = useState<Aavegotchi | null>(null);
    const [gameDimensions, setGameDimensions] = useState({ width: GAME_WIDTH, height: GAME_HEIGHT, left: 0, top: 0 });

    useEffect(() => {
        if (!containerRef.current) return;
    
        // Initialize Phaser game
        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: containerRef.current,
            scene: [GameScene],
            scale: {
                mode: Phaser.Scale.FIT,
                width: GAME_WIDTH,
                height: GAME_HEIGHT,
            },
            pixelArt: true,
        };
    
        if (!gameRef.current) {
            gameRef.current = new Phaser.Game(config);
            gameRef.current.registry.set('game', gameRef.current);
            gameRef.current.registry.set('initialState', 'worldOnly');
            gameRef.current.registry.set('account', null);
            gameRef.current.registry.set('gotchis', []);
            gameRef.current.registry.set('selectedGotchi', null);
        }
    
        const game = gameRef.current;
    
        const updateDimensions = () => {
            const canvas = game.canvas;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                setGameDimensions({
                    width: rect.width,
                    height: rect.height,
                    left: rect.left,
                    top: rect.top,
                });
            }
        };
    
        // Ensure UI positions correctly on first load
        setTimeout(updateDimensions, 50);  // Small delay to ensure Phaser canvas is ready
    
        let resizeTimeout: NodeJS.Timeout;
    
        const resizeHandler = () => {
            // Update UI instantly while resizing
            updateDimensions();
    
            const availableWidth = window.innerWidth;
            const availableHeight = window.innerHeight;
            const aspectRatio = 16 / 10;
            let newWidth = availableWidth;
            let newHeight = availableWidth / aspectRatio;
            if (newHeight > availableHeight) {
                newHeight = availableHeight;
                newWidth = newHeight * aspectRatio;
            }
    
            game.scale.resize(newWidth, newHeight);
    
            // Final correction after resize stops
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(updateDimensions, 100);
        };
    
        window.addEventListener('resize', resizeHandler);
        game.events.on('resize', resizeHandler);
    
        return () => {
            if (gameRef.current) {
                gameRef.current.destroy(true);
                gameRef.current = null;
            }
            window.removeEventListener('resize', resizeHandler);
            game.events.off('resize', resizeHandler);
        };
    }, []);
    
    const handleAccountChange = (newAccount: string | null, newGotchis: Aavegotchi[]) => {
        setAccount(newAccount);
        setGotchis(newGotchis);
        setSelectedGotchi(null); // Reset selection on wallet change
    };

    const handleSelectGotchi = (gotchi: Aavegotchi) => {
        setSelectedGotchi(gotchi);
    };

    // Calculate scaled rectangle dimensions and offset
    const scale = Math.min(gameDimensions.width / GAME_WIDTH, gameDimensions.height / GAME_HEIGHT);
    const rectWidth = 100 * scale;
    const rectHeight = 100 * scale;
    const offsetX = 10 * scale;
    const offsetY = 10 * scale;

    // Ensure rectangle stays within game window bounds, accounting for canvas position
    const maxX = gameDimensions.width - rectWidth;
    const maxY = gameDimensions.height - rectHeight;
    const finalX = Math.min(offsetX, maxX) + gameDimensions.left; // Add canvas left offset
    const finalY = Math.min(offsetY, maxY) + gameDimensions.top;  // Add canvas top offset

    return (
        <div ref={containerRef} className="game-container">
            <ConnectWalletButton
                gameRef={gameRef}
                onAccountChange={handleAccountChange}
                gameDimensions={gameDimensions}
            />
            {!selectedGotchi && gotchis.length > 0 && (
                <AavegotchiSelectList
                    gotchis={gotchis}
                    selectedGotchi={selectedGotchi}
                    onSelectGotchi={handleSelectGotchi}
                    gameDimensions={gameDimensions}
                    gameRef={gameRef}
                />
            )}
            <PlayerStatsBars gameRef={gameRef} gameDimensions={gameDimensions} />
            {selectedGotchi && (
                <SelectedGotchiDisplay selectedGotchi={selectedGotchi} gameDimensions={gameDimensions} />
            )}
        </div>
    );

    /*
    return (
        <div ref={containerRef} className="game-container">
            <div
                className="red-rectangle"
                style={{
                    width: `${rectWidth}px`,
                    height: `${rectHeight}px`,
                    left: `${finalX}px`,
                    top: `${finalY}px`,
                }}
            />
        </div>
    );
    */
}

export default App;