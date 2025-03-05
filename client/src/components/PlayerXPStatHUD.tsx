import { useEffect, useState } from 'react';
import { Game } from 'phaser';
import { Player } from '../phaser/GameScene';

interface PlayerXPStatsProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function PlayerXPStatsHUD({ gameRef, gameDimensions }: PlayerXPStatsProps) {
    const [playerXPStats, setPlayerXPStats] = useState<Player | null>(null);

    useEffect(() => {
        const updateStats = () => {
            if (gameRef.current) {
                const gameScene = gameRef.current.scene.getScene('GameScene') as any;
                if (gameScene && gameScene.getPlayers && gameScene.getLocalPlayerID) {
                    const players = gameScene.getPlayers();
                    const localPlayerId = gameScene.getLocalPlayerID();
                    if (players && localPlayerId && players[localPlayerId]) {
                        // Create a new object to ensure React detects the change
                        const newStats = { ...players[localPlayerId] };
                        console.log(newStats.gameLevel);
                        setPlayerXPStats(newStats);
                    }
                }
            }
        };

        // Poll for changes
        const interval = setInterval(updateStats, 100);
        return () => clearInterval(interval);
    }, [gameRef]);

    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    // Use a fixed base width scaled by max values, not arbitrary 450 * 32
    const barPadding = 4 * scale;

    const xpFillBarWidth = 800 * scale; // Base width for visual consistency
    const xpFillBarHeight = 32 * scale;
    const xpBgBarWidth = xpFillBarWidth + 2*barPadding;  // Static width for HP background
    const xpBgBarHeight = xpFillBarHeight + 2*barPadding;

    const levelFillBarWidth = 64 * scale; // Base width for visual consistency
    const levelFillBarHeight = 48 * scale;
    const levelBgBarWidth = levelFillBarWidth + 2*barPadding;  // Static width for HP background
    const levelBgBarHeight = levelFillBarHeight + 2*barPadding;

    const margin = 10 * scale;

    if (!playerXPStats) return null;

    // temp data for laying out the visuals
    // playerXPStats.level = 72;
    // playerXPStats.xp_total = 1000;
    // playerXPStats.xp_onCurrentLevel = 55;
    // playerXPStats.xp_totalForNextLevel = 100;

    const shadow = 0*scale;
    const blur = 3*scale;
    const textShadow = `${shadow}px ${shadow}px ${blur}px rgba(0,0,0,1)`;

    // console.log(playerXPStats.gameLevel);

    return (
        <div
            style={{
                position: 'absolute',
                left: `${gameDimensions.left+margin}px`,
                top: `${gameDimensions.top+margin}px`,
                zIndex: 2000,
                fontFamily: 'Pixelar',
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    width: `${levelBgBarWidth}px`, // 2px extra on each side
                    height: `${levelBgBarHeight}px`, // 2px extra above and below
                    top: 0,
                    left: 0,
                }}
            >
                {/* Background Rectangle */}
                <div
                    style={{
                        position: 'absolute',
                        top: 0, // Offset to extend beyond colored bar
                        left: 0,

                        // width: `${levelBgBarWidth}px`,
                        // height: `${levelBgBarHeight}px`,
                        width: '100%',
                        height: '100%',
                        backgroundColor: '#333333', // Dark grey, you can use 'black' if preferred
                    }}
                />
                {/* Fill Bar */}
                <div
                    style={{
                        position: 'absolute',
                        width: `${levelFillBarWidth}px`,
                        height: `${levelFillBarHeight}px`,
                        backgroundColor: '#ffcd75',
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* Text */}
                <span
                    style={{
                        position: 'absolute',
                        top: `${levelBgBarHeight*0.15}px`,
                        left: 0,

                        width: '100%',
                        height: '100%',

                        color: 'white',
                        fontSize: `${levelBgBarHeight*0.7}px`,
                        fontFamily: 'Pixelar', // Ensure it's properly loaded

                        textShadow: textShadow, // Outline effect
                    }}
                >
                    {playerXPStats.gameLevel}
                </span>
            </div>

            {/* XP Bar and Text */}
            <div
                style={{
                    position: 'absolute',
                    top: levelBgBarHeight/2 - xpBgBarHeight/2,
                    left: levelBgBarWidth-barPadding,
                    width: `${xpBgBarWidth}px`, // 2px extra on each side
                    height: `${xpBgBarHeight}px`, // 2px extra above and below
                }}
            >
                {/* Background Rectangle */}
                <div
                    style={{
                        position: 'absolute',
                        width: `${xpBgBarWidth}px`,
                        height: `${xpBgBarHeight}px`,
                        backgroundColor: '#333333', // Dark grey
                        top: 0,
                        left: 0,
                    }}
                />
                {/* XP fill Bar */}
                <div
                    style={{
                        position: 'absolute',
                        width: `${xpFillBarWidth * (playerXPStats.gameXpOnCurrentLevel / playerXPStats.gameXpTotalForNextLevel)}px`,
                        height: `${xpFillBarHeight}px`,
                        backgroundColor: '#ffcd75',
                        transition: 'width 0.2s',
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* Text */}
                <span
                    style={{
                        position: 'absolute',
                        top: barPadding,
                        left: barPadding,

                        width: `${xpBgBarWidth}px`,
                        height: `${xpBgBarHeight}px`,

                        color: 'white',
                        fontSize: `${xpFillBarHeight}px`,
                        fontFamily: 'Pixelar', // Ensure it's properly loaded

                        textShadow: textShadow, // Outline effect
                    }}
                >
                    {Math.floor(playerXPStats.gameXpOnCurrentLevel)} / {playerXPStats.gameXpTotalForNextLevel}
                </span>
            </div>
        </div>
    );
}