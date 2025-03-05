import { Aavegotchi } from '../phaser/FetchGotchis';

interface SelectedGotchiDisplayProps {
    selectedGotchi: Aavegotchi | null;
    gameDimensions: { width: number; height: number; left: number; top: number };
}

export function SelectedGotchiDisplay({ selectedGotchi, gameDimensions }: SelectedGotchiDisplayProps) {
    const scale = Math.min(gameDimensions.width / 1920, gameDimensions.height / 1200);
    const offsetX = 20 * scale;
    const offsetY = 20 * scale;
    const finalX = offsetX + gameDimensions.left;
    const finalY = offsetY + gameDimensions.top;

    return (
        <div
            style={{
                position: 'absolute',
                left: `${finalX}px`,
                top: `${finalY}px`,
                fontSize: `${24 * scale}px`,
                color: 'black',
                zIndex: 2000,
                fontFamily: 'Pixelar'
            }}
        >
            {selectedGotchi ? `Playing as: ${selectedGotchi.name}` : ''}
        </div>
    );
}