import Phaser from 'phaser';
import { fetchGotchiSVGs, Aavegotchi } from './FetchGotchis'; // Adjusted import to include Aavegotchi type

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;
const MAX_POSITION_BUFFER_LENGTH = 10;
const INTERPOLATION_DELAY_MS = 250;

export interface Player {
    sprite: Phaser.GameObjects.Sprite;
    gotchiId: number;
    isAssignedSVG: boolean;
    positionBuffer: {
        x: number,
        y: number,
        timestamp: number,
    }[],
    hp: number;
    maxHp: number;
    ap: number;
    maxAp: number;
}

export class GameScene extends Phaser.Scene {
    private players: { [id: string]: Player } = {};
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private ws!: WebSocket;
    private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; SPACE: Phaser.Input.Keyboard.Key };
    private enemies: { [id: string]: { sprite: Phaser.GameObjects.Sprite; hpBar: Phaser.GameObjects.Rectangle; maxHP: number } } = {};
    private stats = { hp: 0, maxHP: 0, atk: 0, ap: 0, maxAP: 0, rgn: 0 };
    private moveTimer = 0;
    private circlePool: Phaser.GameObjects.Graphics[] = [];
    private textPool: Phaser.GameObjects.Text[] = [];
    private isConnected = false;
    private keyState = { W: false, A: false, S: false, D: false, SPACE: false };
    private localPlayerID!: string;
    private followedPlayerID!: string;

    public getPlayers() { return this.players; }
    public getLocalPlayerID() { return this.localPlayerID; }

    constructor() {
        super('GameScene');
    }

    preload() {
        this.load.image('tileset-extruded', 'assets/tiles/tileset-extruded.png');
        this.load.tilemapTiledJSON('map', 'assets/exports/mmorpg.json');
        this.load.image('enemy-easy', '/assets/enemy-easy.png');
        this.load.image('enemy-medium', '/assets/enemy-medium.png');
        this.load.image('enemy-hard', '/assets/enemy-hard.png');
        this.load.image('gotchi_placeholder', '/assets/gotchi_placeholder.png');
    }

    create() {
        this.registry.set('game', this);

        if (this.input.keyboard === null) return;

        this.keys = {
            W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        };

        this.createTilemap();

        this.cursors = this.input.keyboard.createCursorKeys();

        for (let i = 0; i < 10; i++) {
            const circle = this.add.graphics();
            circle.fillStyle(0xff0000, 0);
            circle.fillCircle(0, 0, 128);
            circle.setVisible(false);
            this.circlePool.push(circle);

            const text = this.add.text(0, 0, '', { fontSize: '16px', color: '#ff0000' }).setVisible(false);
            this.textPool.push(text);
        }

        // Always connect WebSocket to show the world and existing players, even before spawning
        this.ws = new WebSocket('ws://localhost:8080/ws');
        this.ws.onopen = () => {
            console.log('Connected to server');
            this.isConnected = true;

            // listen for updates
            this.ws.onmessage = (e) => {
                let msg;
                try {
                    msg = JSON.parse(e.data);
                } catch (err) {
                    console.error('Failed to parse message:', err, 'Data:', e.data);
                    return;
                }
                let data = msg.data;
                if (typeof data === 'string') data = JSON.parse(data);
                switch (msg.type) {
                    case "welcome":
                        this.localPlayerID = msg.data.id;
                        console.log("Local Player ID: ", this.localPlayerID);
                        this.followedPlayerID = "";
                        break;
                    case "playerUpdates":
                        if (data){
                            if (Array.isArray(data)) {
                                data.forEach(update => {
                                    this.addOrUpdatePlayer(update);
                                });
                            } else {
                                console.error('PlayerUpdates updates is not an array:', data);
                            }
                        }
                        break;
                    case "playerDisconnected":
                        this.removePlayer(data.id);
                        break;
                    case "enemyUpdates":
                        this.handleEnemyUpdates(data);
                        break;
                    case "combat":
                        this.handleCombat(data);
                        break;
                }
            };
            this.ws.onerror = (e) => console.error('WebSocket error:', e);
            this.ws.onclose = () => {
                console.log('WebSocket closed in world-only mode');
                this.isConnected = false;
            };
        };

        this.resizeGame();
        window.addEventListener('resize', () => this.resizeGame());

        // Start the UI scene
        this.scene.launch('UIScene');

        // Listen for selectGotchi event
        this.registry.get('game').events.on('selectGotchi', this.onGotchiSelected, this);
    }

