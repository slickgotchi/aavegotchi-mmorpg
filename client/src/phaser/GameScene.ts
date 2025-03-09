import Phaser from 'phaser';
import { fetchGotchiSVGs, Aavegotchi } from './FetchGotchis';

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;
const MAX_POSITION_BUFFER_LENGTH = 10;
const MAX_CONCURRENT_ENEMIES = 10000;

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
    sprite: Phaser.GameObjects.Sprite;
    gotchiId: number;
    isAssignedSVG: boolean;
    positionBuffer: PositionUpdate[];

    // game stats
    maxHp: number;
    ap: number;
    hp: number;
    maxAp: number;

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
    hpBar: Phaser.GameObjects.Rectangle | null;

    type: string;
    positionBuffer: PositionUpdate[];
    direction?: number;
    zoneId: number;
    hasPoolSprites: boolean;

    maxHp: number;
    hp: number;
}

export interface PoolManager {
    enemy: {
        body: Phaser.GameObjects.Group,
        shadow: Phaser.GameObjects.Group,
        statBar: Phaser.GameObjects.Group,
    }
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
    private ws!: WebSocket;
    private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; SPACE: Phaser.Input.Keyboard.Key };
    private tickTimer = 0;
    private circlePool: Phaser.GameObjects.Graphics[] = [];
    private textPool: Phaser.GameObjects.Text[] = [];
    private isConnected = false;
    private keyState = { W: false, A: false, S: false, D: false, SPACE: false };
    private localPlayerID!: string;
    // private localZoneId = 0;
    private followedPlayerID!: string;
    private activeZoneList!: ActiveZoneList;

    private rezoneBatchCounter = 0;
    private rezoneBatchLimit = 20;

    private tilemapZones: { [id: string] : TilemapZone } = {};

    private pools!: PoolManager;

    private enemies: {[id:string]: Enemy} = {}

    public getPlayers() { return this.players; }
    public getLocalPlayerID() { return this.localPlayerID; }

    constructor() {
        super('GameScene');
    }

    preload() {
        // TILEMAPPING
        this.load.image('tileset', 'assets/tilemap/tileset.png');
        this.load.tilemapTiledJSON('mmorpg', 'assets/tilemap/mmorpg.json');
        this.load.tilemapTiledJSON('default', 'assets/tilemap/default.json');

        // FONTS
        this.load.font('Pixelar', 'assets/fonts/pixelar/PixelarRegular.ttf');
        
        // ENEMIES (& THEIR SHADOWS)
        this.load.atlas('enemies', 'assets/enemies/enemies.png', 'assets/enemies/enemies.json');

        // MISC
        this.load.image('gotchi_placeholder', '/assets/gotchi_placeholder.png');
    }

    create(){
        if (this.input.keyboard === null) return;

        this.keys = {
            W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        };

        this.activeZoneList = {
            currentZoneId: -1000,
            xAxisZoneId: -1000,
            yAxisZoneId: -1000,
            diagonalZoneId: -1000,
        }

        // init body pool
        var enemyBodyPool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: spriteGameObject => {
                var sprite = spriteGameObject as Phaser.GameObjects.Sprite;
                sprite.setTexture('enemies'); // Single texture atlas for all bodies
                sprite.setVisible(false); // Hidden until assigned
                sprite.setActive(false); // Inactive until assigned
                sprite.setDepth(501);
                sprite.setFrame('easy.png');
                sprite.setScale(1);

            }
        });
        enemyBodyPool.createMultiple({ key: 'enemies', quantity: MAX_CONCURRENT_ENEMIES, active: false, visible: false });

        // Initialize shadow pool
        var enemyShadowPool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Sprite,
            createCallback: spriteGameObject => {
                var sprite = spriteGameObject as Phaser.GameObjects.Sprite;
                sprite.setTexture('enemies'); // Single texture atlas for all shadows
                sprite.setVisible(false); // Hidden until assigned
                sprite.setActive(false); // Inactive until assigned
                sprite.setDepth(500);
                sprite.setAlpha(0.5);
                sprite.setFrame('shadow.png');
                sprite.setScale(1);
            }
        });
        enemyShadowPool.createMultiple({ key: 'enemies', quantity: MAX_CONCURRENT_ENEMIES, active: false, visible: false });

        // Initialize rectangle pool
        var enemyStatBarPool = this.add.group({
            maxSize: MAX_CONCURRENT_ENEMIES,
            classType: Phaser.GameObjects.Rectangle,
            createCallback: (rectGameObject) => {
                var rect = rectGameObject as Phaser.GameObjects.Rectangle;
                rect.setSize(32, 8); // Set the rectangle size
                rect.setFillStyle(0xff0000); // Red color
                rect.setVisible(false); // Hidden until assigned
                rect.setActive(false); // Inactive until assigned
                rect.setDepth(500);
                rect.setAlpha(1);
            }
        });

        // Pre-create all rectangles
        enemyStatBarPool.createMultiple({
            key: '',
            quantity: MAX_CONCURRENT_ENEMIES,
            active: false,
            visible: false
        });



        // add all pools to the overall pool list
        this.pools = {
            enemy: {
                body: enemyBodyPool,
                shadow: enemyShadowPool,
                statBar: enemyStatBarPool,
            }
        }


        // this.createTilemap();

        this.ws = new WebSocket("ws://localhost:8080/ws");
        this.ws.onopen = () => {
            console.log('Connected to server');
            this.isConnected = true;

            this.ws.onmessage = (event) => {
                const messages = JSON.parse(event.data);
                messages.forEach((msg:any) => {
                    switch (msg.type){
                        case 'welcome':
                            this.handleWelcome(msg.data);
                        break;
                        case 'activeZones':
                            this.handleActiveZoneList(msg.data);
                            break;
                        case 'playerUpdates':
                            msg.data.forEach((update:any) => {
                                this.addOrUpdatePlayer(update);
                            });
                        break;

                        case 'enemyUpdates':
                            msg.data.forEach((update:any) => {
                                this.addOrUpdateEnemy(update);
                            });
                        break;

                        default: break;
                    }

                    this.rezoneBatchCounter = 0;
                });
            }

            this.ws.onerror = (e) => console.error('WebSocket error:', e);
            this.ws.onclose = () => {
                console.log('WebSocket closed');
                this.isConnected = false;
            };
        }

        this.resizeGame();
        window.addEventListener('resize', () => this.resizeGame());
    }

    handleWelcome(datum: any) {
        const { playerId, zones } = datum;
        this.localPlayerID = playerId;
        console.log("Welcome ", this.localPlayerID);

        let maxX = 0;
        let maxY = 0;

        zones.forEach((zone: any) => {
            const {id, tilemapRef, worldX, worldY } = zone;
            this.createTilemapZone(id, tilemapRef, worldX, worldY);

            if (worldX > maxX) maxX = worldX;
            if (worldY > maxY) maxY = worldY;
        });

        // set camera extents to the max world positions + a zone width/height
        this.cameras.main.setBounds(0, 0, maxX + zoneSize*tileSize, maxY + zoneSize*tileSize);

    }

    handleActiveZoneList(datum: any){
        const {currentZoneId, xAxisZoneId, yAxisZoneId, diagonalZoneId } = datum;

        if (!this.activeZoneList) return;

        if (this.activeZoneList.currentZoneId !== currentZoneId &&
            this.activeZoneList.currentZoneId !== xAxisZoneId &&
            this.activeZoneList.currentZoneId !== yAxisZoneId &&
            this.activeZoneList.currentZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.currentZoneId);
        }

        if (this.activeZoneList.xAxisZoneId !== currentZoneId &&
            this.activeZoneList.xAxisZoneId !== xAxisZoneId &&
            this.activeZoneList.xAxisZoneId !== yAxisZoneId &&
            this.activeZoneList.xAxisZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.xAxisZoneId);
        }

        if (this.activeZoneList.yAxisZoneId !== currentZoneId &&
            this.activeZoneList.yAxisZoneId !== xAxisZoneId &&
            this.activeZoneList.yAxisZoneId !== yAxisZoneId &&
            this.activeZoneList.yAxisZoneId !== diagonalZoneId
        ) {
            this.releasePoolSpritesOfZone(this.activeZoneList.yAxisZoneId);
        }

        if (this.activeZoneList.diagonalZoneId !== currentZoneId &&
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
        }
    }

    releasePoolSpritesOfZone(zoneId: number){
        // Guard against undefined pools
        if (this.pools && this.pools.enemy) {
            // Deactivate all existing enemy sprites instead of clearing pools
            for (const enemyId in this.enemies) {
                const enemy = this.enemies[enemyId];
                if (enemy.zoneId === zoneId) {
                    if (enemy.bodySprite) {
                        this.pools.enemy.body.killAndHide(enemy.bodySprite);
                        enemy.bodySprite = null;
                        enemy.hasPoolSprites = false;
                    }
                    if (enemy.shadowSprite) {
                        this.pools.enemy.shadow.killAndHide(enemy.shadowSprite);
                        enemy.shadowSprite = null;
                        enemy.hasPoolSprites = false;
                    }
                    delete this.enemies[enemyId];
                }
            }
        } else {
            console.warn('Pools not initialized yet, skipping zone change cleanup');
        }
    }

    /*
    create() {
        if (this.input.keyboard === null) return;

        this.keys = {
            W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        };

        this.createTilemap();

        for (let i = 0; i < 10; i++) {
            const circle = this.add.graphics();
            circle.fillStyle(0xff0000, 0);
            circle.fillCircle(0, 0, 128);
            circle.setVisible(false);
            this.circlePool.push(circle);

            const text = this.add.text(0, 0, '', { fontSize: '16px', color: '#ff0000' }).setVisible(false);
            this.textPool.push(text);
        }

        this.ws = new WebSocket('ws://localhost:8080/ws');
        this.ws.onopen = () => {
            console.log('Connected to server');
            this.isConnected = true;

            this.ws.onmessage = (e) => {
                let msg;
                try {
                    msg = JSON.parse(e.data);
                } catch (err) {
                    console.error('Failed to parse message:', err, 'Data:', e.data);
                    return;
                }
                // let data = msg.data;
                console.log(msg);

                switch (msg.type){
                    case "welcome":
                        this.localPlayerID = msg.data.playerID
                        console.log("localPlayerID: ", this.localPlayerID);
                        break;
                    case "playerUpdates":
                        const {zone,playerUpdateData} = msg.data;
                        // console.log("Zone: ", msg.zone, " playerUpdates");
                        playerUpdateData.forEach((playerUpdateDatum: any) => {
                            // console.log("playerUpdate: ", playerUpdateDatum);
                            this.addOrUpdatePlayer(playerUpdateDatum);
                        });
                        break;
                    default: break;
                }

                
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (err) {
                        console.error('Failed to parse nested data:', err, 'Data:', data);
                        return;
                    }
                }
                switch (msg.type) {
                    case "welcome":
                        this.localPlayerID = data.id; // Now correctly accesses parsed id
                        console.log("Local Player ID:", this.localPlayerID);
                        this.followedPlayerID = "";
                        break;
                    case "playerUpdates":
                        if (Array.isArray(data)) {
                            data.forEach(update => this.addOrUpdatePlayer(update));
                        }
                        break;
                    case "attackUpdates":
                        if (Array.isArray(data)) {
                            data.forEach(datum => this.handleAttackUpdates(datum));
                        }
                        break;
                    case "damageUpdates":
                        if (Array.isArray(data)) {
                            data.forEach(datum => this.handleDamageUpdate(datum));
                        }
                        break;
                    case "playerDisconnected":
                        this.removePlayer(data.id);
                        break;
                    case "enemyUpdates":
                        if (Array.isArray(data)) {
                            data.forEach(datum => this.addOrUpdateEnemy(datum));
                        }
                        break;
                    case "levelUp":
                        this.registry.events.emit('levelUp', data);
                        this.handleLevelUp(data);
                        break;
                }
                        
            };
            this.ws.onerror = (e) => console.error('WebSocket error:', e);
            this.ws.onclose = () => {
                console.log('WebSocket closed');
                this.isConnected = false;
            };
        };

        this.resizeGame();
        window.addEventListener('resize', () => this.resizeGame());

        this.registry.get('game')?.events.on('selectGotchi', this.onGotchiSelected, this);
    }
    */

    addOrUpdatePlayer(datum: any){
        const {playerId, x, y, zoneId, timestamp,
            maxHp, hp, maxAp, ap,
            gameXp, gameLevel, gameXpOnCurrentLevel, gameXpTotalForNextLevel,
        } = datum;

        // NEW PLAYER
        if (!this.players[playerId]){
            const newPlayerSprite = this.add.sprite(x, y, 'gotchi_placeholder')
                .setDepth(1000)
                .setScale(1)

            this.players[playerId] = {
                sprite: newPlayerSprite,
                gotchiId: 0,
                isAssignedSVG: false,
                positionBuffer: [],

                // game stats
                maxHp: maxHp,
                hp: hp,
                maxAp: maxAp,
                ap: ap,

                // xp
                gameXp: gameXp,
                gameLevel: gameLevel,
                gameXpOnCurrentLevel: gameXpOnCurrentLevel,
                gameXpTotalForNextLevel: gameXpTotalForNextLevel,
            };
            console.log(`Added player ${playerId}`);
        }

        // GENERAL UPDATES
        if (this.players[playerId]){
            // position buffer updates
            const player = this.players[playerId];
            player.positionBuffer.push({
                x: x,
                y: y,
                timestamp: timestamp
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

            // console.log(player, this.players[playerId]);
        }

        // LOCAL PLAYER
        if (this.localPlayerID === playerId) {
            if (!this.followedPlayerID) {
                this.followedPlayerID = this.localPlayerID;
                this.cameras.main.startFollow(this.players[playerId].sprite, false, 0.1, 0.1)
            }
        }
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
            console.warn('Pools not initialized yet, skipping zone change cleanup');
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

        const player = this.players[data.id];
        player.positionBuffer.push({
            x: data.x,
            y: data.y,
            timestamp: data.timestamp
        });

        while (player.positionBuffer.length > MAX_POSITION_BUFFER_LENGTH) {
            player.positionBuffer.shift();
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

        if (data.id === this.localPlayerID) {
            if (this.followedPlayerID !== data.id) {
                this.followedPlayerID = data.id;
                this.cameras.main.startFollow(player.sprite, true);
            }
            player.hp = data.hp;
            player.maxHp = data.maxHp;
            player.ap = data.ap;
            player.maxAp = data.maxAp;
            player.gameXp = data.gameXp;
            player.gameLevel = data.gameLevel;
            player.gameXpOnCurrentLevel = data.gameXpOnCurrentLevel;
            player.gameXpTotalForNextLevel = data.gameXpTotalForNextLevel;
        }
    }
*/

    addOrUpdateEnemy(data: any) {
        const {enemyId, x, y, zoneId, timestamp, type, maxHp, hp } = data;

        // see if the received enemy is part of one of the active zones
        var isEnemyInAnActiveZone = zoneId === this.activeZoneList.currentZoneId ||
            zoneId === this.activeZoneList.xAxisZoneId ||
            zoneId === this.activeZoneList.yAxisZoneId ||
            zoneId === this.activeZoneList.diagonalZoneId;

        if (this.rezoneBatchCounter >= this.rezoneBatchLimit || !isEnemyInAnActiveZone) {
            return;
        }

        var enemy = this.enemies[enemyId]
        var hasPoolSprites = enemy ? enemy.hasPoolSprites : true;


        // NEW ENEMY or DOES NOT HAVE POOL SPRITES
        if ((!enemy || !hasPoolSprites) && hp > 0) {
            this.rezoneBatchCounter++;

            const bodySprite = this.pools.enemy.body.get();
            if (bodySprite) {
                bodySprite.setVisible(true)
                .setActive(true)
                .setDepth(500)
                .setAlpha(1)
                .setFrame(`${type}.png`);
            }

            const shadowSprite = this.pools.enemy.shadow.get();
            if (shadowSprite){
                shadowSprite.setVisible(true)
                    .setActive(true)
                    .setDepth(499)
                    .setAlpha(0.5)
                    .setFrame('shadow.png');
            }

            const hpBar = this.pools.enemy.statBar.get();
            if (hpBar) {
                hpBar.setVisible(true)
                    .setActive(true)
                    .setDepth(501)
            }

            if (bodySprite && shadowSprite) {
                this.enemies[enemyId] = {
                    bodySprite,
                    shadowSprite,
                    hpBar,
                    type: type,
                    positionBuffer: [],
                    direction: data.direction,
                    zoneId: zoneId,
                    hasPoolSprites: true,

                    maxHp: maxHp,
                    hp: hp,
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
                timestamp: data.timestamp
            });

            while (enemy.positionBuffer.length > MAX_POSITION_BUFFER_LENGTH) {
                enemy.positionBuffer.shift();
            }

            enemy.maxHp = maxHp;
            enemy.hp = hp;

            if (data.direction !== undefined) {
                enemy.direction = data.direction;
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

    // handleDamageUpdate(data: any) {
    //     const { id, type, damage } = data;
    //     let x: number, y: number, textColor: string, offsetY: number;

    //     if (type === "enemy" && this.enemies[id]) {
    //         x = this.enemies[id].bodySprite.x;
    //         y = this.enemies[id].bodySprite.y;
    //         textColor = '#ffffff';
    //         offsetY = -32;
    //     } else if (type === "player" && this.players[id]) {
    //         x = this.players[id].sprite.x;
    //         y = this.players[id].sprite.y;
    //         textColor = '#ff0000';
    //         offsetY = -64;
    //     } else {
    //         return;
    //     }

    //     const damageText = this.getPooledText(x, y + offsetY, damage.toString());
    //     damageText.setStyle({
    //         fontFamily: 'Pixelar',
    //         fontSize: '24px',
    //         color: textColor,
    //         stroke: '#000000',
    //         strokeThickness: 1,
    //     });
    //     damageText.setOrigin(0.5, 0.5).setDepth(3000);

    //     this.tweens.add({
    //         targets: damageText,
    //         y: damageText.y - 20,
    //         alpha: 0,
    //         duration: 1000,
    //         ease: 'Quad.easeIn',
    //         onComplete: () => damageText.setVisible(false),
    //     });
    // }

    handleLevelUp(data: any) {
        const player = this.players[this.localPlayerID];
        if (!player) return;

        const x = player.sprite.x;
        const y = player.sprite.y;
        const textColor = '#ffffff';
        const offsetY = 128 + 64;

        const levelUpText = this.getPooledText(x, y - offsetY, "Level Up!");
        levelUpText.setStyle({
            fontFamily: 'Pixelar',
            fontSize: '48px',
            color: textColor,
            stroke: '#000000',
            strokeThickness: 1,
        });
        levelUpText.setOrigin(0.5, 0.5).setDepth(3000);

        const atkText = this.getPooledText(x, y - offsetY + 40, "ATK +10%");
        atkText.setStyle({
            fontFamily: 'Pixelar',
            fontSize: '24px',
            color: textColor,
            stroke: '#000000',
            strokeThickness: 1,
        });
        atkText.setOrigin(0.5, 0.5).setDepth(3000);

        this.tweens.add({
            targets: [levelUpText, atkText],
            y: '-=20',
            alpha: 0,
            duration: 3000,
            ease: 'Quad.easeIn',
            onComplete: () => {
                levelUpText.setVisible(false);
                atkText.setVisible(false);
            },
        });
    }

    createRectExplosion(x: number, y: number, radius = 16, duration = 500, minWidth = 5, maxWidth = 10, minHeight = 5, maxHeight = 10) {
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
                ease: 'Cubic.Out',
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

    // updateEnemyHP(id: string) {
    //     if (this.enemies[id]) {
    //         const enemy = this.enemies[id];
    //         if (enemy.hp <= 0) {
    //             this.removeEnemy(id);
    //         } else {
    //             // enemy.hpBar?.width = 32 * (enemy.hp / enemy.maxHp);
    //         }
    //     }
    // }

    handleAttackUpdates(data: any) {
        const radius = data.radius;
        const x = data.x;
        const y = data.y;
        const attackColor = data.type === "playerAttack" ? 0xffffff : 0xff0000;

        const circle = this.getPooledCircle(x, y, radius, attackColor);
        circle.setAlpha(0.5).setVisible(true).setDepth(900);

        const rectWidth = radius;
        const rectHeight = radius * 0.1;
        const rectangle = this.add.rectangle(radius * 0.75, 0, rectWidth * 0.5, rectHeight, attackColor);
        rectangle.setAlpha(0.9);

        const container = this.add.container(x, y, [rectangle]).setDepth(901);
        container.rotation = Phaser.Math.DegToRad(90);

        this.tweens.add({
            targets: container,
            angle: 360,
            duration: 250,
            repeat: 0,
            ease: 'Linear',
        });

        this.tweens.add({
            targets: [circle],
            alpha: 0.2,
            duration: 250,
            onComplete: () => {
                circle.setVisible(false);
                container.destroy();
            },
        });
    }

    createTilemapZone(zoneId: number, tilemapRef: string, worldX: number, worldY: number) {
        // ignore null/0 zone
        if (zoneId === 0 || tilemapRef === "" || tilemapRef === "nil" || 
            tilemapRef === "null") return;
        
        const map = this.make.tilemap({ key: tilemapRef });
        if (!map) {
            console.error('Tilemap failed to load');
            return;
        }
        const tileset = map.addTilesetImage('tileset', 'tileset', 32, 32);
        if (!tileset) {
            console.error('Tileset not found');
            return;
        }
    
        map.layers.forEach((layerData, index) => {
            const layerName = layerData.name;
    
            // Explicitly type properties as TilemapProperty[]
            const properties = layerData.properties as TilemapProperty[] | undefined;
    
            const isHidden = properties?.find(prop => prop.name === 'isHidden')?.value === true;
            const isEnemyLayer = properties?.find(prop => prop.name === 'isEnemyLayer')?.value === true;
    
            if (isHidden || isEnemyLayer) return;
    
            const layer = map.createLayer(layerName, tileset, worldX, worldY);
            if (layer) {
                layer.setDepth(index);
                layer.setVisible(true);
            }
        });

        this.tilemapZones[zoneId] = {
            zoneId: zoneId,
            tilemapRef: tilemapRef,
            worldX: worldX,
            worldY: worldY,
            tilemap: map,
        }
    }

    onGotchiSelected(gotchi: Aavegotchi) {
        this.registry.set('selectedGotchi', gotchi);
        this.registry.set('initialState', 'spawnPlayer');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'join', data: { gotchiId: gotchi.id } }));
        }
    }

    shutdown() {
        this.registry.get('game')?.events.off('selectGotchi', this.onGotchiSelected, this);
        console.log('GameScene shutting down');
    }

    async loadGotchiSVG(gotchiId: string, playerID: string, x: number, y: number) {
        try {
            const svgs = await fetchGotchiSVGs(gotchiId);
            const views: (keyof typeof svgs)[] = ["front", "left", "right", "back"];
            views.forEach(view => {
                const svgDataUrl = `data:image/svg+xml;base64,${btoa(svgs[view])}`;
                this.load.image(`gotchi-${gotchiId}-${view}`, svgDataUrl);
            });

            this.load.once('complete', () => {
                if (this.players[playerID]) {
                    this.players[playerID].sprite.destroy();
                    this.players[playerID].sprite = this.add.sprite(x, y, `gotchi-${gotchiId}-front`)
                        .setDepth(1000)
                        .setScale(0.5)
                        .setName(playerID);
                    this.followedPlayerID = "";
                }
            });
            this.load.start();
        } catch (err) {
            console.error('Failed to load Gotchi SVG for player', playerID, ':', err);
        }
    }

    removePlayer(id: string) {
        if (this.players[id]) {
            this.players[id].sprite.destroy();
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
                const message = JSON.stringify({ type: 'input', data: { 
                    keys: this.keyState } });
                try {
                    this.ws.send(message);
                    // console.log('Sent input for local player:', this.localPlayerID, this.keyState); // Add this log
                } catch (e) {
                    console.error('Failed to send input:', e);
                }
            }
        }
        
        this.registry.set('localfps', 1/delta);

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
                player.sprite.setPosition(buffer[0].x, buffer[0].y);
                continue;
            }

            let older, newer;
            for (let i = 0; i < buffer.length - 1; i++) {
                if (buffer[i].timestamp <= targetTime && buffer[i + 1].timestamp >= targetTime) {
                    older = buffer[i];
                    newer = buffer[i + 1];
                    break;
                }
            }

            if (older && newer) {
                const alpha = (targetTime - older.timestamp) / (newer.timestamp - older.timestamp);
                const interpX = older.x + (newer.x - older.x) * Math.min(1, Math.max(0, alpha));
                const interpY = older.y + (newer.y - older.y) * Math.min(1, Math.max(0, alpha));
                player.sprite.setPosition(interpX, interpY);
            } else if (buffer.length > 0) {
                // Extrapolate if no newer position (using last known position)
                const last = buffer[buffer.length - 1];
                player.sprite.setPosition(last.x, last.y);
            }
        }
    }

    interpolateEnemies() {
        if (!this.enemies) return;

        let i = 0;
        for (const id in this.enemies) {
            const enemy = this.enemies[id];
            if (!enemy) continue;
            if (!enemy || !enemy.bodySprite || !enemy.shadowSprite || !enemy.hpBar) continue;
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
                if (buffer[i].timestamp <= targetTime && buffer[i + 1].timestamp >= targetTime) {
                    older = buffer[i];
                    newer = buffer[i + 1];
                    break;
                }
            }

            if (older && newer) {
                const alpha = (targetTime - older.timestamp) / (newer.timestamp - older.timestamp);
                const interpX = older.x + (newer.x - older.x) * Math.min(1, Math.max(0, alpha));
                const interpY = older.y + (newer.y - older.y) * Math.min(1, Math.max(0, alpha));
                enemy.bodySprite.setPosition(interpX, interpY);
                enemy.shadowSprite.setPosition(interpX, interpY + (enemy.bodySprite.height *0.75));
                enemy.hpBar.setPosition(interpX, interpY - (enemy.bodySprite.height) * 0.75);
            } else if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                enemy.bodySprite.setPosition(last.x, last.y);
                enemy.shadowSprite.setPosition(last.x, last.y + (enemy.bodySprite.height *0.5));
                enemy.hpBar.setPosition(last.x, last.y - (enemy.bodySprite.height) * 0.5);
            }

            i++;
        }

    }

    getPooledCircle(x: number, y: number, radius: number, color: number): Phaser.GameObjects.Graphics {
        let circle = this.circlePool.find(c => !c.visible);
        if (!circle) {
            circle = this.add.graphics();
            this.circlePool.push(circle);
        } else {
            circle.clear();
            circle.setVisible(true);
        }
        circle.fillStyle(color, 0.5);
        circle.fillCircle(x, y, radius);
        return circle;
    }

    getPooledText(x: number, y: number, text: string): Phaser.GameObjects.Text {
        let damageText = this.textPool.find(t => !t.visible);
        if (!damageText) {
            damageText = this.add.text(x, y, text, { fontSize: '16px', color: '#ff0000' });
            this.textPool.push(damageText);
        } else {
            damageText.setPosition(x, y).setText(text).setVisible(true).setAlpha(1);
        }
        return damageText;
    }

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
        this.cameras.main.setZoom(zoom );

        const canvas = this.game.canvas;
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';
    }
}