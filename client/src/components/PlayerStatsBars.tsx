import { useEffect, useState } from "react";
import { Game } from "phaser";
import { Player } from "../phaser/Player";

// interface Player {
//     hp: number;
//     maxHp: number;
//     ap: number;
//     maxAp: number;
// }

interface PlayerStatsBarsProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    gameDimensions: {
        width: number;
        height: number;
        left: number;
        top: number;
    };
}

export function PlayerStatsBars({
    gameRef,
    gameDimensions,
}: PlayerStatsBarsProps) {
    const [playerStats, setPlayerStats] = useState<Player | null>(null);

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
                    // console.log(players, localPlayerId, players[localPlayerId])
                    if (players && localPlayerId && players[localPlayerId]) {
                        // Create a new object to ensure React detects the change
                        const newStats = { ...players[localPlayerId] };
                        setPlayerStats(newStats);
                    }
                }
            }
        };

        // Poll for changes
        const interval = setInterval(updateStats, 100);
        return () => clearInterval(interval);
    }, [gameRef]);

    const barPadding = 2;

    const hpFillBarWidth = playerStats ? playerStats.maxHp : 450; // Base width for visual consistency
    const apFillBarWidth = playerStats ? playerStats.maxAp : 450;
    const fillBarHeight = 20;

    const hpBgBarWidth = hpFillBarWidth + 2 * barPadding; // Static width for HP background
    const apBgBarWidth = apFillBarWidth + 2 * barPadding; // Static width for AP background
    const bgBarHeight = fillBarHeight + 2 * barPadding;

    const margin = 8;
    const padding = 4;

    if (!playerStats) return null;

    const shadow = 0;
    const blur = 3;
    const textShadow = `${shadow}px ${shadow}px ${blur}px rgba(0,0,0,1)`;

    return (
        <div
            style={{
                position: "absolute",
                left: `${margin}px`,
                bottom: `${margin}px`,
                zIndex: 2000,
                fontFamily: "Pixelar",
            }}
        >
            {/* hp bar container */}
            <div
                style={{
                    position: "relative",
                    width: `${hpBgBarWidth}px`,
                    height: `${bgBarHeight}px`,
                    top: 0,
                    left: 0,
                }}
            >
                {/* Background Rectangle */}
                <div
                    style={{
                        position: "absolute",
                        width: `${hpBgBarWidth}px`,
                        height: `${bgBarHeight}px`,
                        backgroundColor: "#333333", // Dark grey, you can use 'black' if preferred
                        top: "0px", // Offset to extend beyond colored bar
                        left: "0px",
                    }}
                />

                {/* HP Bar */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            hpFillBarWidth *
                            (playerStats.hp / playerStats.maxHp)
                        }px`,
                        height: `${fillBarHeight}px`,
                        backgroundColor: "#5ac54f",
                        transition: "width 0.2s",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* HP Bar Highlight */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            hpFillBarWidth *
                            (playerStats.hp / playerStats.maxHp)
                        }px`,
                        height: `${fillBarHeight * 0.1}px`,
                        backgroundColor: "#99e65f",
                        transition: "width 0.2s",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* HP Bar Lowlight */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            hpFillBarWidth *
                            (playerStats.hp / playerStats.maxHp)
                        }px`,
                        height: `${fillBarHeight * 0.1}px`,
                        backgroundColor: "#33984b",
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

                        width: `${hpBgBarWidth - 2 * barPadding}px`,
                        height: `${fillBarHeight}px`,

                        color: "white",
                        fontSize: `${fillBarHeight}px`,
                        fontFamily: "Pixelar", // Ensure it's properly loaded

                        textShadow: textShadow, // Outline effect
                    }}
                >
                    {playerStats.hp} / {playerStats.maxHp}
                </span>
            </div>

            {/* AP Bar and Text */}
            <div
                style={{
                    position: "relative",
                    width: `${apBgBarWidth}px`, // 2px extra on each side
                    height: `${bgBarHeight}px`, // 2px extra above and below
                    top: padding,
                    left: 0,
                }}
            >
                {/* Background Rectangle */}
                <div
                    style={{
                        position: "absolute",
                        width: `${apBgBarWidth}px`,
                        height: `${bgBarHeight}px`,
                        backgroundColor: "#333333", // Dark grey
                        top: 0,
                        left: 0,
                    }}
                />
                {/* AP Bar */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            apFillBarWidth *
                            (playerStats.ap / playerStats.maxAp)
                        }px`,
                        height: `${fillBarHeight}px`,
                        backgroundColor: "#0098dc",
                        transition: "width 0.2s",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* AP Bar Highlght */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            apFillBarWidth *
                            (playerStats.ap / playerStats.maxAp)
                        }px`,
                        height: `${fillBarHeight * 0.1}px`,
                        backgroundColor: "#00cdf9",
                        transition: "width 0.2s",
                        top: barPadding,
                        left: barPadding,
                    }}
                />
                {/* AP Bar Lowlight */}
                <div
                    style={{
                        position: "absolute",
                        width: `${
                            apFillBarWidth *
                            (playerStats.ap / playerStats.maxAp)
                        }px`,
                        height: `${fillBarHeight * 0.1}px`,
                        backgroundColor: "#0069aa",
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

                        width: `${apBgBarWidth - 2 * barPadding}px`,
                        height: `${fillBarHeight}px`,

                        color: "white",
                        fontSize: `${fillBarHeight}px`,
                        fontFamily: "Pixelar", // Ensure it's properly loaded

                        textShadow: textShadow, // Outline effect
                    }}
                >
                    {Math.floor(playerStats.ap)} / {playerStats.maxAp}
                </span>
            </div>
        </div>
    );
}