createTilemap() {
    const map = this.make.tilemap({ key: 'map' });
    if (!map) {
        console.error('Tilemap failed to load');
        return;
    }
    console.log('Tilemap loaded successfully');

    const tileset = map.addTilesetImage('tileset', 'tileset-extruded', 32, 32, 5, 10);
    if (!tileset) {
        console.error('Tileset not found or invalid in map');
        return;
    }
    console.log('Tileset added successfully, tile width:', tileset.tileWidth, 'tile height:', tileset.tileHeight);

    console.log('Available layers:', map.layers.map(l => l.name));

    // Loop through all layers dynamically
    map.layers.forEach((layerData, index) => {
        const layerName = layerData.name;

        // Safely access properties and check for 'isHidden' property
        const isHidden = (layerData.properties as Array<{ name: string, value: any }>)?.find((prop) => prop.name === 'isHidden')?.value === true;
        if (isHidden) {
            console.log(`Skipping hidden layer: ${layerName}`);
            return;
        }

        // Create the layer if it's not hidden
        const layer = map.createLayer(layerName, tileset, 0, 0);
        if (layer) {
            // Dynamically set depth based on layer order (top layers should have higher depth)
            layer.setDepth(map.layers.length - index); // Layers at the top get higher depth values
            layer.setVisible(true);
            console.log(`Layer "${layerName}" created successfully at depth ${map.layers.length - index}`);
        } else {
            console.error(`Layer "${layerName}" creation failed`);
        }
    });

    // Set up camera bounds
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Dynamically center camera follow based on tilemap size
    const centerX = map.widthInPixels / 2;
    const centerY = map.heightInPixels / 2;

    const initialCameraFollow = this.add.rectangle(centerX, centerY, 20, 20, 0xff0000)
        .setOrigin(0.5, 0.5)
        .setAlpha(0); // Invisible

    this.cameras.main.startFollow(initialCameraFollow);

    console.log(`Camera set up with bounds: ${map.widthInPixels}x${map.heightInPixels}, following (${centerX}, ${centerY})`);
}

    

    onGotchiSelected(gotchi: Aavegotchi) {
        console.log('Gotchi Selected in GameScene:', gotchi);
        // Update registry with the selected Gotchi
        this.registry.set('selectedGotchi', gotchi);
        // Set initial state to spawn player
        this.registry.set('initialState', 'spawnPlayer');
        // Send join message to server to spawn player
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("Send: join - ", { gotchiId: gotchi.id });
            this.ws.send(JSON.stringify({ type: 'join', data: { gotchiId: gotchi.id } }));
        }
    }

    shutdown() {
        // Remove the listener when the scene is destroyed to prevent memory leaks
        this.registry.get('game').events.off('selectGotchi', this.onGotchiSelected, this);
        console.log('GameScene shutting down, removed selectGotchi listener');
    }

    addOrUpdatePlayer(data: any) {
        // NEW PLAYER
        if (!this.players[data.id]) {
            var newPlayerSprite = this.add.sprite(data.x, data.y, 'gotchi_placeholder')
                .setDepth(1000)
                .setScale(1) // Ensure 64x64 size
                .setName(data.id);

            this.players[data.id] = {
                sprite: newPlayerSprite,
                gotchiId: data.gotchiId,
                isAssignedSVG: false,
                positionBuffer: [],
                hp: data.hp,
                maxHp: data.maxHp,
                ap: data.ap,
                maxAp: data.maxAp,
            } 

            console.log(`Added placeholder player ${data.id} at (${data.x}, ${data.y})`);
        } 

        // MOVE EXISTING PLAYER
        else {
            // this.players[data.id].sprite.setPosition(data.x, data.y);
            this.players[data.id].positionBuffer.push({
                x: data.x,
                y: data.y,
                timestamp: data.timestamp
            });

            while (this.players[data.id].positionBuffer.length > MAX_POSITION_BUFFER_LENGTH) {
                this.players[data.id].positionBuffer.shift();
            }
        }

        // SVG YET TO BE ASSIGNED PLAYER
        if (!this.players[data.id].isAssignedSVG && data.gotchiId !== 0) {
            this.players[data.id].gotchiId = data.gotchiId;
            this.players[data.id].isAssignedSVG = true;
            this.loadGotchiSVG(data.gotchiId, data.id, data.x, data.y);
        }

        // CHANGE FACING DIRECTION OF PLAYER
        if (this.players[data.id].isAssignedSVG) {
            switch (data.direction) {
                case 0: // front
                    this.players[data.id].sprite.setTexture(`gotchi-${data.gotchiId}-front`)
                    break;
                case 1: // left
                    this.players[data.id].sprite.setTexture(`gotchi-${data.gotchiId}-left`)
                    break;
                case 2: // right
                    this.players[data.id].sprite.setTexture(`gotchi-${data.gotchiId}-right`)
                    break;
                case 3: // back
                    this.players[data.id].sprite.setTexture(`gotchi-${data.gotchiId}-back`)
                    break;
                default:
                    break;

            }
        }

        // LOCAL PLAYER ONLY (CAMERA SETUP)
        if (data.id === this.localPlayerID) {
            if (this.followedPlayerID !== data.id) {
                this.followedPlayerID = data.id;
                console.log("follow player at position: ", this.players[data.id].sprite.x, this.players[data.id].sprite.y);
                this.cameras.main.startFollow(this.players[data.id].sprite, true);
            }
        }
    }

    async loadGotchiSVG(gotchiId: string, playerID: string, x: number, y: number) {
        console.log("loadGotchiSVG: ", gotchiId);
        try {
            const svgs = await fetchGotchiSVGs(gotchiId);
    
            // Define the four views
            const views: (keyof typeof svgs)[] = ["front", "left", "right", "back"];
    
            // Load all views
            views.forEach(view => {
                const svgDataUrl = `data:image/svg+xml;base64,${btoa(svgs[view])}`;
                this.load.image(`gotchi-${gotchiId}-${view}`, svgDataUrl);
            });
    
            // Handle completion of image loading
            this.load.once('complete', () => {
                if (this.players[playerID]) {
                    this.players[playerID].sprite.destroy(); // Remove placeholder
                    
                    // Create the sprite using the "front" view by default
                    this.players[playerID].sprite = this.add.sprite(x, y, `gotchi-${gotchiId}-front`)
                        .setDepth(1000)
                        .setScale(0.5) // Ensure 64x64 size
                        .setName(playerID);
                    
                    // Ensure we clear the followed player ID (as the sprite was destroyed)
                    this.followedPlayerID = "";
                    console.log(`Updated player ${playerID} with Gotchi SVG at (${x}, ${y})`);
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
            console.log(`Removed player ${id}`);
        }
    }

    handleEnemyUpdates(data: any) {
        const view = this.cameras.main.worldView;
        for (const id in data) {
            const e = data[id];
            if (this.isInView(e.x, e.y, view)) {
                if (!this.enemies[id]) {
                    this.addEnemy(id, { type: id.split('-')[0], x: e.x, y: e.y, hp: e.hp, maxHP: e.hp });
                } else {
                    this.enemies[id].sprite.setPosition(e.x, e.y);
                    this.updateEnemyHP(id, e.hp);
                }
            } else if (this.enemies[id]) {
                this.removeEnemy(id);
            }
        }
    }

    addEnemy(id: string, e: { type: string; x: number; y: number; hp: number; maxHP: number }) {
        const texture = `enemy-${e.type}`;
        const sprite = this.add.sprite(e.x, e.y, texture);
        const hpBar = this.add.rectangle(e.x, e.y - 40, 32, 5, 0xff0000).setOrigin(0.5, 0);
        this.enemies[id] = { sprite, hpBar, maxHP: e.maxHP };
        this.updateEnemyHP(id, e.hp);
        console.log('Added enemy', id, 'at x:', e.x, 'y:', e.y);
    }

    removeEnemy(id: string) {
        if (this.enemies[id]) {
            this.enemies[id].sprite.destroy();
            this.enemies[id].hpBar.destroy();
            delete this.enemies[id];
            console.log('Removed enemy', id);
        }
    }

    isInView(x: number, y: number, view: Phaser.Geom.Rectangle): boolean {
        const buffer = 256;
        return x >= view.left - buffer && x <= view.right + buffer &&
            y >= view.top - buffer && y <= view.bottom + buffer;
    }

    

    updateEnemyHP(id: string, hp: number) {
        if (this.enemies[id]) {
            const enemy = this.enemies[id];
            if (hp <= 0) {
                this.removeEnemy(id);
            } else {
                enemy.hpBar.width = 32 * (hp / enemy.maxHP);
                enemy.hpBar.setPosition(enemy.sprite.x, enemy.sprite.y - 40);
            }
        }
    }

    handleCombat(data: any) {
        const enemy = this.enemies[data.targetID];
        if (!enemy) return;
        const radius = data.special ? 192 : 128;
        const color = data.special ? 0xffff00 : 0xff0000;
        const circle = this.getPooledCircle(enemy.sprite.x, enemy.sprite.y, radius, color);
        const damageText = this.getPooledText(enemy.sprite.x, enemy.sprite.y - 20, `-${data.damage}`);
        this.tweens.add({
            targets: circle,
            alpha: 0,
            duration: 200,
            onComplete: () => circle.setVisible(false)
        });
        this.tweens.add({
            targets: damageText,
            y: enemy.sprite.y - 40,
            alpha: 0,
            duration: 1000,
            onComplete: () => damageText.setVisible(false)
        });
        this.updateEnemyHP(data.targetID, data.newHP);
        if (data.playerHP || data.playerAP) {
            this.stats.hp = data.playerHP || this.stats.hp;
            this.stats.ap = data.playerAP || this.stats.ap;
            // this.updateBars();
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

    update(time: number, delta: number) {
        this.moveTimer -= delta / 1000;
        if (this.moveTimer <= 0 && this.isConnected && this.localPlayerID) {
            this.keyState = {
                W: this.keys.W.isDown,
                A: this.keys.A.isDown,
                S: this.keys.S.isDown,
                D: this.keys.D.isDown,
                SPACE: this.keys.SPACE.isDown,
            };
            const message = JSON.stringify({ type: 'input', data: { id: this.localPlayerID, keys: this.keyState } });
            try {
                this.ws.send(message);
                // console.log('Sent input for local player:', this.localPlayerID, this.keyState);
            } catch (e) {
                console.error('Failed to send input:', e);
            }
            this.moveTimer = 0.1;
        }

        // interpolate playres
        this.interpolatePlayers();
    }

    interpolatePlayers() {
        for (const id in this.players) {
            if (this.players.hasOwnProperty(id)) {
                const player = this.players[id];

                if (player.positionBuffer.length <= 0) continue;

                const lastBufferIndex = player.positionBuffer.length - 1;
                if (player.positionBuffer.length < 3) {
                    player.sprite.x = player.positionBuffer[lastBufferIndex].x;
                    player.sprite.y = player.positionBuffer[lastBufferIndex].y;
                }
                else {
                    var targetTime = Date.now() - INTERPOLATION_DELAY_MS;
                    var positionBuffer = player.positionBuffer;

                    let older, newer;
                    for (let i = 0; i < positionBuffer.length - 1; i++) {
                        if (positionBuffer[i].timestamp <= targetTime && positionBuffer[i + 1].timestamp >= targetTime) {
                            older = positionBuffer[i];
                            newer = positionBuffer[i + 1];
                            break;
                        }
                    }
                
                    if (older && newer) {
                        // Normal interpolation
                        let alpha = (targetTime - older.timestamp) / (newer.timestamp - older.timestamp);
                        // alpha = Math.min(alpha, 1);
                        // alpha = Math.max(alpha, 0);
                        player.sprite.setPosition(
                            older.x + (newer.x - older.x) * alpha,
                            older.y + (newer.y - older.y) * alpha
                        );
                    }
                }
            }
        }
    }

    resizeGame() {
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

        const zoomX = newWidth / GAME_WIDTH;

        const zoomY = newHeight / GAME_HEIGHT;
        const zoom = Math.min(zoomX, zoomY);

        this.cameras.main.setZoom(zoom*1.5);

        // Center the Phaser canvas manually
        const canvas = this.game.canvas;
        canvas.style.position = 'absolute';
        canvas.style.left = '50%';
        canvas.style.top = '50%';
        canvas.style.transform = 'translate(-50%, -50%)';

        // console.log('Resized game to width:', newWidth, 'height:', newHeight);
    }
}