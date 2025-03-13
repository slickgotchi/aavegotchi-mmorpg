import { useState, useEffect, useCallback } from "react";
import { Game } from "phaser";
import "./LevelUpNotification.css";

interface LevelUpNotificationProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    levelUpData: {
        newLevel: number;
        newATK: number;
        gameXpOnCurrentLevel: number;
        gameXpTotalForNextLevel: number;
    } | null;
    onComplete: () => void; // Callback when animation finishes
}

export function LevelUpNotification({
    gameRef,
    levelUpData,
    onComplete,
}: LevelUpNotificationProps) {
    const [position, setPosition] = useState<{ x: number; y: number } | null>(
        null
    );
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (levelUpData && gameRef.current) {
            const gameScene = gameRef.current.scene.getScene(
                "GameScene"
            ) as any;
            if (gameScene && gameScene.players && gameScene.localPlayerID) {
                const localPlayer = gameScene.players[gameScene.localPlayerID];
                if (localPlayer && localPlayer.sprite) {
                    setPosition({
                        x: localPlayer.sprite.x,
                        y: localPlayer.sprite.y,
                    });
                    setIsVisible(true);
                }
            }
        }
    }, [levelUpData, gameRef]);

    // Animation effect: fade out and move upward over 3 seconds
    useEffect(() => {
        if (isVisible && position) {
            const timer = setTimeout(() => {
                setIsVisible(false);
                onComplete(); // Notify parent when animation completes
            }, 3000); // 3 seconds duration

            return () => clearTimeout(timer); // Cleanup on unmount or visibility change
        }
    }, [isVisible, position, onComplete]);

    if (!isVisible || !position || !levelUpData) return null;

    return (
        <div
            className="level-up-notification"
            style={{
                position: "absolute",
                // left: `${position.x + gameDimensions.left}px`, // Position over Phaser canvas
                left: `0px`,
                top: `0px`,
                // top: `${gameDimensions.height - (position.y - offsetY) + gameDimensions.top}px`, // Invert Y for DOM (Phaser Y increases downward)
                zIndex: 3000, // Above Phaser canvas
                fontFamily: "Pixelar",
                color: "#ffffff",
                textShadow: "0px 0px 3px rgba(0,0,0,1)", // Black outline
                whiteSpace: "pre-wrap", // Preserve line breaks
                transform: `translate(-50%, 0)`, // Center horizontally
                animation: "fadeAndMoveUp 3s ease-in forwards", // CSS animation for 3s
                // transition: 'opacity 3s ease-in, top 3s ease-in', // 3s fade out and move up
                opacity: isVisible ? 1 : 0, // Start visible, fade out
                // top: `${gameDimensions.height - (position.y - offsetY) + gameDimensions.top - 20}px`, // Move up 20px after 3s
            }}
        >
            <div style={{ fontSize: `${64}px` }}>Level Up!</div>
            <div style={{ fontSize: `${32}px` }}>ATK +10%</div>
        </div>
    );
}
