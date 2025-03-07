import { useState, useEffect, useCallback } from 'react';
import { Game } from 'phaser';

interface DebugInfoProps {
    gameRef: React.MutableRefObject<Phaser.Game | null>;
    ws: WebSocket | null;
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function DebugInfo({ gameRef, ws, gameDimensions }: DebugInfoProps) {
    const [localFPS, setLocalFPS] = useState(0);
    const [serverFPS, setServerFPS] = useState(0);
    const [ping, setPing] = useState(0);
    const [lastPingTime, setLastPingTime] = useState(0);

    // Get local FPS from Phaser
    useEffect(() => {
        if (!gameRef.current) return;

        const interval = setInterval(() => {
            const game = gameRef.current;
            if (game) {
                setLocalFPS(Math.round(game.loop.actualFps)); // Get FPS directly from Phaser
            }
        }, 500); // Update every 500ms

        return () => clearInterval(interval);
    }, [gameRef.current]);

    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    const margin = 10 * scale;

    return (
        <div
            style={{
                position: 'absolute',
                left: `${gameDimensions.left + margin}px`,
                top: `${gameDimensions.top + margin + 64*scale}px`,
                zIndex: 5000, // Above everything
                fontFamily: 'Pixelar',
                color: '#ffffff',
                fontSize: `${20 * scale}px`,
                textShadow: '0px 0px 3px rgba(0,0,0,1)', // Black outline for readability
                backgroundColor: 'rgba(0, 0, 0, 0.7)', // Semi-transparent background
                padding: `${4 * scale}px ${8 * scale}px`,
                borderRadius: `${4 * scale}px`,
                width: `${128*scale}px`
            }}
        >
            Local FPS: {localFPS}<br />
            Server FPS: {serverFPS}<br />
            Ping: {ping}ms
        </div>
    );
}