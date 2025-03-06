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

    // Calculate local FPS (Phaser game FPS)
    useEffect(() => {
        if (!gameRef.current) return;

        let frameCount = 0;
        let lastTime = performance.now();

        const updateFPS = () => {
            frameCount++;
            const currentTime = performance.now();
            if (currentTime - lastTime >= 1000) { // Update every second
                setLocalFPS(frameCount);
                frameCount = 0;
                lastTime = currentTime;
            }
            requestAnimationFrame(updateFPS);
        };

        requestAnimationFrame(updateFPS);

        return () => {
            // Cleanup animation frame
        };
    }, [gameRef]);

    /*
    // Calculate server FPS and ping via WebSocket
    useEffect(() => {
        if (!ws) return;

        let pingStart = 0;
        let pingCount = 0;
        let pingSum = 0;

        const pingServer = () => {
            if (ws.readyState === WebSocket.OPEN) {
                pingStart = Date.now();
                ws.send(JSON.stringify({ type: 'ping' }));
                pingCount++;
                setLastPingTime(Date.now());
            }
        };

        ws.onmessage = (e) => {
            let msg;
            try {
                msg = JSON.parse(e.data);
            } catch (err) {
                console.error('Failed to parse message:', err);
                return;
            }

            if (msg.type === 'pong') {
                const latency = Date.now() - pingStart;
                pingSum += latency;
                setPing(Math.round(pingSum / pingCount) || 0); // Average ping

                // Assume server FPS is sent in pong (if implemented on server)
                if (msg.data && msg.data.serverFPS) {
                    setServerFPS(msg.data.serverFPS);
                }
            }
        };

        // Send ping every second
        const pingInterval = setInterval(pingServer, 1000);
        return () => clearInterval(pingInterval);
    }, [ws]);
    */

    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    const margin = 10 * scale;

    return (
        <div
            style={{
                position: 'absolute',
                left: `${margin + gameDimensions.left}px`,
                top: `${margin + 128*scale}px`,
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