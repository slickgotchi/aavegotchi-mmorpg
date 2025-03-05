import { useState, useEffect, useCallback } from 'react';
import { Game } from 'phaser';
import './LevelUpNotification.css';

interface LevelUpNotificationProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    levelUpData: {
        newLevel: number;
        newATK: number;
        gameXpOnCurrentLevel: number;
        gameXpTotalForNextLevel: number;
    } | null;
    onComplete: () => void; // Callback when animation finishes
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function LevelUpNotification({ gameRef, levelUpData, onComplete, gameDimensions }: LevelUpNotificationProps) {
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    // Get player position from Phaser when level-up data is provided
    useEffect(() => {
        if (levelUpData && gameRef.current) {
            const gameScene = gameRef.current.scene.getScene('GameScene') as any;
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
        console.log("Level up");
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

    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);

    if (!isVisible || !position || !levelUpData) return null;

    return (
        <div
            className="level-up-notification"
            style={{
                position: 'absolute',
                // left: `${position.x + gameDimensions.left}px`, // Position over Phaser canvas
                left: `${gameDimensions.left + gameDimensions.width/2}px`,
                top: `${gameDimensions.top + gameDimensions.height/2 - 256 * scale}px`,
                // top: `${gameDimensions.height - (position.y - offsetY) + gameDimensions.top}px`, // Invert Y for DOM (Phaser Y increases downward)
                zIndex: 3000, // Above Phaser canvas
                fontFamily: 'Pixelar',
                color: '#ffffff',
                textShadow: '0px 0px 3px rgba(0,0,0,1)', // Black outline
                whiteSpace: 'pre-wrap', // Preserve line breaks
                transform: `translate(-50%, 0)`, // Center horizontally
                animation: 'fadeAndMoveUp 3s ease-in forwards', // CSS animation for 3s
                // transition: 'opacity 3s ease-in, top 3s ease-in', // 3s fade out and move up
                opacity: isVisible ? 1 : 0, // Start visible, fade out
                // top: `${gameDimensions.height - (position.y - offsetY) + gameDimensions.top - 20}px`, // Move up 20px after 3s
            }}
        >
            <div style={{ fontSize: `${64 * scale}px` }}>Level Up!</div>
            <div style={{ fontSize: `${32 * scale}px` }}>ATK +10%</div>
        </div>
    );
}