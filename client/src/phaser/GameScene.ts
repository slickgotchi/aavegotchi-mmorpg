import Phaser from "phaser";
import { fetchGotchiSVGs, Aavegotchi } from "./FetchGotchis";

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;
const MAX_POSITION_BUFFER_LENGTH = 10;
const MAX_CONCURRENT_ENEMIES = 1000;

// Reduced for faster response; adjust as needed
// note a higher value (200) can smooth out crossing over zone boundaries
const INTERPOLATION_DELAY_MS = 110;

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
    gotchiId: number;
    isAssignedSVG: boolean;
    positionBuffer: PositionUpdate[];

    // game stats
    maxHp: number;
    ap: number;
    hp: number;
    maxAp: number;
    previousHp: number;

    // xp
    gameXp: number;
    gameLevel: number;
    gameXpOnCurrentLevel: number;
    gameXpTotalForNextLevel: number;
}

export interface TilemapProperty {
    name: string;
    type: string;
    value: any; // or specific type like boolean | string | number if known
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
    previousHp: number; // for tracking damage popups
}

export interface PoolManager {
    enemy: {
        body: Phaser.GameObjects.Group;
        shadow: Phaser.GameObjects.Group;
        statBar: Phaser.GameObjects.Group;
        flashSprite: Phaser.GameObjects.Group;
    };
    vfx: {
        circle: Phaser.GameObjects.Group;
    };
}

export interface TilemapZone {
    tilemapRef: string;
    zoneId: number;
    worldX: number;
    worldY: number;
    tilemap: Phaser.Tilemaps.Tilemap;
}

export interface ActiveZoneList {
    currentZoneId: number;
    xAxisZoneId: number;
    yAxisZoneId: number;
    diagonalZoneId: number;
}

// let player, zones, ws;
const tileSize = 32;
const zoneSize = 256; // 8192px
// const scale = 1 / 32; //

