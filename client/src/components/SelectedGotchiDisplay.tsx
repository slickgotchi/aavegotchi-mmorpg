import { Aavegotchi } from '../phaser/FetchGotchis';

interface SelectedGotchiDisplayProps {
    selectedGotchi: Aavegotchi | null;
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function SelectedGotchiDisplay({ selectedGotchi, gameDimensions }: SelectedGotchiDisplayProps) {
    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    const offsetX = 100 * scale;
    const offsetY = 25 * scale;
    const finalX = offsetX + gameDimensions.left;
    const finalY = offsetY + gameDimensions.top;

    return (
        <div
            style={{
                position: 'absolute',
                left: `${finalX}px`,
                top: `${finalY}px`,

                fontSize: `${24 * scale}px`,
                color: 'white',
                zIndex: 2001,
                fontFamily: 'Pixelar',

                textShadow: '0px 0px 2px black'
            }}
        >
            {selectedGotchi ? `${selectedGotchi.name}` : 'D Fault'}
        </div>
    );
}