import Phaser from "phaser";
import { alphaFlashSprite, isOnScreen } from "./Utils";

export interface PositionUpdate {
    x: number;
    y: number;
    vx?: number; // Velocity X (optional, for future server support)
    vy?: number; // Velocity Y (optional)
    timestamp: number;
}

export interface Player {
    bodySprite: Phaser.GameObjects.Sprite;
    flashSprite: Phaser.GameObjects.Sprite;
    shadowSprite: Phaser.GameObjects.Sprite;
    gotchiId: number;
    isAssignedSVG: boolean;
    positionBuffer: PositionUpdate[];
    maxHp: number;
    hp: number;
    maxAp: number;
    ap: number;
    previousHp: number;
    gameXp: number;
    gameLevel: number;
    gameXpOnCurrentLevel: number;
    gameXpTotalForNextLevel: number;
    isDestroying?: boolean;
}

export class PlayerManager {
    private scene: Phaser.Scene;
    private players: { [id: string]: Player } = {};
    private localPlayerID: string = "";
    private followedPlayerID: string = "";
    private pools!: any; // Reference to pools (to be injected)

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    setPools(pools: any) {
        this.pools = pools;
    }

    setLocalPlayerID(localPlayerID: string) {
        this.localPlayerID = localPlayerID;
        console.log("set local player: ", this.localPlayerID);
    }

    addOrUpdatePlayer(datum: any) {
        const {
            playerId,
            x,
            y,
            zoneId,
            species,
            speciesId,
            timestamp,
            maxHp,
            hp,
            maxAp,
            direction,
            ap,
            gameXp,
            gameLevel,
            gameXpOnCurrentLevel,
            gameXpTotalForNextLevel,
        } = datum;

        if (hp > 0) {
            if (!this.players[playerId]) {
                let texture = "";
                let scale = 1;
                if (species === "Duck") {
                    if (speciesId === 0) texture = "duck_guardian";
                    if (speciesId === 1) texture = "duck_ravager";
                    if (speciesId === 2) texture = "duck_monk";
                    scale = 1.5;
                }
                if (texture === "") {
                    return;
                }

                const newPlayerSprite = this.scene.add
                    .sprite(x, y, texture)
                    .setDepth(1000)
                    .setScale(scale)
                    .setOrigin(0.5, 1);

                const flashSprite = this.scene.add
                    .sprite(x, y, texture)
                    .setDepth(1001)
                    .setScale(scale)
                    .setOrigin(0.5, 1)
                    .setTintFill(0xf5555d)
                    .setAlpha(0)
                    .setVisible(true);

                const shadowSprite = this.scene.add
                    .sprite(x, y, "enemies")
                    .setFrame("shadow.png")
                    .setDepth(999)
                    .setScale(scale * 0.75)
                    .setOrigin(0.5, 0.5)
                    .setAlpha(0.5)
                    .setVisible(true);

                this.players[playerId] = {
                    bodySprite: newPlayerSprite,
                    flashSprite,
                    shadowSprite,
                    gotchiId: 0,
                    isAssignedSVG: false,
                    positionBuffer: [],
                    maxHp,
                    hp,
                    maxAp,
                    ap,
                    previousHp: hp,
                    gameXp,
                    gameLevel,
                    gameXpOnCurrentLevel,
                    gameXpTotalForNextLevel,
                    isDestroying: false,
                };
                console.log(`Added player ${playerId}`);
            }

            if (this.players[playerId]) {
                const player = this.players[playerId];
                player.positionBuffer.push({ x, y, timestamp });
                while (player.positionBuffer.length > 10) {
                    player.positionBuffer.shift();
                }

                player.maxHp = maxHp;
                player.hp = hp;
                player.maxAp = maxAp;
                player.ap = ap;
                player.gameXp = gameXp;
                player.gameLevel = gameLevel;
                player.gameXpOnCurrentLevel = gameXpOnCurrentLevel;
                player.gameXpTotalForNextLevel = gameXpTotalForNextLevel;

                if (player.hp < player.previousHp) {
                    if (this.isPlayerOnScreen(player)) {
                        this.showDamageToPlayerPopupText(
                            player.previousHp - player.hp,
                            playerId
                        );
                        if (player.flashSprite) {
                            alphaFlashSprite(player.flashSprite, this.scene);
                        }
                    }
                    player.previousHp = player.hp;
                }

                if (direction) {
                    if (direction === 1) {
                        player.bodySprite.setFlipX(true);
                        player.flashSprite.setFlipX(true);
                    }
                    if (direction === 2) {
                        player.bodySprite.setFlipX(false);
                        player.flashSprite.setFlipX(false);
                    }
                }
            }

            if (this.localPlayerID === playerId) {
                // this.localPlayerID = playerId;
                if (!this.followedPlayerID) {
                    this.followedPlayerID = this.localPlayerID;
                    this.scene.cameras.main.startFollow(
                        this.players[playerId].bodySprite,
                        false,
                        0.1,
                        0.1
                    );
                }
            }
        }
        // if hp <= 0 we need to remove the player
        else {
            this.removePlayer(playerId);
        }
    }