export class GameScene extends Phaser.Scene {
    private players: { [id: string]: Player } = {};
    // private enemies: { [id: string]: Enemy } = {};
    public ws!: WebSocket;
    private keys!: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
        SPACE: Phaser.Input.Keyboard.Key;
    };
    private tickTimer = 0;
    private textPool: Phaser.GameObjects.Text[] = [];
    private isConnected = false;
    private keyState = { W: false, A: false, S: false, D: false, SPACE: false };
    private localPlayerID!: string;
    // private localZoneId = 0;
    private followedPlayerID!: string;
    private activeZoneList!: ActiveZoneList;

    private rezoneBatchCounter = 0;
    private rezoneBatchLimit = 20;

    private tilemapZones: { [id: string]: TilemapZone } = {};

    private pools!: PoolManager;

    private enemies: { [id: string]: Enemy } = {};

    public getPlayers() {
        return this.players;
    }
    public getLocalPlayerID() {
        return this.localPlayerID;
    }

    constructor() {
        super("GameScene");
    }

    preload() {
        // TILEMAPPING
        this.load.image("tileset", "assets/tilemap/tileset.png");
        this.load.image("terrain", "assets/tilemap/tilesets/terrain.png");
        this.load.tilemapTiledJSON("mmorpg", "assets/tilemap/mmorpg.json");
        this.load.tilemapTiledJSON("default", "assets/tilemap/default.json");
        this.load.tilemapTiledJSON(
            "yield_fields_1",
            "assets/tilemap/maps/yield_fields_1.json"
        );

        // FONTS
        this.load.font("Pixelar", "assets/fonts/pixelar/PixelarRegular.ttf");

        // ENEMIES (& THEIR SHADOWS)
        this.load.atlas(
            "enemies",
            "assets/enemies/enemies.png",
            "assets/enemies/enemies.json"
        );

        // MISC
        this.load.image("gotchi_placeholder", "/assets/gotchi_placeholder.png");
    }

    create() {
        if (this.input.keyboard === null) return;

        this.keys = {
            W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            SPACE: this.input.keyboard.addKey(
                Phaser.Input.Keyboard.KeyCodes.SPACE
            ),
        };

        this.activeZoneList = {
            currentZoneId: -1000,
            xAxisZoneId: -1000,
            yAxisZoneId: -1000,
            diagonalZoneId: -1000,
        };

        // init body pool
        var enemyBodyPool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: (spriteGameObject) => {
                var sprite = spriteGameObject as Phaser.GameObjects.Sprite;
                sprite.setTexture("enemies"); // Single texture atlas for all bodies
                sprite.setVisible(false); // Hidden until assigned
                sprite.setActive(false); // Inactive until assigned
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

        // Initialize shadow pool
        var enemyShadowPool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: (spriteGameObject) => {
                var sprite = spriteGameObject as Phaser.GameObjects.Sprite;
                sprite.setTexture("enemies"); // Single texture atlas for all shadows
                sprite.setVisible(false); // Hidden until assigned
                sprite.setActive(false); // Inactive until assigned
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

        // Initialize rectangle pool
        var enemyStatBarPool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Rectangle,
            createCallback: (rectGameObject) => {
                var rect = rectGameObject as Phaser.GameObjects.Rectangle;
                rect.setSize(32, 4); // Set the rectangle size
                rect.setFillStyle(0xff0000); // Red color
                rect.setVisible(false); // Hidden until assigned
                rect.setActive(false); // Inactive until assigned
                rect.setDepth(501);
                rect.setAlpha(1);
                rect.setOrigin(0.5, 1);
            },
        });

        // Pre-create all rectangles
        enemyStatBarPool.createMultiple({
            key: "",
            quantity: MAX_CONCURRENT_ENEMIES,
            active: false,
            visible: false,
        });

        // Initialize flashSprite pool
        var enemyFlashSpritePool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: (flashSpriteGameObject) => {
                var flashSprite =
                    flashSpriteGameObject as Phaser.GameObjects.Sprite;
                flashSprite.setTexture("enemies"); // Single texture atlas for all shadows
                flashSprite.setVisible(false); // Hidden until assigned
                flashSprite.setActive(false); // Inactive until assigned
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

        // create circle pools
        var circlePool = this.add.group({
            maxSize: 300,
            classType: Phaser.GameObjects.Arc,
            createCallback: (circleGameObject) => {
                var circle = circleGameObject as Phaser.GameObjects.Arc;
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

        // add all pools to the overall pool list
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
        };

        this.resizeGame();
        window.addEventListener("resize", () => this.resizeGame());
    }

    setWebSocket(ws: WebSocket) {
        // this.ws = new WebSocket("ws://localhost:8080/ws");
        this.ws = ws;
        this.ws.onopen = () => {
            console.log("Connected to server");
            this.isConnected = true;

            this.ws.onmessage = (event) => {
                const messages = JSON.parse(event.data);
                if (!Array.isArray(messages)) {
                    console.error(
                        "Unexpected WebSocket message format:",
                        messages
                    );
                    return; // Stop execution if it's not an array
                }

                messages.forEach((msg: any) => {
                    switch (msg.type) {
                        case "welcome":
                            this.handleWelcome(msg.data);
                            break;
                        case "activeZones":
                            this.handleActiveZoneList(msg.data);
                            break;
                        case "playerUpdate":
                            this.addOrUpdatePlayer(msg.data);
                            break;
                        case "enemyUpdate":
                            this.addOrUpdateEnemy(msg.data);
                            break;
                        case `abilityEffect`:
                            this.handleAbilityEffect(msg.data);
                            break;
                        case `telegraphWarning`:
                            this.handleTelegraphWarning(msg.data);
                            break;

                        default:
                            console.log("No event handler for: ", msg);
                            break;
                    }

                    this.rezoneBatchCounter = 0;
                });
            };

            this.ws.onerror = (e) => console.error("WebSocket error:", e);
            this.ws.onclose = () => {
                console.log("WebSocket closed");
                this.isConnected = false;
            };
        };
    }

    handleTelegraphWarning(telegraphWarning: any) {
        const {
            ability,
            casterId,
            targetId,
            impactX,
            impactY,
            radius,
            duration,
        } = telegraphWarning;

        var player = this.players[casterId];
        var enemy = this.enemies[casterId];

        if (player) {
        } else if (enemy) {
            this.showFireballTelegraphWarning(
                impactX,
                impactY,
                radius,
                duration,
                "enemy"
            );
        }
    }

    handleAbilityEffect(abilityEffect: any) {
        const { ability, casterId, damage, hp, targetId, impactX, impactY } =
            abilityEffect;
        // console.log(data);
        switch (ability) {
            case "HammerSwing":
                var enemy = this.enemies[casterId];
                var player = this.players[casterId];
                if (enemy && enemy.bodySprite) {
                    // console.log("showHammerSwing()");
                    this.showHammerSwing(impactX, impactY, "enemy");
                } else if (player && player.bodySprite) {
                    // console.log("showHammerSwing() for player");
                    this.showHammerSwing(impactX, impactY, "player");
                }
                break;
            default:
                break;
        }
    }

    handleWelcome(datum: any) {
        const { playerId, zones } = datum;
        this.localPlayerID = playerId;
        console.log("Welcome ", this.localPlayerID, zones);

        let maxX = 0;
        let maxY = 0;

        zones.forEach((zone: any) => {
            const { id, tilemapRef, worldX, worldY } = zone;
            this.createTilemapZone(id, tilemapRef, worldX, worldY);

            if (worldX > maxX) maxX = worldX;
            if (worldY > maxY) maxY = worldY;
        });

        // set camera extents to the max world positions + a zone width/height
        this.cameras.main.setBounds(
            0,
            0,
            maxX + zoneSize * tileSize,
            maxY + zoneSize * tileSize
        );
    }

    handleActiveZoneList(datum: any) {
        const { currentZoneId, xAxisZoneId, yAxisZoneId, diagonalZoneId } =
            datum;

        if (!this.activeZoneList) return;

        if (
            this.activeZoneList.currentZoneId !== currentZoneId &&
            this.activeZoneList.currentZoneId !== xAxisZoneId &&
            this.activeZoneList.currentZoneId !== yAxisZoneId &&
            this.activeZoneList.currentZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.currentZoneId);
        }

        if (
            this.activeZoneList.xAxisZoneId !== currentZoneId &&
            this.activeZoneList.xAxisZoneId !== xAxisZoneId &&
            this.activeZoneList.xAxisZoneId !== yAxisZoneId &&
            this.activeZoneList.xAxisZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.xAxisZoneId);
        }

        if (
            this.activeZoneList.yAxisZoneId !== currentZoneId &&
            this.activeZoneList.yAxisZoneId !== xAxisZoneId &&
            this.activeZoneList.yAxisZoneId !== yAxisZoneId &&
            this.activeZoneList.yAxisZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.yAxisZoneId);
        }

        if (
            this.activeZoneList.diagonalZoneId !== currentZoneId &&
            this.activeZoneList.diagonalZoneId !== xAxisZoneId &&
            this.activeZoneList.diagonalZoneId !== yAxisZoneId &&
            this.activeZoneList.diagonalZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.diagonalZoneId);
        }

        this.activeZoneList = {
            currentZoneId: currentZoneId,
            xAxisZoneId: xAxisZoneId,
            yAxisZoneId: yAxisZoneId,
            diagonalZoneId: diagonalZoneId,
        };
    }

    releasePoolSpritesOfZone(zoneId: number) {
        // Guard against undefined pools
        if (this.pools && this.pools.enemy) {
            // Deactivate all existing enemy sprites instead of clearing pools
            for (const enemyId in this.enemies) {
                const enemy = this.enemies[enemyId];
                if (enemy.zoneId === zoneId) {
                    if (enemy.bodySprite) {
                        this.pools.enemy.body.killAndHide(enemy.bodySprite);
                        enemy.bodySprite = null;
                    }
                    if (enemy.shadowSprite) {
                        this.pools.enemy.shadow.killAndHide(enemy.shadowSprite);
                        enemy.shadowSprite = null;
                    }
                    if (enemy.flashSprite) {
                        this.pools.enemy.flashSprite.killAndHide(
                            enemy.flashSprite
                        );
                        enemy.flashSprite = null;
                    }
                    if (enemy.hpBar) {
                        this.pools.enemy.statBar.killAndHide(enemy.hpBar);
                        enemy.hpBar = null;
                    }
                    enemy.hasPoolSprites = false;
                    delete this.enemies[enemyId];
                }
            }
        } else {
            console.warn(
                "Pools not initialized yet, skipping zone change cleanup"
            );
        }
    }

    addOrUpdatePlayer(datum: any) {
        const {
            playerId,
            x,
            y,
            zoneId,
            timestamp,
            maxHp,
            hp,
            maxAp,
            ap,
            gameXp,
            gameLevel,
            gameXpOnCurrentLevel,
            gameXpTotalForNextLevel,
        } = datum;

        // NEW PLAYER
        if (!this.players[playerId]) {
            const newPlayerSprite = this.add
                .sprite(x, y, "gotchi_placeholder")
                .setDepth(1000)
                .setScale(0.75)
                .setOrigin(0.5, 1);

            const flashSprite = this.add
                .sprite(x, y, "gotchi_placeholder")
                .setDepth(1001)
                .setScale(0.75)
                .setOrigin(0.5, 1)
                .setTintFill(0xf5555d)
                .setAlpha(0)
                .setVisible(true);

            this.players[playerId] = {
                bodySprite: newPlayerSprite,
                flashSprite: flashSprite,
                gotchiId: 0,
                isAssignedSVG: false,
                positionBuffer: [],

                // game stats
                maxHp: maxHp,
                hp: hp,
                maxAp: maxAp,
                ap: ap,
                previousHp: hp,

                // xp
                gameXp: gameXp,
                gameLevel: gameLevel,
                gameXpOnCurrentLevel: gameXpOnCurrentLevel,
                gameXpTotalForNextLevel: gameXpTotalForNextLevel,
            };
            console.log(`Added player ${playerId}`);
        }

        // GENERAL UPDATES
        if (this.players[playerId]) {
            // position buffer updates
            const player = this.players[playerId];
            player.positionBuffer.push({
                x: x,
                y: y,
                timestamp: timestamp,
            });

            while (player.positionBuffer.length > MAX_POSITION_BUFFER_LENGTH) {
                player.positionBuffer.shift();
            }

            // stats
            player.maxHp = maxHp;
            player.hp = hp;
            player.maxAp = maxAp;
            player.ap = ap;

            player.gameXp = gameXp;
            player.gameLevel = gameLevel;
            player.gameXpOnCurrentLevel = gameXpOnCurrentLevel;
            player.gameXpTotalForNextLevel = gameXpTotalForNextLevel;

            // check for damage update
            if (player.hp < player.previousHp) {
                if (this.isPlayerOnScreen(player)) {
                    this.showDamageToPlayerPopupText(
                        player.previousHp - player.hp,
                        playerId
                    );
                    if (player.flashSprite) {
                        this.alphaFlashSprite(player.flashSprite);
                    }
                }
                player.previousHp = player.hp;
            }

            // console.log(player, this.players[playerId]);
        }

        // LOCAL PLAYER
        if (this.localPlayerID === playerId) {
            if (!this.followedPlayerID) {
                this.followedPlayerID = this.localPlayerID;
                this.cameras.main.startFollow(
                    this.players[playerId].bodySprite,
                    false,
                    0.1,
                    0.1
                );
            }
        }
    }

    // Check if an enemy is onscreen using the camera's worldView
    isEnemyOnScreen(enemy: Enemy): boolean {
        if (!enemy || !enemy.bodySprite) return false;

        const camera = this.cameras.main;
        const worldView = camera.worldView; // Rectangle representing the visible area

        const x = enemy.bodySprite.x;
        const y = enemy.bodySprite.y;

        return (
            x >= worldView.left &&
            x <= worldView.right &&
            y >= worldView.top &&
            y <= worldView.bottom
        );
    }

    // Check if an enemy is onscreen using the camera's worldView
    isPlayerOnScreen(player: Player): boolean {
        if (!player || !player.bodySprite) return false;

        const camera = this.cameras.main;
        const worldView = camera.worldView; // Rectangle representing the visible area

        const x = player.bodySprite.x;
        const y = player.bodySprite.y;

        return (
            x >= worldView.left &&
            x <= worldView.right &&
            y >= worldView.top &&
            y <= worldView.bottom
        );
    }

    deactivateAllEnemySprites() {
        // Guard against undefined pools
        if (this.pools && this.pools.enemy) {
            // Deactivate all existing enemy sprites instead of clearing pools
            let i = 0;
            for (const enemyId in this.enemies) {
                const enemy = this.enemies[enemyId];
                if (enemy.bodySprite) {
                    this.pools.enemy.body.killAndHide(enemy.bodySprite);
                    enemy.bodySprite = null;
                }
                if (enemy.shadowSprite) {
                    this.pools.enemy.shadow.killAndHide(enemy.shadowSprite);
                    enemy.shadowSprite = null;
                }
                if (enemy.flashSprite) {
                    this.pools.enemy.flashSprite.killAndHide(enemy.flashSprite);
                    enemy.flashSprite = null;
                }
                if (enemy.hpBar) {
                    this.pools.enemy.statBar.killAndHide(enemy.hpBar);
                    enemy.hpBar = null;
                }
                enemy.hasPoolSprites = false;
                delete this.enemies[enemyId];
                i++;
            }
            console.log("enemies length: ", i);
        } else {
            console.warn(
                "Pools not initialized yet, skipping zone change cleanup"
            );
        }
    }

    /*
    addOrUpdatePlayer(data: any) {
        if (!data.id || !data.timestamp) return;

        if (!this.players[data.id]) {
            const newPlayerSprite = this.add.sprite(data.x, data.y, 'gotchi_placeholder')
                .setDepth(1000)
                .setScale(1)
                .setName(data.id);

            this.players[data.id] = {
                sprite: newPlayerSprite,
                gotchiId: data.gotchiId || 0,
                isAssignedSVG: false,
                positionBuffer: [],
                hp: data.hp || 0,
                maxHp: data.maxHp || 0,
                ap: data.ap || 0,
                maxAp: data.maxAp || 0,
                gameXp: data.gameXp || 0,
                gameLevel: data.gameLevel || 1,
                gameXpOnCurrentLevel: data.gameXpOnCurrentLevel || 0,
                gameXpTotalForNextLevel: data.gameXpTotalForNextLevel || 0
            };
            console.log(`Added placeholder player ${data.id}`);
        }

        if (!player.isAssignedSVG && data.gotchiId !== 0) {
            player.gotchiId = data.gotchiId;
            player.isAssignedSVG = true;
            this.loadGotchiSVG(data.gotchiId, data.id, data.x, data.y);
        }

        if (player.isAssignedSVG && data.direction !== undefined) {
            const directions = ['front', 'left', 'right', 'back'];
            player.sprite.setTexture(`gotchi-${data.gotchiId}-${directions[data.direction]}`);
        }
    }
*/

    addOrUpdateEnemy(data: any) {
        // console.log(data);
        const { enemyId, x, y, zoneId, timestamp, type, maxHp, hp } = data;

        // see if the received enemy is part of one of the active zones
        var isEnemyInAnActiveZone =
            zoneId === this.activeZoneList.currentZoneId ||
            zoneId === this.activeZoneList.xAxisZoneId ||
            zoneId === this.activeZoneList.yAxisZoneId ||
            zoneId === this.activeZoneList.diagonalZoneId;

        if (
            this.rezoneBatchCounter >= this.rezoneBatchLimit ||
            !isEnemyInAnActiveZone
        ) {
            return;
        }

        var enemy = this.enemies[enemyId];
        var hasPoolSprites = enemy ? enemy.hasPoolSprites : true;

        // NEW ENEMY or DOES NOT HAVE POOL SPRITES
        if ((!enemy || !hasPoolSprites) && hp > 0) {
            this.rezoneBatchCounter++;

            // console.log(data);

            const bodySprite = this.pools.enemy.body.get();
            if (bodySprite) {
                bodySprite
                    .setVisible(true)
                    .setActive(true)
                    .setFrame(`${type}.png`);
            }

            const shadowSprite = this.pools.enemy.shadow.get();
            if (shadowSprite) {
                // console.log("show shadow sprite");
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
                    type: type,
                    positionBuffer: [],
                    direction: data.direction,
                    zoneId: zoneId,
                    hasPoolSprites: true,

                    maxHp: maxHp,
                    hp: hp,
                    previousHp: hp,
                };
            }
        }

        // GENERAL UPDATE
        if (this.enemies[enemyId] && hp > 0) {
            // position buffer for interpolation
            const enemy = this.enemies[enemyId];
            enemy.positionBuffer.push({
                x: x,
                y: y,
                timestamp: data.timestamp,
            });

            while (enemy.positionBuffer.length > MAX_POSITION_BUFFER_LENGTH) {
                enemy.positionBuffer.shift();
            }

            enemy.maxHp = maxHp;
            enemy.hp = hp;

            // update hp bar
            if (enemy.hpBar) {
                enemy.hpBar.width = (32 * hp) / maxHp;
            }

            if (data.direction !== undefined) {
                enemy.direction = data.direction;
            }

            // check for damage update
            if (enemy.hp < enemy.previousHp) {
                if (this.isEnemyOnScreen(enemy)) {
                    this.showDamageToEnemyPopupText(
                        enemy.previousHp - enemy.hp,
                        enemyId
                    );
                    if (enemy.flashSprite)
                        this.alphaFlashSprite(enemy.flashSprite);
                }
                enemy.previousHp = enemy.hp;
            }
        }

        // DEAD
        if (hp <= 0 && this.enemies[enemyId]) {
            const enemy = this.enemies[enemyId];
            if (enemy.bodySprite && enemy.shadowSprite && enemy.hpBar) {
                this.pools.enemy.body.killAndHide(enemy.bodySprite);
                this.pools.enemy.shadow.killAndHide(enemy.shadowSprite);
                this.pools.enemy.statBar.killAndHide(enemy.hpBar);
            }
            delete this.enemies[enemyId];
        }
    }

    showDamageToPlayerPopupText(damageValue: number, playerId: string) {
        var player = this.players[playerId];
        if (!player) return;

        const { x, y } = player.bodySprite;
        const offsetY = -64;
        const textColor = "red";

        const damageText = this.getPooledText(
            x,
            y + offsetY,
            damageValue.toString()
        );
        damageText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "24px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        damageText.setOrigin(0.5, 0.5).setDepth(3000);

        // vertical tween
        this.tweens.add({
            targets: damageText,
            y: damageText.y - 20,
            duration: 1000,
            ease: "Back.easeOut",
        });

        // horizontal tween
        this.tweens.add({
            targets: damageText,
            x: damageText.x + (Math.random() * 2 - 1) * 16,
            duration: 1000,
        });

        // fade tween
        this.tweens.add({
            targets: damageText,
            alpha: 0,
            duration: 1000,
            ease: "Quint.easeIn",
            onComplete: () => damageText.setVisible(false),
        });
    }

    showDamageToEnemyPopupText(damageValue: number, enemyId: string) {
        var enemy = this.enemies[enemyId];
        if (!enemy || !enemy.bodySprite) return;

        const { x, y } = enemy.bodySprite;
        const offsetY = -48;
        const textColor = "white";

        const damageText = this.getPooledText(
            x,
            y + offsetY,
            damageValue.toString()
        );
        damageText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "24px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        damageText.setOrigin(0.5, 0.5).setDepth(3000);

        // vertical tween
        this.tweens.add({
            targets: damageText,
            y: damageText.y - 20,
            duration: 1000,
            ease: "Back.easeOut",
        });

        // horizontal tween
        this.tweens.add({
            targets: damageText,
            x: damageText.x + (Math.random() * 2 - 1) * 16,
            duration: 1000,
        });

        // fade tween
        this.tweens.add({
            targets: damageText,
            alpha: 0,
            duration: 1000,
            ease: "Quint.easeIn",
            onComplete: () => damageText.setVisible(false),
        });
    }

    alphaFlashSprite(
        sprite: Phaser.GameObjects.Sprite,
        duration_ms: number = 250
    ) {
        if (!sprite || !sprite.scene) return;

        sprite.scene.tweens.add({
            targets: sprite,
            alpha: { from: 0, to: 1 },
            duration: duration_ms / 2,
            yoyo: true,
            ease: `Quad.easeInOut`,
            onComplete: () => {
                sprite.setAlpha(0);
            },
        });
    }

    handleLevelUp(data: any) {
        const player = this.players[this.localPlayerID];
        if (!player) return;

        const x = player.bodySprite.x;
        const y = player.bodySprite.y;
        const textColor = "#ffffff";
        const offsetY = 128 + 64;

        const levelUpText = this.getPooledText(x, y - offsetY, "Level Up!");
        levelUpText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "48px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        levelUpText.setOrigin(0.5, 0.5).setDepth(3000);

        const atkText = this.getPooledText(x, y - offsetY + 40, "ATK +10%");
        atkText.setStyle({
            fontFamily: "Pixelar",
            fontSize: "24px",
            color: textColor,
            stroke: "#000000",
            strokeThickness: 1,
        });
        atkText.setOrigin(0.5, 0.5).setDepth(3000);

        this.tweens.add({
            targets: [levelUpText, atkText],
            y: "-=20",
            alpha: 0,
            duration: 3000,
            ease: "Quad.easeIn",
            onComplete: () => {
                levelUpText.setVisible(false);
                atkText.setVisible(false);
            },
        });
    }

    createRectExplosion(
        x: number,
        y: number,
        radius = 16,
        duration = 500,
        minWidth = 5,
        maxWidth = 10,
        minHeight = 5,
        maxHeight = 10
    ) {
        for (let i = 0; i < 3; i++) {
            const angle = Phaser.Math.DegToRad(i * 120);
            const distance = Phaser.Math.Between(0, radius);
            const rectX = x + Math.cos(angle) * distance;
            const rectY = y + Math.sin(angle) * distance;
            const width = Phaser.Math.Between(minWidth, maxWidth);
            const height = Phaser.Math.Between(minHeight, maxHeight);

            const rect = this.add.graphics({ x: rectX, y: rectY });
            rect.fillStyle(0x888888, 1);
            rect.fillRect(0, 0, width, height);
            rect.setDepth(901);

            this.tweens.add({
                targets: rect,
                x: rect.x + Math.cos(angle) * radius * 1.5,
                y: rect.y + Math.sin(angle) * radius * 1.5,
                alpha: 0,
                duration: duration,
                ease: "Cubic.Out",
                onComplete: () => rect.destroy(),
            });
        }
    }

    // removeEnemy(id: string) {
    //     if (this.enemies[id]) {
    //         const x = this.enemies[id].bodySprite.x;
    //         const y = this.enemies[id].bodySprite.y;
    //         this.createRectExplosion(x, y);
    //         this.enemies[id].bodySprite.destroy();
    //         this.enemies[id].shadowSprite?.destroy();
    //         this.enemies[id].hpBar?.destroy();
    //         delete this.enemies[id];
    //     }
    // }

    showFireballTelegraphWarning(
        x: number,
        y: number,
        radius: number,
        duration_ms: number,
        casterType: "enemy" | "player"
    ) {
        const attackColor = casterType === "player" ? 0xffffff : 0x7a09fa;

        // const circle = this.getPooledCircle(x, y, radius, attackColor);
        const circle = this.add.circle(x, y, radius, attackColor);
        circle.setAlpha(0).setVisible(true).setDepth(901);
        circle.setPosition(x, y);

        this.tweens.add({
            targets: circle,
            alpha: 0.5,
            duration: duration_ms,
            onComplete: () => {
                circle.setFillStyle(0xea323c, 1);
                this.tweens.add({
                    targets: circle,
                    alpha: 0,
                    duration: 500,
                    onComplete: () => {
                        circle.destroy();
                    },
                });
            },
        });
    }

    showHammerSwing(x: number, y: number, casterType: "enemy" | "player") {
        const radius = casterType == "player" ? 100 : 70;
        const attackColor = casterType === "player" ? 0xffffff : 0xff0000;

        const circle = this.pools.vfx.circle.get();
        circle.setPosition(x, y);
        circle.setRadius(radius);
        circle.setFillStyle(attackColor);
        circle.setAlpha(0.5).setVisible(true).setDepth(900);

        const rectWidth = radius;
        const rectHeight = radius * 0.1;
        const rectangle = this.add.rectangle(
            radius * 0.75,
            0,
            rectWidth * 0.5,
            rectHeight,
            attackColor
        );
        rectangle.setAlpha(0.9);

        const container = this.add.container(x, y, [rectangle]).setDepth(901);
        container.rotation = Phaser.Math.DegToRad(90);

        this.tweens.add({
            targets: container,
            angle: 360,
            duration: 250,
            repeat: 0,
            ease: "Linear",
        });

        this.tweens.add({
            targets: [circle],
            alpha: 0.2,
            duration: 250,
            onComplete: () => {
                circle.setVisible(false);
                this.pools.vfx.circle.killAndHide(circle);
                container.destroy();
            },
        });
    }

    handleAttackUpdates(data: any) {
        const radius = data.radius;
        const x = data.x;
        const y = data.y;
        const attackColor = data.type === "playerAttack" ? 0xffffff : 0xff0000;

        const circle = this.pools.vfx.circle.get();
        circle.setPosition(x, y);
        circle.setRadius(radius);
        circle.setFillStyle(attackColor);
        circle.setAlpha(0.5).setVisible(true).setDepth(900);

        const rectWidth = radius;
        const rectHeight = radius * 0.1;
        const rectangle = this.add.rectangle(
            radius * 0.75,
            0,
            rectWidth * 0.5,
            rectHeight,
            attackColor
        );
        rectangle.setAlpha(0.9);

        const container = this.add.container(x, y, [rectangle]).setDepth(901);
        container.rotation = Phaser.Math.DegToRad(90);

        this.tweens.add({
            targets: container,
            angle: 360,
            duration: 250,
            repeat: 0,
            ease: "Linear",
        });

        this.tweens.add({
            targets: [circle],
            alpha: 0.2,
            duration: 250,
            onComplete: () => {
                circle.setVisible(false);
                this.pools.vfx.circle.killAndHide(circle);
                container.destroy();
            },
        });
    }

    createTilemapZone(
        zoneId: number,
        tilemapRef: string,
        worldX: number,
        worldY: number
    ) {
        // ignore null/0 zone
        if (
            zoneId === 0 ||
            tilemapRef === "" ||
            tilemapRef === "nil" ||
            tilemapRef === "null"
        )
            return;

        const map = this.make.tilemap({ key: tilemapRef });
        if (!map) {
            console.error("Tilemap failed to load");
            return;
        }

        // Dynamically load all tilesets used in the map
        const tilesets: Phaser.Tilemaps.Tileset[] = [];
        map.tilesets.forEach((tilesetData) => {
            const tilesetName = tilesetData.name;
            const tileset = map.addTilesetImage(
                tilesetName,
                tilesetName,
                32,
                32
            );
            // console.log("added tilest: ", tilesetName);
            if (tileset) {
                tilesets.push(tileset);
            } else {
                console.error(
                    `Tileset ${tilesetName} not found for map ${tilemapRef}`
                );
            }
        });

        if (tilesets.length === 0) {
            console.error(`No valid tilesets found for map ${tilemapRef}`);
            return;
        }

        // Create layers
        map.layers.forEach((layerData, index) => {
            const layerName = layerData.name;

            // Explicitly type properties as TilemapProperty[]
            const properties = layerData.properties as
                | TilemapProperty[]
                | undefined;

            const isHidden =
                properties?.find((prop) => prop.name === "isHidden")?.value ===
                true;
            const isEnemyLayer =
                properties?.find((prop) => prop.name === "isEnemyLayer")
                    ?.value === true;

            if (isHidden || isEnemyLayer) return;

            const layer = map.createLayer(layerName, tilesets, worldX, worldY);
            if (layer) {
                layer.setDepth(index);
                layer.setVisible(true);
            }
        });

        // map.layers.forEach((layerData, index) => {
        //     const layerName = layerData.name;

        //     // Explicitly type properties as TilemapProperty[]
        //     const properties = layerData.properties as TilemapProperty[] | undefined;

        //     const isHidden = properties?.find(prop => prop.name === 'isHidden')?.value === true;
        //     const isEnemyLayer = properties?.find(prop => prop.name === 'isEnemyLayer')?.value === true;

        //     if (isHidden || isEnemyLayer) return;

        //     const layer = map.createLayer(layerName, tileset, worldX, worldY);
        //     if (layer) {
        //         layer.setDepth(index);
        //         layer.setVisible(true);
        //     }
        // });

        this.tilemapZones[zoneId] = {
            zoneId: zoneId,
            tilemapRef: tilemapRef,
            worldX: worldX,
            worldY: worldY,
            tilemap: map,
        };
    }

    onGotchiSelected(gotchi: Aavegotchi) {
        this.registry.set("selectedGotchi", gotchi);
        this.registry.set("initialState", "spawnPlayer");
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            //   this.ws.send(JSON.stringify({ type: 'selectCharacter', data: { characterType: 'gotchi', characterId: gotchi.id } }));
        }
    }

    shutdown() {
        this.registry
            .get("game")
            ?.events.off("selectGotchi", this.onGotchiSelected, this);
        console.log("GameScene shutting down");
    }

    async loadGotchiSVG(
        gotchiId: string,
        playerID: string,
        x: number,
        y: number
    ) {
        try {
            const svgs = await fetchGotchiSVGs(gotchiId);
            const views: (keyof typeof svgs)[] = [
                "front",
                "left",
                "right",
                "back",
            ];
            views.forEach((view) => {
                const svgDataUrl = `data:image/svg+xml;base64,${btoa(
                    svgs[view]
                )}`;
                this.load.image(`gotchi-${gotchiId}-${view}`, svgDataUrl);
            });

            this.load.once("complete", () => {
                if (this.players[playerID]) {
                    this.players[playerID].bodySprite.destroy();
                    this.players[playerID].bodySprite = this.add
                        .sprite(x, y, `gotchi-${gotchiId}-front`)
                        .setDepth(1000)
                        .setScale(0.5)
                        .setName(playerID);
                    this.followedPlayerID = "";
                }
            });
            this.load.start();
        } catch (err) {
            console.error(
                "Failed to load Gotchi SVG for player",
                playerID,
                ":",
                err
            );
        }
    }

    removePlayer(id: string) {
        if (this.players[id]) {
            this.players[id].bodySprite.destroy();
            delete this.players[id];
        }
    }

    update(time: number, delta: number) {
        this.tickTimer -= delta / 1000;
        // console.log(this.moveTimer, this.ws, this.localPlayerID);
        while (this.tickTimer <= 0 && this.isConnected && this.localPlayerID) {
            this.tickTimer += 0.1; // 100ms input rate

            if (this.isConnected && this.localPlayerID) {
                this.keyState = {
                    W: this.keys.W.isDown,
                    A: this.keys.A.isDown,
                    S: this.keys.S.isDown,
                    D: this.keys.D.isDown,
                    SPACE: this.keys.SPACE.isDown,
                };
                const message = JSON.stringify({
                    type: "input",
                    data: {
                        keys: this.keyState,
                    },
                });
                try {
                    this.ws.send(message);
                    // console.log('Sent input for local player:', this.localPlayerID, this.keyState); // Add this log
                } catch (e) {
                    console.error("Failed to send input:", e);
                }
            }
        }

        this.registry.set("localfps", 1 / delta);

        this.interpolatePlayers();
        this.interpolateEnemies();
    }

    interpolatePlayers() {
        for (const id in this.players) {
            const player = this.players[id];
            if (player.positionBuffer.length === 0) continue;

            const targetTime = Date.now() - INTERPOLATION_DELAY_MS;
            const buffer = player.positionBuffer;

            if (buffer.length < 2) {
                player.bodySprite.setPosition(buffer[0].x, buffer[0].y);
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
            } else if (buffer.length > 0) {
                // Extrapolate if no newer position (using last known position)
                const last = buffer[buffer.length - 1];
                player.bodySprite.setPosition(last.x, last.y);
                player.flashSprite.setPosition(last.x, last.y);
            }
        }
    }

    interpolateEnemies() {
        if (!this.enemies) return;

        let i = 0;
        for (const id in this.enemies) {
            const enemy = this.enemies[id];
            if (!enemy) continue;
            if (
                !enemy ||
                !enemy.bodySprite ||
                !enemy.shadowSprite ||
                !enemy.hpBar
            )
                continue;
            if (enemy.positionBuffer.length === 0) continue;

            // for testing without interp
            // var latest = enemy.positionBuffer[enemy.positionBuffer.length-1];
            // enemy.bodySprite.setPosition(latest.x, latest.y);
            // enemy.shadowSprite?.setPosition(latest.x, latest.y+(enemy.bodySprite.height / 2)*10);
            // continue;

            const targetTime = Date.now() - INTERPOLATION_DELAY_MS;
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

            i++;
        }
    }

    getPooledText(x: number, y: number, text: string): Phaser.GameObjects.Text {
        let damageText = this.textPool.find((t) => !t.visible);
        if (!damageText) {
            damageText = this.add.text(x, y, text, {
                fontSize: "16px",
                color: "#ff0000",
            });
            this.textPool.push(damageText);
        } else {
            damageText
                .setPosition(x, y)
                .setText(text)
                .setVisible(true)
                .setAlpha(1);
        }
        return damageText;
    }

    /*
    resizeGame() {
        if (!this.cameras.main || !this.scale) return;

        const availableWidth = window.innerWidth;
        const availableHeight = window.innerHeight;
        const aspectRatio = 16 / 10;
        let newWidth = availableWidth;
        let newHeight = availableWidth / aspectRatio;
        if (newHeight > availableHeight) {
            newHeight = availableHeight;
            newWidth = newHeight * aspectRatio;
        }

        this.scale.resize(newWidth, newHeight);
        const zoom = Math.min(newWidth / GAME_WIDTH, newHeight / GAME_HEIGHT);
        this.cameras.main.setZoom(zoom*1.5);

        const canvas = this.game.canvas;
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';
    }
    */

    resizeGame() {
        if (!this.cameras.main || !this.scale) return;

        const availableWidth = window.innerWidth;
        const availableHeight = window.innerHeight;
        const aspectRatio = 16 / 10;

        const heightBasedOnAvailableWidth = availableWidth / aspectRatio;
        const widthBasedOnAvailableHeight = availableHeight * aspectRatio;

        const newWidth = Math.max(availableWidth, widthBasedOnAvailableHeight);
        const newHeight = newWidth / aspectRatio;
        console.log(newWidth, newHeight);

        // let newWidth = availableWidth;
        // let newHeight = availableWidth / aspectRatio;
        // if (newHeight > availableHeight) {
        //     newHeight = availableHeight;
        //     newWidth = newHeight * aspectRatio;
        // }

        // this.scale.resize(newWidth, newHeight);
        this.scale.setGameSize(newWidth, newHeight);
        const zoom = Math.min(newWidth / GAME_WIDTH, newHeight / GAME_HEIGHT);
        this.cameras.main.setZoom(zoom * 1.5);

        // const canvas = this.game.canvas;
        // canvas.style.position = 'absolute';
        // canvas.style.left = '50%';
        // canvas.style.top = '50%';
        // canvas.style.transform = 'translate(-50%, -50%)';
    }
}
