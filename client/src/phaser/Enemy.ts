import Phaser from "phaser";
import { alphaFlashSprite, isOnScreen } from "./Utils";
import { GameScene } from "./GameScene";
import { PoolManager, PoolManagerType } from "./Pools";

export interface PositionUpdate {
    x: number;
    y: number;
    vx?: number; // Velocity X (optional, for future server support)
    vy?: number; // Velocity Y (optional)
    timestamp: number;
}

export interface Enemy {
    bodySprite: Phaser.GameObjects.Sprite | null;
    shadowSprite: Phaser.GameObjects.Sprite | null;
    flashSprite: Phaser.GameObjects.Sprite | null;
    hpBar: Phaser.GameObjects.Rectangle | null;
    type: string;
    positionBuffer: PositionUpdate[];
    direction?: number;
    zoneId: number;
    hasPoolSprites: boolean;
    maxHp: number;
    hp: number;
    previousHp: number;
}

export class EnemyManager {
    private scene: Phaser.Scene;
    private enemies: { [id: string]: Enemy } = {};
    private pools!: PoolManagerType;
    private rezoneBatchCounter = 0;
    private rezoneBatchLimit = 20;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    setPools(pools: any) {
        this.pools = pools;
    }

    resetRezoneBatchCounter() {
        this.rezoneBatchCounter = 0;
    }

    addOrUpdateEnemy(data: any) {
        const { enemyId, x, y, zoneId, timestamp, type, maxHp, hp, direction } =
            data;

        const activeZoneList = (this.scene as GameScene).getActiveZoneList();

        const isEnemyInAnActiveZone =
            zoneId === activeZoneList.currentZoneId ||
            zoneId === activeZoneList.xAxisZoneId ||
            zoneId === activeZoneList.yAxisZoneId ||
            zoneId === activeZoneList.diagonalZoneId;

        if (
            this.rezoneBatchCounter >= this.rezoneBatchLimit ||
            !isEnemyInAnActiveZone
        ) {
            return;
        }

        let enemy = this.enemies[enemyId];
        const hasPoolSprites = enemy ? enemy.hasPoolSprites : true;

        // NEW ENEMY
        if ((!enemy || !hasPoolSprites) && hp > 0) {
            this.rezoneBatchCounter++;

            const bodySprite = this.pools.enemy.body.get();
            if (bodySprite) {
                bodySprite
                    .setVisible(true)
                    .setActive(true)
                    .setFrame(`${type}.png`);
            }

            const shadowSprite = this.pools.enemy.shadow.get();
            if (shadowSprite) {
                shadowSprite.setVisible(true).setActive(true);
            }

            const flashSprite = this.pools.enemy.flashSprite.get();
            if (flashSprite) {
                flashSprite
                    .setVisible(true)
                    .setActive(true)
                    .setFrame(`${type}.png`);
            }

            const hpBar = this.pools.enemy.statBar.get();
            if (hpBar) {
                hpBar.setVisible(true).setActive(true);
            }

            if (bodySprite && shadowSprite) {
                this.enemies[enemyId] = {
                    bodySprite,
                    shadowSprite,
                    flashSprite,
                    hpBar,
                    type,
                    positionBuffer: [],
                    direction,
                    zoneId,
                    hasPoolSprites: true,
                    maxHp,
                    hp,
                    previousHp: hp,
                };
            }
        }

        // UPDATE ENEMY
        if (this.enemies[enemyId] && hp > 0) {
            enemy = this.enemies[enemyId];
            enemy.positionBuffer.push({ x, y, timestamp });
            while (enemy.positionBuffer.length > 10) {
                enemy.positionBuffer.shift();
            }

            enemy.maxHp = maxHp;
            enemy.hp = hp;

            if (enemy.hpBar) {
                enemy.hpBar.width = (32 * hp) / maxHp;
            }

            if (direction !== undefined) {
                enemy.direction = direction;
            }

            if (enemy.hp < enemy.previousHp) {
                if (this.isEnemyOnScreen(enemy)) {
                    // console.log("damage: ", enemy.previousHp - enemy.hp);
                    this.showDamageToEnemyPopupText(
                        enemy.previousHp - enemy.hp,
                        enemyId
                    );
                    if (enemy.flashSprite)
                        alphaFlashSprite(enemy.flashSprite, this.scene);
                }
                enemy.previousHp = enemy.hp;
            }
        }

        if (hp <= 0 && this.enemies[enemyId]) {
            enemy = this.enemies[enemyId];
            if (enemy.bodySprite && enemy.shadowSprite && enemy.hpBar) {
                this.pools.enemy.body.killAndHide(enemy.bodySprite);
                this.pools.enemy.shadow.killAndHide(enemy.shadowSprite);
                this.pools.enemy.statBar.killAndHide(enemy.hpBar);
            }
            delete this.enemies[enemyId];
        }
    }

    interpolateEnemies() {
        for (const id in this.enemies) {
            const enemy = this.enemies[id];
            if (
                !enemy ||
                !enemy.bodySprite ||
                !enemy.shadowSprite ||
                !enemy.hpBar
            )
                continue;
            if (enemy.positionBuffer.length === 0) continue;

            const targetTime = Date.now() - 110;
            const buffer = enemy.positionBuffer;

            if (buffer.length < 2) {
                enemy.bodySprite.setPosition(buffer[0].x, buffer[0].y);
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
                enemy.bodySprite.setPosition(interpX, interpY);
                enemy.flashSprite?.setPosition(interpX, interpY);
                enemy.shadowSprite.setPosition(
                    interpX,
                    interpY + enemy.bodySprite.height * 0
                );
                enemy.hpBar.setPosition(
                    interpX,
                    interpY - enemy.bodySprite.height * 1.2
                );
            } else if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                enemy.bodySprite.setPosition(last.x, last.y);
                enemy.flashSprite?.setPosition(last.x, last.y);
                enemy.shadowSprite.setPosition(
                    last.x,
                    last.y + enemy.bodySprite.height * 0
                );
                enemy.hpBar.setPosition(
                    last.x,
                    last.y - enemy.bodySprite.height * 1.2
                );
            }
        }
    }

    isEnemyOnScreen(enemy: Enemy): boolean {
        if (!enemy.bodySprite) return false;

        return isOnScreen(enemy.bodySprite, this.scene.cameras.main);
    }

    showDamageToEnemyPopupText(damageValue: number, enemyId: string) {
        const enemy = this.enemies[enemyId];
        if (!enemy || !enemy.bodySprite) return;

        const { x, y } = enemy.bodySprite;
        const offsetY = -48;
        const textColor = "white";

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
            .setVisible(true)
            .setOrigin(0.5, 0.5)
            .setDepth(3000)
            .setPosition(x, y + offsetY)
            .setText(damageValue.toString())
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
            onComplete: () => {
                this.pools.text.killAndHide(damageText);
            },
        });
    }

    getEnemies() {
        return this.enemies;
    }

    shutdown() {
        for (const enemyId in this.enemies) {
            const enemy = this.enemies[enemyId];
            if (enemy.bodySprite)
                this.pools.enemy.body.killAndHide(enemy.bodySprite);
            if (enemy.shadowSprite)
                this.pools.enemy.shadow.killAndHide(enemy.shadowSprite);
            if (enemy.flashSprite)
                this.pools.enemy.flashSprite.killAndHide(enemy.flashSprite);
            if (enemy.hpBar) this.pools.enemy.statBar.killAndHide(enemy.hpBar);
            delete this.enemies[enemyId];
        }
    }
}
