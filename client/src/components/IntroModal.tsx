import React, { useState, useCallback, useEffect } from "react";
import "./IntroModal.css"; // For styling (defined below)
import { ConnectWalletButton } from "./ConnectWalletButton";
import AvatarSelectCard from "./AvatarSelectCard";

interface IntroModalProps {
    onPlay: (playableCharacter: PlayableCharacter) => void;
}

export interface PlayableCharacter {
    image: string;
    name: string;
    species: "Duck" | "Gotchi";
    classType: "Guardian" | "Ravager" | "Monk";
    speciesId: number;
    TNK: number;
    DPS: number;
    SUP: number;
}

const playableCharacters: PlayableCharacter[] = [
    {
        image: "/assets/avatars/duck_guardian.png",
        name: "Jeff the Strong",
        species: "Duck",
        classType: "Guardian",
        speciesId: 0,
        TNK: 150,
        DPS: 100,
        SUP: 50,
    },
    {
        image: "/assets/avatars/duck_ravager.png",
        name: "Jane the Deadly",
        species: "Duck",
        classType: "Ravager",
        speciesId: 1,
        TNK: 50,
        DPS: 150,
        SUP: 100,
    },
    {
        image: "/assets/avatars/duck_monk.png",
        name: "Jo the Jolly",
        species: "Duck",
        classType: "Monk",
        speciesId: 2,
        TNK: 100,
        DPS: 50,
        SUP: 150,
    },
];

export function IntroModal({ onPlay }: IntroModalProps) {
    const [selectedCharacter, setSelectedCharacter] =
        useState<PlayableCharacter | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    const handlePlay = useCallback(() => {
        if (!selectedCharacter) return;
        console.log("handlePlay");
        onPlay(selectedCharacter);
    }, [selectedCharacter, onPlay]);

    const handleSelectAvatar = (index: number) => {
        setSelectedIndex(index);
        setSelectedCharacter(playableCharacters[index]);
        console.log("Selected Avatar Index: ", index);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                {window.innerHeight > 480 ? (
                    <div className="modal-title">Waddle Wars</div>
                ) : (
                    <div className="modal-title">Choose your Hero</div>
                )}

                {window.innerHeight > 480 && (
                    <>
                        <div className="modal-introduction">
                            Welcome, traveler, to a long-forgotten, once
                            pixel-perfect land, now decimated by the
                            Lickquidator scourge and their allies. Only you and
                            your friends can restore this world to its former
                            glory... what treasures, secrets, and foes await in
                            this ruined Realm?
                        </div>
                        <div style={{ height: "1rem" }}></div>
                        <div className="modal-choose-hero-title">
                            Choose your Hero
                        </div>
                    </>
                )}

                <div className="modal-character-options">
                    {playableCharacters.map((char, index) => (
                        <AvatarSelectCard
                            key={index}
                            image={char.image}
                            name={char.name}
                            classType={char.classType}
                            TNK={char.TNK}
                            DPS={char.DPS}
                            SUP={char.SUP}
                            onSelect={() => handleSelectAvatar(index)}
                            isSelected={index == selectedIndex}
                        />
                    ))}
                </div>

                <div className="modal-play-button">
                    {selectedIndex != null ? (
                        <button className="btn" onClick={handlePlay}>
                            PLAY
                        </button>
                    ) : (
                        <button className="btn btn-inactive">PLAY</button>
                    )}
                </div>

                <div className="modal-connect-button">
                    <ConnectWalletButton
                        gameRef={{ current: null }} // Placeholder, adjust with actual game ref
                        onAccountChange={(account, gotchis) => {}}
                        // gameDimensions={gameDimensions}
                    />
                </div>
            </div>
        </div>
    );
}
