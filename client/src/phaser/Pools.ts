import Phaser from "phaser";

export interface PoolManagerType {
    enemy: {
        body: Phaser.GameObjects.Group;
        shadow: Phaser.GameObjects.Group;
        statBar: Phaser.GameObjects.Group;
        flashSprite: Phaser.GameObjects.Group;
    };
    vfx: {
        circle: Phaser.GameObjects.Group;
    };
    text: Phaser.GameObjects.Group; // Add text pool
}

export class PoolManager {
    private scene: Phaser.Scene;
    public pools!: PoolManagerType;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.initializePools();
    }

    private initializePools() {
        const MAX_CONCURRENT_ENEMIES = 1000;

        // Enemy Body Pool
        const enemyBodyPool = this.scene.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: (spriteGameObject) => {
                const sprite = spriteGameObject as Phaser.GameObjects.Sprite;
                sprite.setTexture("enemies");
                sprite.setVisible(false);
                sprite.setActive(false);
                sprite.setDepth(500);
                sprite.setFrame("easy.png");
                sprite.setScale(1);
                sprite.setOrigin(0.5, 1);
            },
        });
        enemyBodyPool.createMultiple({
            key: "enemies",
            quantity: MAX_CONCURRENT_ENEMIES,
            active: false,
            visible: false,
        });

        // Enemy Shadow Pool
        const enemyShadowPool = this.scene.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: (spriteGameObject) => {
                const sprite = spriteGameObject as Phaser.GameObjects.Sprite;
                sprite.setTexture("enemies");
                sprite.setVisible(false);
                sprite.setActive(false);
                sprite.setDepth(499);
                sprite.setAlpha(0.5);
                sprite.setFrame("shadow.png");
                sprite.setScale(1);
                sprite.setOrigin(0.5, 0.5);
            },
        });
        enemyShadowPool.createMultiple({
            key: "enemies",
            quantity: MAX_CONCURRENT_ENEMIES,
            active: false,
            visible: false,
        });

        // Enemy Stat Bar Pool
        const enemyStatBarPool = this.scene.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Rectangle,
            createCallback: (rectGameObject) => {
                const rect = rectGameObject as Phaser.GameObjects.Rectangle;
                rect.setSize(32, 4);
                rect.setFillStyle(0xff0000);
                rect.setVisible(false);
                rect.setActive(false);
                rect.setDepth(501);
                rect.setAlpha(1);
                rect.setOrigin(0.5, 1);
            },
        });
        enemyStatBarPool.createMultiple({
            key: "",
            quantity: MAX_CONCURRENT_ENEMIES,
            active: false,
            visible: false,
        });

        // Enemy Flash Sprite Pool
        const enemyFlashSpritePool = this.scene.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: (flashSpriteGameObject) => {
                const flashSprite =
                    flashSpriteGameObject as Phaser.GameObjects.Sprite;
                flashSprite.setTexture("enemies");
                flashSprite.setVisible(false);
                flashSprite.setActive(false);
                flashSprite.setDepth(502);
                flashSprite.setAlpha(0);
                flashSprite.setFrame("easy.png");
                flashSprite.setScale(1);
                flashSprite.setOrigin(0.5, 1);
                flashSprite.setTintFill(0xffffff);
            },
        });
        enemyFlashSpritePool.createMultiple({
            key: "enemies",
            quantity: MAX_CONCURRENT_ENEMIES,
            active: false,
            visible: false,
        });

        // Circle Pool
        const circlePool = this.scene.add.group({
            maxSize: 300,
            classType: Phaser.GameObjects.Arc,
            createCallback: (circleGameObject) => {
                const circle = circleGameObject as Phaser.GameObjects.Arc;
                circle.setActive(false);
                circle.setVisible(false);
                circle.setRadius(1);
                circle.setFillStyle(0xffffff, 1);
            },
        });
        circlePool.createMultiple({
            key: "",
            quantity: 300,
            active: false,
            visible: false,
        });

        // Correct Text Pool Initialization
        const textPool = this.scene.add.group();

        // Manually Populate the text pool
        for (let i = 0; i < 500; i++) {
            const text = this.scene.add.text(0, 0, "", {
                fontSize: "16px",
                color: "#ff0000",
            });
            text.setActive(false).setVisible(false);
            textPool.add(text);
        }

        this.pools = {
            enemy: {
                body: enemyBodyPool,
                shadow: enemyShadowPool,
                statBar: enemyStatBarPool,
                flashSprite: enemyFlashSpritePool,
            },
            vfx: {
                circle: circlePool,
            },
            text: textPool,
        };
    }

    getPools() {
        return this.pools;
    }

    shutdown() {
        if (this.pools) {
            this.pools.enemy.body.clear(true, true);
            this.pools.enemy.shadow.clear(true, true);
            this.pools.enemy.statBar.clear(true, true);
            this.pools.enemy.flashSprite.clear(true, true);
            this.pools.vfx.circle.clear(true, true);
            this.pools.text.clear(true, true);
        }
    }
}
