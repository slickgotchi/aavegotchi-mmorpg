import React, { useState, useCallback, useEffect } from "react";
import "./IntroModal.css"; // For styling (defined below)
import { ConnectWalletButton } from "./ConnectWalletButton";
import AvatarSelectCard from "./AvatarSelectCard";

interface Props {
    onReplay: () => void;
}

export function GameOverModal({ onReplay }: Props) {
    const handleReplay = useCallback(() => {
        onReplay();
    }, [onReplay]);

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-title">GAME OVER</div>

                <div className="modal-message">
                    Ouch, that must be painful, better luck next time...
                </div>

                <div className="btn btn-small" onClick={handleReplay}>
                    Try Again
                </div>
            </div>
        </div>
    );
}
