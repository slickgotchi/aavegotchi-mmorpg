import React from "react";
import "./AvatarSelectCard.css";  // Import the CSS file

interface AvatarSelectCardProps {
  image: string;
  name: string;
  classType: string;
  TNK: number;
  DPS: number;
  SUP: number;
  onSelect: () => void;
  isSelected: boolean;
}

const AvatarSelectCard: React.FC<AvatarSelectCardProps> = ({ image, name, classType, TNK, DPS, SUP, onSelect, isSelected }) => {
    
    let classColor = "#ffffff";
    if (classType == "Guardian") classColor = "#00cdf9";
    if (classType == "Ravager") classColor = "#f5555d";
    if (classType == "Monk") classColor = "#99e65f";

    const multiplier = 1;
  
    return (
    <div className={`avatar-select-card ${isSelected ? "selected" : ""}`} onClick={onSelect}>
      <img src={image} alt={name} className="avatar-image" />
      <div className="avatar-name">{name}</div>
      <div className="avatar-class-type" style={{color: classColor}}>{classType}</div>

      <div className="stat-container">
        <div className="stat-label">TNK</div>
        <div className="stat-bar">
          <div className="stat-fill TNK" style={{ width: `${TNK/400*100}%` }}></div>
        </div>
      </div>

      <div className="stat-container">
        <div className="stat-label">DPS</div>
        <div className="stat-bar">
          <div className="stat-fill DPS" style={{ width: `${DPS/400*100}%` }}></div>
        </div>
      </div>

      <div className="stat-container">
        <div className="stat-label">SUP</div>
        <div className="stat-bar">
          <div className="stat-fill SUP" style={{ width: `${SUP/400*100}%` }}></div>
        </div>
      </div>

      <div className="stat-multiplier">
        Multiplier: <span style={{ color: "#ffeb57"}}>{multiplier.toFixed(2)}x</span>
      </div>
    </div>
  );
};

export default AvatarSelectCard;
