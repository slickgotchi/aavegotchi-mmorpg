import Phaser from "phaser";
import { fetchGotchiSVGs, Aavegotchi } from "./FetchGotchis";
import { PlayableCharacter } from "../components/IntroModal";
import { PlayerManager, Player, PositionUpdate } from "./Player";
import { EnemyManager, Enemy } from "./Enemy";
import { PoolManager, PoolManager as PoolManagerType } from "./Pools";
// import { TilemapZone, ActiveZoneList } from "./interfaces";
import { TilemapZone, ActiveZoneList } from "./interfaces";

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;
const MAX_POSITION_BUFFER_LENGTH = 10;
const MAX_CONCURRENT_ENEMIES = 1000;
const INTERPOLATION_DELAY_MS = 110;

const tileSize = 32;
const zoneSize = 256;

export class GameScene extends Phaser.Scene {
    private playerManager!: PlayerManager;
    private enemyManager!: EnemyManager;
    private poolManager!: PoolManager;
    public ws!: WebSocket;
    private keys!: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
        SPACE: Phaser.Input.Keyboard.Key;
    };
    private tickTimer = 0;
    private isConnected = false;
    private keyState = { W: false, A: false, S: false, D: false, SPACE: false };
    private activeZoneList!: ActiveZoneList;
    private tilemapZones: { [id: string]: TilemapZone } = {};
    private followedPlayerID: string = ""; // Add this property

    constructor() {
        super("GameScene");
    }

    preload() {
        this.load.image("tileset", "assets/tilemap/tileset.png");
        this.load.image("terrain", "assets/tilemap/tilesets/terrain.png");
        this.load.tilemapTiledJSON("mmorpg", "assets/tilemap/mmorpg.json");
        this.load.tilemapTiledJSON("default", "assets/tilemap/default.json");
        this.load.tilemapTiledJSON(
            "yield_fields_1",
            "assets/tilemap/maps/yield_fields_1.json"
        );
        this.load.font("Pixelar", "assets/fonts/pixelar/PixelarRegular.ttf");
        this.load.atlas(
            "enemies",
            "assets/enemies/enemies.png",
            "assets/enemies/enemies.json"
        );
        this.load.image("gotchi_placeholder", "/assets/gotchi_placeholder.png");
        this.load.image("duck_guardian", "/assets/avatars/duck_guardian.png");
        this.load.image("duck_ravager", "/assets/avatars/duck_ravager.png");
        this.load.image("duck_monk", "/assets/avatars/duck_monk.png");
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

        this.poolManager = new PoolManager(this);
        this.playerManager = new PlayerManager(this);
        this.enemyManager = new EnemyManager(this);
        this.playerManager.setPools(this.poolManager.getPools()); // Inject pools
        this.enemyManager.setPools(this.poolManager.getPools());

        this.resizeGame();
        window.addEventListener("resize", () => this.resizeGame());

        this.startWebSocketConnection();
    }

    getLocalPlayerID() {
        return this.playerManager ? this.playerManager.getLocalPlayerID() : "";
    }

    getPlayers() {
        return this.playerManager ? this.playerManager.getPlayers() : null;
    }

    startWebSocketConnection() {
        this.ws = new WebSocket("ws://localhost:8080/ws");
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
                    return;
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
                            this.playerManager.addOrUpdatePlayer(msg.data);
                            break;
                        case "enemyUpdate":
                            this.enemyManager.addOrUpdateEnemy(msg.data);
                            break;
                        case "abilityEffect":
                            this.handleAbilityEffect(msg.data);
                            break;
                        case "telegraphWarning":
                            this.handleTelegraphWarning(msg.data);
                            break;
                        default:
                            console.log("No event handler for: ", msg);
                    }
                    // this.rezoneBatchCounter = 0;
                    this.enemyManager.resetRezoneBatchCounter();
                });
            };
            this.ws.onerror = (e) => console.error("WebSocket error:", e);
            this.ws.onclose = (event: CloseEvent) => {
                console.log("WebSocket connection closed");
                console.log("Close Code:", event.code);
                console.log("Close Reason:", event.reason);
                console.log("Was Clean:", event.wasClean);
                if (this.playerManager.getLocalPlayerID()) {
                    this.playerManager.removePlayer(
                        this.playerManager.getLocalPlayerID()
                    );
                }
            };
        };
    }

    spawnPlayerCharacter(playableCharacter: PlayableCharacter) {
        if (!this.ws) return;
        this.ws.send(
            JSON.stringify({
                type: "spawnPlayerCharacter",
                data: playableCharacter,
            })
        );
    }

    handleTelegraphWarning(telegraphWarning: any) {
        const { casterId, impactX, impactY, radius, duration } =
            telegraphWarning;
        const enemy = this.enemyManager.getEnemies()[casterId];
        if (enemy) {
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
        const { ability, casterId, impactX, impactY } = abilityEffect;
        const enemy = this.enemyManager.getEnemies()[casterId];
        const player = this.playerManager.getPlayers()[casterId];
        if (ability === "HammerSwing") {
            if (enemy && enemy.bodySprite) {
                this.showHammerSwing(impactX, impactY, "enemy");
            } else if (player && player.bodySprite) {
                this.showHammerSwing(impactX, impactY, "player");
            }
        }
    }

    handleWelcome(datum: any) {
        const { playerId, zones } = datum;
        this.playerManager.setLocalPlayerID(playerId);
        this.playerManager.addOrUpdatePlayer({ playerId, ...datum });
        let maxX = 0;
        let maxY = 0;

        zones.forEach((zone: any) => {
            const { id, tilemapRef, worldX, worldY } = zone;
            this.createTilemapZone(id, tilemapRef, worldX, worldY);
            if (worldX > maxX) maxX = worldX;
            if (worldY > maxY) maxY = worldY;
        });

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
            currentZoneId,
            xAxisZoneId,
            yAxisZoneId,
            diagonalZoneId,
        };

        // this.enemyManager.setActiveZoneList(this.activeZoneList);
    }

    getActiveZoneList() {
        return this.activeZoneList;
    }

    releasePoolSpritesOfZone(zoneId: number) {
        if (this.poolManager && this.poolManager.getPools().enemy) {
            for (const enemyId in this.enemyManager.getEnemies()) {
                const enemy = this.enemyManager.getEnemies()[enemyId];
                if (enemy.zoneId === zoneId) {
                    if (enemy.bodySprite)
                        this.poolManager
                            .getPools()
                            .enemy.body.killAndHide(enemy.bodySprite);
                    if (enemy.shadowSprite)
                        this.poolManager
                            .getPools()
                            .enemy.shadow.killAndHide(enemy.shadowSprite);
                    if (enemy.flashSprite)
                        this.poolManager
                            .getPools()
                            .enemy.flashSprite.killAndHide(enemy.flashSprite);
                    if (enemy.hpBar)
                        this.poolManager
                            .getPools()
                            .enemy.statBar.killAndHide(enemy.hpBar);
                    enemy.hasPoolSprites = false;
                    delete this.enemyManager.getEnemies()[enemyId];
                }
            }
        } else {
            console.warn(
                "Pools not initialized yet, skipping zone change cleanup"
            );
        }
    }

    createTilemapZone(
        zoneId: number,
        tilemapRef: string,
        worldX: number,
        worldY: number
    ) {
        if (
            zoneId === 0 ||
            !tilemapRef ||
            tilemapRef === "nil" ||
            tilemapRef === "null"
        )
            return;

        const map = this.make.tilemap({ key: tilemapRef });
        if (!map) {
            console.error("Tilemap failed to load");
            return;
        }

        const tilesets: Phaser.Tilemaps.Tileset[] = [];
        map.tilesets.forEach((tilesetData) => {
            const tilesetName = tilesetData.name;
            const tileset = map.addTilesetImage(
                tilesetName,
                tilesetName,
                32,
                32
            );
            if (tileset) tilesets.push(tileset);
            else
                console.error(
                    `Tileset ${tilesetName} not found for map ${tilemapRef}`
                );
        });

        if (tilesets.length === 0) {
            console.error(`No valid tilesets found for map ${tilemapRef}`);
            return;
        }

        map.layers.forEach((layerData, index) => {
            const layerName = layerData.name;
            const properties = layerData.properties as
                | { name: string; value: any }[]
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
                layer.setDepth(index).setVisible(true);
            }
        });

        this.tilemapZones[zoneId] = {
            zoneId,
            tilemapRef,
            worldX,
            worldY,
            tilemap: map,
        };
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
                const player = this.playerManager.getPlayers()[playerID];
                if (player) {
                    player.bodySprite.destroy();
                    player.bodySprite = this.add
                        .sprite(x, y, `gotchi-${gotchiId}-front`)
                        .setDepth(1000)
                        .setScale(0.5)
                        .setName(playerID);
                    this.playerManager.getPlayers()[playerID] = player;
                    this.playerManager.getLocalPlayerID() &&
                        (this.followedPlayerID = "");
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

    showFireballTelegraphWarning(
        x: number,
        y: number,
        radius: number,
        duration_ms: number,
        casterType: "enemy" | "player"
    ) {
        const attackColor = casterType === "player" ? 0xffffff : 0x7a09fa;
        const circle = this.add
            .circle(x, y, radius, attackColor)
            .setAlpha(0)
            .setVisible(true)
            .setDepth(901);
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
                    onComplete: () => circle.destroy(),
                });
            },
        });
    }

    showHammerSwing(x: number, y: number, casterType: "enemy" | "player") {
        const radius = casterType === "player" ? 100 : 70;
        const attackColor = casterType === "player" ? 0xffffff : 0xff0000;
        const circle = this.poolManager.getPools().vfx.circle.get();
        circle
            .setPosition(x, y)
            .setRadius(radius)
            .setFillStyle(attackColor)
            .setAlpha(0.5)
            .setVisible(true)
            .setDepth(900);

        const rectWidth = radius;
        const rectHeight = radius * 0.1;
        const rectangle = this.add
            .rectangle(
                radius * 0.75,
                0,
                rectWidth * 0.5,
                rectHeight,
                attackColor
            )
            .setAlpha(0.9);
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
                this.poolManager.getPools().vfx.circle.killAndHide(circle);
                container.destroy();
            },
        });
    }

    update(time: number, delta: number) {
        this.tickTimer -= delta / 1000;
        while (
            this.tickTimer <= 0 &&
            this.isConnected &&
            this.playerManager.getLocalPlayerID()
        ) {
            this.tickTimer += 0.1;
            this.keyState = {
                W: this.keys.W.isDown,
                A: this.keys.A.isDown,
                S: this.keys.S.isDown,
                D: this.keys.D.isDown,
                SPACE: this.keys.SPACE.isDown,
            };
            const message = JSON.stringify({
                type: "input",
                data: { keys: this.keyState },
            });
            try {
                this.ws.send(message);
            } catch (e) {
                console.error("Failed to send input:", e);
            }
        }

        this.registry.set("localfps", 1 / delta);
        this.playerManager.interpolatePlayers();
        this.enemyManager.interpolateEnemies();
    }

    shutdown() {
        console.log("GameScene shutting down");
        this.playerManager.shutdown();
        this.enemyManager.shutdown();
        this.poolManager.shutdown();
        for (const zoneId in this.tilemapZones) {
            const zone = this.tilemapZones[zoneId];
            if (zone.tilemap) zone.tilemap.destroy();
        }
        this.tilemapZones = {};
        window.removeEventListener("resize", () => this.resizeGame());
    }

    resizeGame() {
        if (!this.cameras.main || !this.scale) return;
        const availableWidth = window.innerWidth;
        const availableHeight = window.innerHeight;
        const aspectRatio = 16 / 10;
        const widthBasedOnAvailableHeight = availableHeight * aspectRatio;
        const newWidth = Math.max(availableWidth, widthBasedOnAvailableHeight);
        const newHeight = newWidth / aspectRatio;
        this.scale.setGameSize(newWidth, newHeight);
        const zoom = Math.min(newWidth / GAME_WIDTH, newHeight / GAME_HEIGHT);
        this.cameras.main.setZoom(zoom * 1.5);
    }
}
