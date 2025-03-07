import Phaser from 'phaser';
import { fetchGotchiSVGs, Aavegotchi } from './FetchGotchis';

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;
const MAX_POSITION_BUFFER_LENGTH = 10;
const INTERPOLATION_DELAY_MS = 100; // Reduced for faster response; adjust as needed

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
    // hp: number;
    // maxHp: number;
    // ap: number;
    // maxAp: number;
    // gameXp: number;
    // gameLevel: number;
    // gameXpOnCurrentLevel: number;
    // gameXpTotalForNextLevel: number;
}

export interface TilemapProperty {
    name: string;
    type: string;
    value: any; // or specific type like boolean | string | number if known
}

export interface Enemy {
    bodySprite: Phaser.GameObjects.Sprite;
    shadowSprite?: Phaser.GameObjects.Ellipse;
    hpBar?: Phaser.GameObjects.Rectangle;
    maxHp: number;
    type: string;
    positionBuffer: PositionUpdate[];
    hp: number;
    direction?: number;
}

let player, zones, ws;
const tileSize = 32;
const zoneSize = 256; // 8192px
// const scale = 1 / 32; //

export class GameScene extends Phaser.Scene {
    private players: { [id: string]: Player } = {};
    private enemies: { [id: string]: Enemy } = {};
    private ws!: WebSocket;
    private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; SPACE: Phaser.Input.Keyboard.Key };
    private tickTimer = 0;
    private circlePool: Phaser.GameObjects.Graphics[] = [];
    private textPool: Phaser.GameObjects.Text[] = [];
    private isConnected = false;
    private keyState = { W: false, A: false, S: false, D: false, SPACE: false };
    private localPlayerID!: string;
    private followedPlayerID!: string;

    private testEnemySprites: Phaser.GameObjects.Sprite[] = [];

    public getPlayers() { return this.players; }
    public getLocalPlayerID() { return this.localPlayerID; }

    constructor() {
        super('GameScene');
    }

    preload() {
        this.load.image('tileset', 'assets/tilemap/tileset.png');
        this.load.tilemapTiledJSON('map', 'assets/tilemap/mmorpg.json');
        this.load.image('enemy-easy', '/assets/enemy-easy.png');
        this.load.image('enemy-medium', '/assets/enemy-medium.png');
        this.load.image('enemy-hard', '/assets/enemy-hard.png');
        this.load.image('gotchi_placeholder', '/assets/gotchi_placeholder.png');
        this.load.font('Pixelar', 'assets/fonts/pixelar/PixelarRegular.ttf');
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

        // Draw 3x3 grid of zones with alternating colors
        zones = this.add.group();
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 3; x++) {
                const color = (x + y) % 2 === 0 ? 0xff0000 : 0x00ff00; // Red/Green
                const rect = this.add.rectangle(
                    (x * zoneSize + zoneSize / 2) * tileSize,
                    (y * zoneSize + zoneSize / 2) * tileSize,
                    zoneSize*tileSize,
                    zoneSize*tileSize,
                    color
                );
                rect.setOrigin(0.5);
                zones.add(rect);
            }
        }

        this.cameras.main.setBounds(0, 0, zoneSize*3*tileSize, zoneSize*3*tileSize);


        // this.createTilemap();

        this.ws = new WebSocket("ws://localhost:8080/ws");
        this.ws.onopen = () => {
            console.log('Connected to server');
            this.isConnected = true;

            this.ws.onmessage = (event) => {
                const messages = JSON.parse(event.data);
                messages.forEach((msg:any) => {
                    switch (msg.type){
                        case 'playerUpdates':
                            msg.data.forEach((update:any) => {
                                this.addOrUpdatePlayer(update);
                            });
                        break;

                        case 'enemyUpdates':
                            msg.data.forEach((update:any) => {
                                this.addOrUpdateEnemy(update);
                            })
                        break;

                        default: break;
                    }
                    // Uncomment for enemies (disabled due to sprite limit)
                    /*
                    else if (msg.type === 'enemyUpdates') {
                        msg.data.forEach(update => {
                            if (!enemies[update.enemyId]) {
                                enemies[update.enemyId] = this.add.rectangle(
                                    update.x * tileSize * scale,
                                    update.y * tileSize * scale,
                                    10 * tileSize * scale,
                                    10 * tileSize * scale,
                                    0xff00ff
                                );
                                enemies[update.enemyId].setOrigin(0.5);
                            } else {
                                enemies[update.enemyId].x = update.x * tileSize * scale;
                                enemies[update.enemyId].y = update.y * tileSize * scale;
                            }
                        });
                    }
                    */
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


        // create some test enemies
        // var layer = this.add.spriteGPULayer('enemy-easy', 1000);
        for (let i = 0; i < 20000; i++){
            // var template = {
            //     x: Math.random() * zoneSize * tileSize,
            //     y: Math.random() * zoneSize * tileSize,
            // }
            // var sprite = this.add.sprite(
            //     Math.random() * zoneSize * tileSize * 12,
            //     Math.random() * zoneSize * tileSize * 12,
            //     'enemy-easy'
            // )
            // .setScale(10);

            // this.testEnemySprites.push(sprite);
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
        const {playerId, x, y} = datum;
        // console.log(id, x, y);

        // NEW PLAYER
        if (!this.players[playerId]){

            this.localPlayerID = playerId;

            const newPlayerSprite = this.add.sprite(x, y, 'gotchi_placeholder')
            .setDepth(1000)
            .setScale(10)
            // .setName(`player-${id}`);

            this.cameras.main.startFollow(newPlayerSprite);

            this.players[playerId] = {
                sprite: newPlayerSprite,
                gotchiId: 0,
                isAssignedSVG: false,
                positionBuffer: [],
                // hp: data.hp || 0,
                // maxHp: data.maxHp || 0,
                // ap: data.ap || 0,
                // maxAp: data.maxAp || 0,
                // gameXp: data.gameXp || 0,
                // gameLevel: data.gameLevel || 1,
                // gameXpOnCurrentLevel: data.gameXpOnCurrentLevel || 0,
                // gameXpTotalForNextLevel: data.gameXpTotalForNextLevel || 0
            };
            console.log(`Added placeholder player ${playerId}`);
        }

        // MOVE PLAYER
        if (this.players[playerId]){
            this.players[playerId].sprite.x = x;
            this.players[playerId].sprite.y = y;
            // console.log(x, y);
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
        const {enemyId, x, y, zoneId, timestamp, type, hp } = data;

        // NEW ENEMY
        if (!this.enemies[enemyId] && hp > 0) {
            console.log("add new enemy", data);
            const texture = `enemy-${type}`;
            console.log(texture);
            const bodySprite = this.add.sprite(x, y, texture)
            .setDepth(3000)
            .setScale(1)
            .setScale(10);
            // const shadow = this.add.ellipse(0, bodySprite.height / 2, 24, 16, 0x000000, 0.5).setDepth(999).setAlpha(0.5);
            // const hpBar = this.add.rectangle(0, -30, 32, 5, 0xff0000).setOrigin(0.5, 0);
            // const container = this.add.container(x, y, [shadow, sprite, hpBar]).setDepth(1000);

            this.enemies[enemyId] = {
                bodySprite: bodySprite,
                shadowSprite: undefined,
                hpBar: undefined,
                maxHp: hp,
                type: type,
                positionBuffer: [],
                hp: hp,
                direction: data.direction
            };
            console.log(`Added enemy ${enemyId}`);
        } 

        return;
        
        // GENERAL UPDATE
        if (this.enemies[enemyId] && hp > 0) {
            const enemy = this.enemies[enemyId];
            enemy.positionBuffer.push({
                x: x,
                y: y,
                timestamp: data.timestamp
            });

            while (enemy.positionBuffer.length > MAX_POSITION_BUFFER_LENGTH) {
                enemy.positionBuffer.shift();
            }

            enemy.hp = hp;
            if (data.direction !== undefined) {
                enemy.direction = data.direction;
                // Add directional sprite logic here if enemy textures support it
            }
            // this.updateEnemyHP(enemyId);
        }  
        
        // DEAD
        if (hp <= 0) {
            this.removeEnemy(enemyId);
        }
    }

    handleDamageUpdate(data: any) {
        const { id, type, damage } = data;
        let x: number, y: number, textColor: string, offsetY: number;

        if (type === "enemy" && this.enemies[id]) {
            x = this.enemies[id].bodySprite.x;
            y = this.enemies[id].bodySprite.y;
            textColor = '#ffffff';
            offsetY = -32;
        } else if (type === "player" && this.players[id]) {
            x = this.players[id].sprite.x;
            y = this.players[id].sprite.y;
            textColor = '#ff0000';
            offsetY = -64;
        } else {
            return;
        }

        const damageText = this.getPooledText(x, y + offsetY, damage.toString());
        damageText.setStyle({
            fontFamily: 'Pixelar',
            fontSize: '24px',
            color: textColor,
            stroke: '#000000',
            strokeThickness: 1,
        });
        damageText.setOrigin(0.5, 0.5).setDepth(3000);

        this.tweens.add({
            targets: damageText,
            y: damageText.y - 20,
            alpha: 0,
            duration: 1000,
            ease: 'Quad.easeIn',
            onComplete: () => damageText.setVisible(false),
        });
    }

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

    removeEnemy(id: string) {
        if (this.enemies[id]) {
            const x = this.enemies[id].bodySprite.x;
            const y = this.enemies[id].bodySprite.y;
            this.createRectExplosion(x, y);
            this.enemies[id].bodySprite.destroy();
            this.enemies[id].shadowSprite?.destroy();
            this.enemies[id].hpBar?.destroy();
            delete this.enemies[id];
        }
    }

    updateEnemyHP(id: string) {
        if (this.enemies[id]) {
            const enemy = this.enemies[id];
            if (enemy.hp <= 0) {
                this.removeEnemy(id);
            } else {
                // enemy.hpBar?.width = 32 * (enemy.hp / enemy.maxHp);
            }
        }
    }

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

    createTilemap() {
        const map = this.make.tilemap({ key: 'map' });
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
    
            const layer = map.createLayer(layerName, tileset, 0, 0);
            if (layer) {
                layer.setDepth(index);
                layer.setVisible(true);
            }
        });
    
        const centerX = map.widthInPixels / 2;
        const centerY = map.heightInPixels / 2;
        // const initialCameraFollow = this.add.rectangle(centerX, centerY, 20, 20, 0xff0000).setOrigin(0.5, 0.5).setAlpha(0);
        // this.cameras.main.startFollow(initialCameraFollow);
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
                    playerId: this.localPlayerID, keys: this.keyState } });
                try {
                    this.ws.send(message);
                    // console.log('Sent input for local player:', this.localPlayerID, this.keyState); // Add this log
                } catch (e) {
                    console.error('Failed to send input:', e);
                }
            }

            // take this opportunity to move all our sprites
            var enemyLength = this.testEnemySprites.length;
            for (let i = 0; i < enemyLength; i++){
                this.testEnemySprites[i].x += (Math.random()-0.5) * 10; 
                this.testEnemySprites[i].y += (Math.random()-0.5) * 10;
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
        for (const id in this.enemies) {
            const enemy = this.enemies[id];
            if (enemy.positionBuffer.length === 0) continue;

            var latest = enemy.positionBuffer[enemy.positionBuffer.length-1];
            enemy.bodySprite.setPosition(latest.x, latest.y);
            continue;

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
            } else if (buffer.length > 0) {
                const last = buffer[buffer.length - 1];
                enemy.bodySprite.setPosition(last.x, last.y);
            }
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
        this.cameras.main.setZoom(zoom / 12);

        const canvas = this.game.canvas;
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';
    }
}