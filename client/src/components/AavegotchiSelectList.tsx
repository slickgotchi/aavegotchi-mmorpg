import { useState, useCallback } from 'react';
import { Aavegotchi, calculateBRS } from '../phaser/FetchGotchis';
import { Game } from 'phaser';

interface AavegotchiSelectListProps {
    gotchis: Aavegotchi[];
    selectedGotchi: Aavegotchi | null;
    onSelectGotchi: (gotchi: Aavegotchi) => void;
    gameDimensions: { width: number; height: number; left: number; top: number };
    gameRef: React.MutableRefObject<Phaser.Game | null>;
}

export function AavegotchiSelectList({ gotchis, selectedGotchi, onSelectGotchi, gameDimensions, gameRef }: AavegotchiSelectListProps) {
    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    const listWidth = 600 * scale;
    const itemHeight = 50 * scale;
    const offsetX = 20 * scale; // Margin from right
    const offsetY = 100 * scale; // Margin from top (below Connect button)
    const finalX = gameDimensions.width - listWidth - offsetX + gameDimensions.left;
    const finalY = offsetY + gameDimensions.top;

    const handleSelect = useCallback((gotchi: Aavegotchi) => {
        onSelectGotchi(gotchi);
        if (gameRef.current) {
            gameRef.current.registry.set('selectedGotchi', gotchi);
            gameRef.current.events.emit('selectGotchi', gotchi);
        }
    }, [onSelectGotchi, gameRef]);

    return (
        <div
            style={{
                position: 'absolute',
                width: `${listWidth}px`,
                height: `${Math.min(gotchis.length * itemHeight, gameDimensions.height - offsetY * 2)}px`,
                left: `${finalX}px`,
                top: `${finalY}px`,
                overflowY: 'auto',
                zIndex: 2000,
                backgroundColor: 'white',
                border: `${1 * scale}px solid black`,
                fontFamily: 'Pixelar'
            }}
        >
            {gotchis.map((gotchi, index) => (
                <div
                    key={index}
                    style={{
                        height: `${itemHeight}px`,
                        lineHeight: `${itemHeight}px`,
                        padding: `${5 * scale}px`,
                        backgroundColor: selectedGotchi?.id === gotchi.id ? '#e0e0e0' : 'white',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                    onClick={() => handleSelect(gotchi)}
                >
                    (BRS: {gotchi.withSetsRarityScore}) {gotchi.name}
                </div>
            ))}
        </div>
    );
}