    removePlayer(id: string) {
        const player = this.players[id];
        if (!player) {
            console.log(`Player ${id} not found for removal`);
            return;
        }

        if (player.isDestroying) {
            console.log(`Player ${id} is already being destroyed`);
            return;
        }

        player.isDestroying = true;
        console.log(`Removing player ${id}`);

        if (player.bodySprite) {
            this.scene.tweens.killTweensOf(player.bodySprite);
            player.bodySprite.destroy();
        }
        if (player.flashSprite) {
            this.scene.tweens.killTweensOf(player.flashSprite);
            player.flashSprite.destroy();
        }
        if (player.shadowSprite) {
            this.scene.tweens.killTweensOf(player.shadowSprite);
            player.shadowSprite.destroy();
        }

        if (player.isAssignedSVG && player.gotchiId) {
            const views = ["front", "left", "right", "back"];
            views.forEach((view) => {
                const textureKey = `gotchi-${player.gotchiId}-${view}`;
                if (this.scene.textures.exists(textureKey)) {
                    this.scene.textures.remove(textureKey);
                }
            });
        }

        player.positionBuffer = [];
        if (this.localPlayerID === id) {
            this.localPlayerID = "";

            // if (this.scene.registry.get("gameOver")) {
            this.scene.registry.set("gameOver", {
                isGameOver: true,
                message: null,
                code: 0,
            });
            // }
        }
        if (this.followedPlayerID === id) {
            this.scene.cameras.main.stopFollow();
            this.followedPlayerID = "";
        }
        delete this.players[id];
        console.log(`Player ${id} fully removed`);
    }

    interpolatePlayers() {
        for (const id in this.players) {
            const player = this.players[id];
            if (player.isDestroying) continue;
            if (player.positionBuffer.length === 0) continue;

            const targetTime = Date.now() - 110;
            const buffer = player.positionBuffer;

            if (buffer.length < 2) {
                player.bodySprite.setPosition(buffer[0].x, buffer[0].y);
                player.flashSprite.setPosition(buffer[0].x, buffer[0].y);
                player.shadowSprite.setPosition(buffer[0].x, buffer[0].y);
                continue;
            }

            let older, newer;
            for (let i = 0; i < buffer.length - 1; i++) {
                if (
                    buffer[i].timestamp <= targetTime &&
                    buffer[i + 1].timestamp >= targetTime
                ) {
                    older = buffer[i];
                    newer = buffer[i + 1];
                    break;
                }
            }

            if (older && newer) {
                const alpha =
                    (targetTime - older.timestamp) /
                    (newer.timestamp - older.timestamp);
                const interpX =
                    older.x +
                    (newer.x - older.x) * Math.min(1, Math.max(0, alpha));
                const interpY =
                    older.y +
                    (newer.y - older.y) * Math.min(1, Math.max(0, alpha));
                player.bodySprite.setPosition(interpX, interpY);
                player.flashSprite.setPosition(interpX, interpY);
                player.shadowSprite.setPosition(interpX, interpY);
            } else if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                player.bodySprite.setPosition(last.x, last.y);
                player.flashSprite.setPosition(last.x, last.y);
                player.shadowSprite.setPosition(last.x, last.y);
            }
        }
    }

    isPlayerOnScreen(player: Player): boolean {
        return isOnScreen(player.bodySprite, this.scene.cameras.main);
    }

    showDamageToPlayerPopupText(damageValue: number, playerId: string) {
        const player = this.players[playerId];
        if (!player || player.isDestroying) return;

        const { x, y } = player.bodySprite;
        const offsetY = -64;
        const textColor = "#f5555d";

        const damageText = this.pools.text.get();
        damageText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "24px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        damageText
            .setActive(true)
            .setOrigin(0.5, 0.5)
            .setDepth(3000)
            .setPosition(x, y + offsetY)
            .setText(damageValue.toString())
            .setVisible(true)
            .setAlpha(1);

        this.scene.tweens.add({
            targets: damageText,
            y: damageText.y - 20,
            duration: 1000,
            ease: "Back.easeOut",
        });

        this.scene.tweens.add({
            targets: damageText,
            x: damageText.x + (Math.random() * 2 - 1) * 16,
            duration: 1000,
        });

        this.scene.tweens.add({
            targets: damageText,
            alpha: 0,
            duration: 1000,
            ease: "Quint.easeIn",
            onComplete: () => this.pools.text.killAndHide(damageText),
        });
    }

    handleLevelUp(data: any) {
        const player = this.players[this.localPlayerID];
        if (!player || player.isDestroying) return;

        const { x, y } = player.bodySprite;
        const textColor = "#ffffff";
        const offsetY = 128 + 64;

        const levelUpText =
            this.pools.text.getFirstDead(false) ||
            this.scene.add.text(x, y - offsetY, "Level Up!");
        this.pools.text.add(levelUpText);
        levelUpText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "48px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        levelUpText
            .setOrigin(0.5, 0.5)
            .setDepth(3000)
            .setPosition(x, y - offsetY)
            .setText("Level Up!")
            .setVisible(true)
            .setAlpha(1);

        const atkText =
            this.pools.text.getFirstDead(false) ||
            this.scene.add.text(x, y - offsetY + 40, "ATK +10%");
        this.pools.text.add(atkText);
        atkText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "24px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        atkText
            .setOrigin(0.5, 0.5)
            .setDepth(3000)
            .setPosition(x, y - offsetY + 40)
            .setText("ATK +10%")
            .setVisible(true)
            .setAlpha(1);

        this.scene.tweens.add({
            targets: [levelUpText, atkText],
            y: "-=20",
            alpha: 0,
            duration: 3000,
            ease: "Quad.easeIn",
            onComplete: () => {
                this.pools.text.killAndHide(levelUpText);
                this.pools.text.killAndHide(atkText);
            },
        });
    }

    getPlayers() {
        return this.players;
    }

    getLocalPlayerID() {
        return this.localPlayerID;
    }

    shutdown() {
        for (const playerId in this.players) {
            this.removePlayer(playerId);
        }
    }
}
