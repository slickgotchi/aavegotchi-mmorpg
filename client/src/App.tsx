import { useRef, useEffect, useState } from "react";
import Phaser from "phaser";
import { GameScene } from "./phaser/GameScene";
import "./App.css";
import { PlayerStatsBars } from "./components/PlayerStatsBars";
import { Aavegotchi } from "./phaser/FetchGotchis";
import { PlayerXPStatsHUD } from "./components/PlayerXPStatHUD";
import { LevelUpNotification } from "./components/LevelUpNotification";
import { DebugInfo } from "./components/DebugInfo";
import { IntroModal, PlayableCharacter } from "./components/IntroModal";
import { GameOverModal } from "./components/GameOverModal";

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

    const [levelUpData, setLevelUpData] = useState<{
        newLevel: number;
        newATK: number;
        gameXpOnCurrentLevel: number;
        gameXpTotalForNextLevel: number;
    } | null>(null);
    const [showIntroModal, setShowIntroModal] = useState(true);
    const [showGameOverModal, setShowGameOverModal] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;

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
        game.registry.events.on("levelUp", (data: any) => {
            setLevelUpData(data);
        });

        const checkGameOver = () => {
            const gameOver = game.registry.get("gameOver");
            if (gameOver && gameOver.isGameOver) {
                setShowGameOverModal(true);
                game.registry.set("gameOver", {
                    isGameOver: false,
                    message: null,
                    code: 0,
                });
            }
        };
        const intervalId = setInterval(checkGameOver, 100);

        return () => {
            if (gameRef.current) {
                gameRef.current.registry.events.off("levelUp");
                gameRef.current.registry.destroy(); // Destroy registry
                gameRef.current.destroy(true); // Destroy game
                const canvas = document.querySelector("#phaser-game canvas");
                if (canvas) canvas.remove(); // Remove canvas from DOM
                gameRef.current = null;
            }
            clearInterval(intervalId);

            window.location.reload();
        };
    }, []);

    const handlePlay = (playableCharacter: PlayableCharacter) => {
        setShowIntroModal(false);
        const scene = gameRef.current?.scene.getScenes()[0] as
            | GameScene
            | undefined;
        if (scene) {
            console.log("spawnPlayerCharacter");
            scene.spawnPlayerCharacter(playableCharacter);
        }
    };

    const handleReplay = () => {
        console.log("handleReplay()");
        setShowIntroModal(true);
        setShowGameOverModal(false);
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
            {showIntroModal && (
                <IntroModal
                    onPlay={handlePlay}
                    // gameDimensions={gameDimensions}
                />
            )}

            {showGameOverModal && <GameOverModal onReplay={handleReplay} />}

            <PlayerStatsBars gameRef={gameRef} />

            <PlayerXPStatsHUD gameRef={gameRef} levelUpData={levelUpData} />
            <DebugInfo gameRef={gameRef} />
            {levelUpData && (
                <LevelUpNotification
                    gameRef={gameRef}
                    levelUpData={levelUpData}
                    onComplete={handleLevelUpComplete}
                />
            )}
        </div>
    );
}

export default App;
