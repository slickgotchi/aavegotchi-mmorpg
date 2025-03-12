import { useRef, useEffect, useState } from "react";
import Phaser from "phaser";
import { GameScene } from "./phaser/GameScene";
import "./App.css";
import { ConnectWalletButton } from "./components/ConnectWalletButton";
import { AavegotchiSelectList } from "./components/AavegotchiSelectList";
import { PlayerStatsBars } from "./components/PlayerStatsBars";
import { SelectedGotchiDisplay } from "./components/SelectedGotchiDisplay";
import { Aavegotchi } from "./phaser/FetchGotchis";
import { PlayerXPStatsHUD } from "./components/PlayerXPStatHUD";
import { LevelUpNotification } from "./components/LevelUpNotification";
import { DebugInfo } from "./components/DebugInfo";
import { IntroModal, PlayableCharacter } from "./components/IntroModal";

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;

function App() {
    const gameRef = useRef<Phaser.Game | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [account, setAccount] = useState<string | null>(null);
    const [gotchis, setGotchis] = useState<Aavegotchi[]>([]);
    const [selectedGotchi, setSelectedGotchi] = useState<Aavegotchi | null>(
        null
    );
    const [gameDimensions, setGameDimensions] = useState({
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        left: 0,
        top: 0,
    });
    const [levelUpData, setLevelUpData] = useState<{
        newLevel: number;
        newATK: number;
        gameXpOnCurrentLevel: number;
        gameXpTotalForNextLevel: number;
    } | null>(null);
    const [ws, setWs] = useState<WebSocket | null>(null); // Track WebSocket
    const [showModal, setShowModal] = useState(true);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize Phaser game
        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: containerRef.current,
            scene: [GameScene],
            scale: {
                mode: Phaser.Scale.ENVELOP,
                width: GAME_WIDTH,
                height: GAME_HEIGHT,
                autoCenter: Phaser.Scale.CENTER_BOTH,
            },
            pixelArt: true,
        };

        if (!gameRef.current) {
            gameRef.current = new Phaser.Game(config);
            gameRef.current.registry.set("game", gameRef.current);
            gameRef.current.registry.set("initialState", "worldOnly");
            gameRef.current.registry.set("account", null);
            gameRef.current.registry.set("gotchis", []);
            gameRef.current.registry.set("selectedGotchi", null);
        }

        const game = gameRef.current;

        // // Initialize WebSocket (similar to GameScene)
        // const websocket = new WebSocket('ws://localhost:8080/ws');
        // websocket.onopen = () => {
        //     console.log('WebSocket connected in App');
        //     setWs(websocket);
        // };
        // websocket.onclose = () => {
        //     console.log('WebSocket closed in App');
        //     setWs(null);
        // };

        // Listen for level-up event from Phaser
        game.registry.events.on("levelUp", (data: any) => {
            setLevelUpData(data);
        });

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
        setTimeout(updateDimensions, 50); // Small delay to ensure Phaser canvas is ready

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
            resizeTimeout = setTimeout(updateDimensions, 250);
        };

        window.addEventListener("resize", resizeHandler);
        game.events.on("resize", resizeHandler);

        return () => {
            if (gameRef.current) {
                gameRef.current.destroy(true);
                gameRef.current = null;
            }
            window.removeEventListener("resize", resizeHandler);
            game.events.off("resize", resizeHandler);
            game.registry.events.off("levelUp"); // Cleanup
        };
    }, []);

    const handlePlay = (playableCharacter: PlayableCharacter) => {
        setShowModal(false);
        const scene = gameRef.current?.scene.getScenes()[0] as
            | GameScene
            | undefined;
        if (scene) {
            // connect to the websocket
            const ws = new WebSocket("ws://localhost:8080/ws");
            scene.startWebSocketConnection(ws, playableCharacter);
        }
    };

    const handleAccountChange = (
        newAccount: string | null,
        newGotchis: Aavegotchi[]
    ) => {
        setAccount(newAccount);
        setGotchis(newGotchis);
        setSelectedGotchi(null); // Reset selection on wallet change
    };

    const handleSelectGotchi = (gotchi: Aavegotchi) => {
        setSelectedGotchi(gotchi);
    };

    const handleLevelUpComplete = () => {
        setLevelUpData(null); // Clear level-up notification after animation
    };

    return (
        <div ref={containerRef} className="game-container">
            {showModal && (
                <IntroModal
                    onPlay={handlePlay}
                    gameDimensions={gameDimensions}
                />
            )}

            {!selectedGotchi && gotchis.length > 0 && (
                <AavegotchiSelectList
                    gotchis={gotchis}
                    selectedGotchi={selectedGotchi}
                    onSelectGotchi={handleSelectGotchi}
                    gameDimensions={gameDimensions}
                    gameRef={gameRef}
                />
            )}
            <PlayerStatsBars
                gameRef={gameRef}
                gameDimensions={gameDimensions}
            />
            {selectedGotchi && (
                <SelectedGotchiDisplay
                    selectedGotchi={selectedGotchi}
                    gameDimensions={gameDimensions}
                />
            )}
            <PlayerXPStatsHUD
                gameRef={gameRef}
                levelUpData={levelUpData}
                gameDimensions={gameDimensions}
            />
            <DebugInfo
                gameRef={gameRef}
                ws={ws}
                gameDimensions={gameDimensions}
            />
            {levelUpData && (
                <LevelUpNotification
                    gameRef={gameRef}
                    levelUpData={levelUpData}
                    onComplete={handleLevelUpComplete}
                    gameDimensions={gameDimensions}
                />
            )}
        </div>
    );
}

export default App;
