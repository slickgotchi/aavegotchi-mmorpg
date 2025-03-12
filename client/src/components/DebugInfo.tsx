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

    const margin = 8;

    return (
        <div
            style={{
                position: 'absolute',
                right: `${margin}px`,
                bottom: `${margin}px`,
                zIndex: 2000, // Above everything
                fontFamily: 'Pixelar',
                color: '#ffffff',
                fontSize: `${16}px`,
                textShadow: '0px 0px 3px rgba(0,0,0,1)', // Black outline for readability
                backgroundColor: 'rgba(0, 0, 0, 0.7)', // Semi-transparent background
                padding: `${4}px ${8}px`,
                borderRadius: `${4}px`,
                width: `${128}px`
            }}
        >
            Local FPS: {localFPS}<br />
            Server FPS: {serverFPS}<br />
            Ping: {ping}ms
        </div>
    );
}