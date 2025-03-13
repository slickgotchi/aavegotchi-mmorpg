import { useEffect, useState } from "react";
import { Game } from "phaser";
import { Player } from "../phaser/Player";
import "./PlayerXPStatHUD.css";

interface PlayerXPStatsProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    levelUpData: {
        newLevel: number;
        newATK: number;
        gameXpOnCurrentLevel: number;
        gameXpTotalForNextLevel: number;
    } | null;
}

export function PlayerXPStatsHUD({ gameRef, levelUpData }: PlayerXPStatsProps) {
    const [playerXPStats, setPlayerXPStats] = useState<Player | null>(null);
    const [isFlashing, setIsFlashing] = useState(false); // State to trigger flash animation
    const [animationKey, setAnimationKey] = useState(0); // Unique key for animation to prevent re-triggering

    useEffect(() => {
        const updateStats = () => {
            if (gameRef.current) {
                const gameScene = gameRef.current.scene.getScene(
                    "GameScene"
                ) as any;
                if (
                    gameScene &&
                    gameScene.getPlayers &&
                    gameScene.getLocalPlayerID
                ) {
                    const players = gameScene.getPlayers();
                    const localPlayerId = gameScene.getLocalPlayerID();
                    if (players && localPlayerId && players[localPlayerId]) {
                        // Create a new object to ensure React detects the change
                        const newStats = { ...players[localPlayerId] };
                        setPlayerXPStats(newStats);
                    }
                }
            }
        };

        // Poll for changes
        const interval = setInterval(updateStats, 100);
        return () => clearInterval(interval);
    }, [gameRef, playerXPStats]); // Include playerXPStats to detect changes

    useEffect(() => {
        if (levelUpData) {
            console.log("Level Up! Triggering border flash");
            setIsFlashing(true);
            setAnimationKey((prev) => prev + 1); // Increment animation key to ensure unique animation
            const timer = setTimeout(() => {
                console.log("Border flash reset");
                setIsFlashing(false);
            }, 1000); // Flash for 1 second
            return () => clearTimeout(timer);
        }
    }, [levelUpData]);

    // Use a fixed base width scaled by max values, not arbitrary 450 * 32
    const barPadding = 2;

    const xpFillBarWidth = 300; // Base width for visual consistency
    const xpFillBarHeight = 16;
    const xpBgBarWidth = xpFillBarWidth + 2 * barPadding; // Static width for HP background
    const xpBgBarHeight = xpFillBarHeight + 2 * barPadding;

    const levelFillBarWidth = 32; // Base width for visual consistency
    const levelFillBarHeight = 24;
    const levelBgBarWidth = levelFillBarWidth + 2 * barPadding; // Static width for HP background
    const levelBgBarHeight = levelFillBarHeight + 2 * barPadding;

    const margin = 8;

    if (!playerXPStats) return null;

    // temp data for laying out the visuals
    // playerXPStats.level = 72;
    // playerXPStats.xp_total = 1000;
    // playerXPStats.xp_onCurrentLevel = 55;
    // playerXPStats.xp_totalForNextLevel = 100;

    const shadow = 0;
    const blur = 3;
    const textShadow = `${shadow}px ${shadow}px ${blur}px rgba(0,0,0,1)`;

    // console.log(playerXPStats.gameLevel);

    return (
        <div
            style={{
                position: "absolute",
                left: `${margin}px`,
                top: `${margin}px`,
                zIndex: 2000,
                fontFamily: "Pixelar",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    width: `${levelBgBarWidth}px`, // 2px extra on each side
                    height: `${levelBgBarHeight}px`, // 2px extra above and below
                    top: 0,
                    left: 0,
                }}
            >
                {/* Background Rectangle */}
                <div
                    key={`level-${animationKey}`} // Unique key to prevent animation re-triggering
                    className={isFlashing ? "flash-border" : ""}
                    style={{
                        position: "absolute",
                        top: 0, // Offset to extend beyond colored bar
                        left: 0,

                        width: "100%",
                        height: "100%",
                        backgroundColor: "#333333", // Dark grey, you can use 'black' if preferred

                        boxSizing: "border-box",
                    }}
                />
                {/* Number Box */}
                <div
                    style={{
                        position: "absolute",
                        width: `${levelFillBarWidth}px`,
                        height: `${levelFillBarHeight}px`,
                        backgroundColor: "#ffc825",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* Number Box Highlight*/}
                <div
                    style={{
                        position: "absolute",
                        width: `${levelFillBarWidth}px`,
                        height: `${levelFillBarHeight * 0.1}px`,
                        backgroundColor: "#ffeb57",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* Number Box Lowlight*/}
                <div
                    style={{
                        position: "absolute",
                        width: `${levelFillBarWidth}px`,
                        height: `${levelFillBarHeight * 0.1}px`,
                        backgroundColor: "#ffa214",
                        bottom: barPadding,
                        left: barPadding,
                    }}
                />
                {/* Text */}
                <span
                    style={{
                        position: "absolute",
                        top: `${levelBgBarHeight * 0.15}px`,
                        left: 0,

                        width: "100%",
                        height: "100%",

                        color: "white",
                        fontSize: `${levelBgBarHeight * 0.7}px`,
                        fontFamily: "Pixelar", // Ensure it's properly loaded

                        textShadow: textShadow, // Outline effect
                    }}
                >
                    {playerXPStats.gameLevel}
                </span>
            </div>

            {/* XP Bar and Text */}
            <div
                style={{
                    position: "absolute",
                    top: levelBgBarHeight / 2 - xpBgBarHeight / 2,
                    left: levelBgBarWidth - barPadding,
                    width: `${xpBgBarWidth}px`, // 2px extra on each side
                    height: `${xpBgBarHeight}px`, // 2px extra above and below
                }}
            >
                {/* Background Rectangle */}
                <div
                    key={`level-${animationKey}`} // Unique key to prevent animation re-triggering
                    className={isFlashing ? "flash-border" : ""}
                    style={{
                        position: "absolute",
                        width: `${xpBgBarWidth}px`,
                        height: `${xpBgBarHeight}px`,
                        // backgroundColor: isFlashing ? "#ffffff" : '#333333', // Dark grey
                        backgroundColor: "#333333",
                        top: 0,
                        left: 0,

                        boxSizing: "border-box",
                    }}
                />
                {/* XP fill Bar */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            xpFillBarWidth *
                            (playerXPStats.gameXpOnCurrentLevel /
                                playerXPStats.gameXpTotalForNextLevel)
                        }px`,
                        height: `${xpFillBarHeight}px`,
                        backgroundColor: "#ffc825",
                        transition: "width 0.2s",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* XP fill Bar Highlight */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            xpFillBarWidth *
                            (playerXPStats.gameXpOnCurrentLevel /
                                playerXPStats.gameXpTotalForNextLevel)
                        }px`,
                        height: `${xpFillBarHeight * 0.1}px`,
                        backgroundColor: "#ffeb57",
                        transition: "width 0.2s",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* XP fill Bar Lowlight */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            xpFillBarWidth *
                            (playerXPStats.gameXpOnCurrentLevel /
                                playerXPStats.gameXpTotalForNextLevel)
                        }px`,
                        height: `${xpFillBarHeight * 0.1}px`,
                        backgroundColor: "#ffa214",
                        transition: "width 0.2s",
                        bottom: barPadding,
                        left: barPadding,
                    }}
                />
                {/* Text */}
                <span
                    style={{
                        position: "absolute",
                        top: barPadding,
                        left: barPadding,

                        width: `${xpBgBarWidth}px`,
                        height: `${xpBgBarHeight}px`,

                        color: "white",
                        fontSize: `${xpFillBarHeight}px`,
                        fontFamily: "Pixelar", // Ensure it's properly loaded

                        textShadow: textShadow, // Outline effect
                    }}
                >
                    {Math.floor(playerXPStats.gameXpOnCurrentLevel)} /{" "}
                    {playerXPStats.gameXpTotalForNextLevel}
                </span>
            </div>
        </div>
    );
}
