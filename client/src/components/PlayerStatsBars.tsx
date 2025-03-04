import { useEffect, useState } from 'react';
import { Game } from 'phaser';

interface Player {
    hp: number;
    maxHp: number;
    ap: number;
    maxAp: number;
}

interface PlayerStatsBarsProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function PlayerStatsBars({ gameRef, gameDimensions }: PlayerStatsBarsProps) {
    const [playerStats, setPlayerStats] = useState<Player | null>(null);

    useEffect(() => {
        const updateStats = () => {
            if (gameRef.current) {
                const gameScene = gameRef.current.scene.getScene('GameScene') as any; // Adjust type if needed
                if (gameScene && gameScene.getPlayers && gameScene.getLocalPlayerID) {
                    const players = gameScene.getPlayers();
                    const localPlayerId = gameScene.getLocalPlayerID();
                    if (players && localPlayerId && players[localPlayerId]) {
                        setPlayerStats(players[localPlayerId]);
                    }
                }
            }
        };

        // Poll or listen for changes (simplified polling for now)
        const interval = setInterval(updateStats, 100);
        return () => clearInterval(interval);
    }, [gameRef]);

    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    const barWidth = 450 * scale;
    const barHeight = 32 * scale;
    const offsetX = 20 * scale;
    const offsetY = 20 * scale;
    const finalX = offsetX + gameDimensions.left;
    const finalY = gameDimensions.height - offsetY + gameDimensions.top;

    if (!playerStats) return null;

    return (
        <div
            style={{
                position: 'absolute',
                left: `${finalX}px`,
                top: `${finalY - barHeight * 2 - 10 * scale}px`, // Stack HP above AP
                zIndex: 2000,
                display: 'flex',
                flexDirection: 'column',
                gap: `${10 * scale}px`, // Space between HP and AP bars
                fontFamily: 'Pixelar'
            }}
        >
            {/* HP Bar and Text */}
            <div
                style={{
                    position: 'relative',
                    width: `${barWidth}px`,
                    height: `${barHeight}px`,
                }}
            >
                <div
                    style={{
                        width: `${barWidth * (playerStats.hp / playerStats.maxHp)}px`,
                        height: `${barHeight}px`,
                        backgroundColor: 'green',
                        transition: 'width 0.2s',
                    }}
                />
                <span
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)', // Center text horizontally and vertically
                        color: 'white',
                        fontSize: `${32 * scale}px`,
                        whiteSpace: 'nowrap', // Prevent text wrapping
                    }}
                >
                    {playerStats.hp}/{playerStats.maxHp}
                </span>
            </div>

            {/* AP Bar and Text */}
            <div
                style={{
                    position: 'relative',
                    width: `${barWidth}px`,
                    height: `${barHeight}px`,
                }}
            >
                <div
                    style={{
                        width: `${barWidth * (playerStats.ap / playerStats.maxAp)}px`,
                        height: `${barHeight}px`,
                        backgroundColor: 'blue',
                        transition: 'width 0.2s',
                    }}
                />
                <span
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)', // Center text horizontally and vertically
                        color: 'white',
                        fontSize: `${32 * scale}px`,
                        whiteSpace: 'nowrap', // Prevent text wrapping
                    }}
                >
                    {Math.floor(playerStats.ap)}/{playerStats.maxAp}
                </span>
            </div>
        </div>
    );
}