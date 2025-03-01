import Phaser from 'phaser';
import { fetchGotchiSVGs } from './FetchGotchis'; // Adjusted import to match existing usage

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;

export class GameScene extends Phaser.Scene {
    private players: { [id: string]: Phaser.GameObjects.Sprite } = {};
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private ws!: WebSocket;
    private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; SPACE: Phaser.Input.Keyboard.Key };
    private enemies: { [id: string]: { sprite: Phaser.GameObjects.Sprite; hpBar: Phaser.GameObjects.Rectangle; maxHP: number } } = {};
    private hpBar!: Phaser.GameObjects.Rectangle;
    private apBar!: Phaser.GameObjects.Rectangle;
    private hpText!: Phaser.GameObjects.Text;
    private apText!: Phaser.GameObjects.Text;
    private stats = { hp: 0, maxHP: 0, atk: 0, ap: 0, maxAP: 0, rgn: 0 };
    private moveTimer = 0;
    private circlePool: Phaser.GameObjects.Graphics[] = [];
    private textPool: Phaser.GameObjects.Text[] = [];
    private isConnected = false;
    private keyState = { W: false, A: false, S: false, D: false, SPACE: false };
    private localPlayerID!: string;
    private pendingPlayers: { id: string, x: number, y: number, gotchiID: string }[] = [];

    // All game UI elements (not including connect/select UI) are added to this, which controls scroll(0), depth, and scaling
    private uiContainer!: Phaser.GameObjects.Container;

    preload() {
        this.load.tilemapTiledJSON('map', '/assets/exports/mmorpg.json');
        this.load.image('tileset', '/assets/tiles/tileset.png');
        this.load.image('enemy-easy', '/assets/enemy-easy.png');
        this.load.image('enemy-medium', '/assets/enemy-medium.png');
        this.load.image('enemy-hard', '/assets/enemy-hard.png');
        this.load.image('gotchi_placeholder', '/assets/gotchi_placeholder.png');

        const gotchi = this.registry.get('selectedGotchi');
        if (gotchi) {
            const svgDataUrl = `data:image/svg+xml;base64,${btoa(gotchi.svgs.front)}`;
            this.load.image(`gotchi-${gotchi.id}-front`, svgDataUrl);
            console.log('Preloaded local Gotchi SVG as image for ID:', gotchi.id);
        } else {
            console.log('No selected Gotchi found in registry—initializing world only');
            // World still loads, no error—handles initial state
        }
    }

    create() {
        this.registry.set('game', this);

        if (this.input.keyboard === null) return;

        this.uiContainer = this.add.container(0, 0);
        this.uiContainer.setScrollFactor(0);
        this.uiContainer.setDepth(2000);

        this.keys = {
            W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        };

        const map = this.make.tilemap({ key: 'map' });
        if (!map) {
            console.error('Tilemap failed to load');
            return;
        }
        console.log('Tilemap loaded successfully');

        const tileset = map.addTilesetImage('tileset', 'tileset', 32, 32);
        if (!tileset) {
            console.error('Tileset not found or invalid in map');
            return;
        }
        console.log('Tileset added successfully, tile width:', tileset.tileWidth, 'tile height:', tileset.tileHeight);

        console.log('Available layers:', map.layers.map(l => l.name));
        const layer = map.createLayer('ground', tileset, 0, 0);
        if (layer) {
            layer.setScale(1);
            layer.setDepth(0);
            layer.setVisible(true); // Ensure layer is visible on first load
            console.log('Layer "ground" created successfully at depth 0');
        } else {
            console.error('Layer "ground" creation failed');
            return;
        }

        this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        // Preserve existing camera setup—no zoom or position changes as per your request
        console.log('Camera set up with bounds:', map.widthInPixels, map.heightInPixels);

        this.cursors = this.input.keyboard.createCursorKeys();

        this.hpBar = this.add.rectangle(20, GAME_HEIGHT - 20 - (32 + 10), 450, 32, 0x00ff00)
            .setOrigin(0, 1);
        this.apBar = this.add.rectangle(20, GAME_HEIGHT - 20, 450, 32, 0x0000ff)
            .setOrigin(0, 1);
        this.hpText = this.add.text(20, GAME_HEIGHT - 20 - (32 + 10), 'HP: 0', { fontSize: '32px', color: '#000000' })
            .setOrigin(0, 1);
        this.apText = this.add.text(20, GAME_HEIGHT - 20, 'AP: 0', { fontSize: '32px', color: '#ffffff' })
            .setOrigin(0, 1);

        this.uiContainer.add([this.hpBar, this.apBar, this.hpText, this.apText]);

        for (let i = 0; i < 10; i++) {
            const circle = this.add.graphics();
            circle.fillStyle(0xff0000, 0);
            circle.fillCircle(0, 0, 128);
            circle.setVisible(false);
            this.circlePool.push(circle);

            const text = this.add.text(0, 0, '', { fontSize: '16px', color: '#ff0000' }).setVisible(false);
            this.textPool.push(text);
        }

        // Check initial state and connect WebSocket to show world on first load
        const initialState = this.registry.get('initialState');
        if (initialState === 'worldOnly') {
            // Show the world—connect WebSocket to receive existing player updates
            this.ws = new WebSocket('ws://localhost:8080/ws');
            this.ws.onopen = () => {
                console.log('Connected to server in world-only mode');
                this.isConnected = true;
                // Don’t send input—only listen for updates
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
                        case "playerUpdates":
                            const updates = data.updates || []; // Default to empty array if updates is null/undefined
                            if (Array.isArray(updates)) {
                                this.handlePlayerUpdates(updates); // Handle existing player updates
                            } else {
                                console.error('PlayerUpdates updates is not an array:', updates);
                            }
                            break;
                        case "newPlayer":
                            this.addPlayer(data);
                            break;
                        case "playerDisconnected":
                            this.removePlayer(data.id);
                            break;
                    }
                };
                this.ws.onerror = (e) => console.error('WebSocket error:', e);
                this.ws.onclose = () => {
                    console.log('WebSocket closed in world-only mode');
                    this.isConnected = false;
                };
            };
        } else if (initialState === 'spawnPlayer') {
            // Spawn player after selection
            const gotchi = this.registry.get('selectedGotchi');
            if (gotchi) {
                this.ws = new WebSocket('ws://localhost:8080/ws');
                this.ws.onopen = () => {
                    console.log('Connected to server for player spawn');
                    this.isConnected = true;
                    this.ws.send(JSON.stringify({ type: 'join', data: { gotchiID: gotchi.id } }));
                };
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
                        case "init":
                            this.handleInit(data);
                            break;
                        case "newPlayer":
                            this.addPlayer(data);
                            break;
                        case "playerDisconnected":
                            this.removePlayer(data.id);
                            break;
                        case "stats":
                            this.handleStats(data);
                            break;
                        case "playerUpdates":
                            const updates = data.updates || []; // Default to empty array if updates is null/undefined
                            if (Array.isArray(updates)) {
                                this.handlePlayerUpdates(updates);
                            } else {
                                console.error('PlayerUpdates updates is not an array:', updates);
                            }
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
                    console.log('WebSocket closed after player spawn');
                    this.isConnected = false;
                };
            }
        }

        this.resizeGame();
        window.addEventListener('resize', () => this.resizeGame());

        // start the UI scene
        this.scene.launch('UIScene');

   
        // Listen for selectGotchi event
        this.registry.get('game').events.on('selectGotchi', this.onGotchiSelected, this);
    }

    onGotchiSelected(gotchiData: any) {
        console.log('Gotchi Selected:', gotchiData);
        // Handle the selected Gotchi (e.g., update display)
    }

    shutdown() {
        // Ensure we remove the listener when the scene is destroyed
        const uiScene = this.scene.get('UIScene') as Phaser.Scene;
        uiScene.events.off('selectGotchi', this.onGotchiSelected, this);
    }

    async handleInit(data: any) {
        const localPlayer = data.player;
        this.localPlayerID = localPlayer.id;
        this.players[localPlayer.id] = this.add.sprite(localPlayer.x, localPlayer.y, `gotchi-${this.registry.get('selectedGotchi').id}-front`);
        this.players[localPlayer.id].setDepth(1);
        this.players[localPlayer.id].name = localPlayer.id;
        this.players[localPlayer.id].setScale(0.5); // Ensure 64x64 size
        this.cameras.main.startFollow(this.players[localPlayer.id], true);
        console.log(`Initialized local player ${localPlayer.id} at (${localPlayer.x}, ${localPlayer.y})`);

        if (data.existingPlayers) {
            data.existingPlayers.forEach((p: any) => {
                this.pendingPlayers.push({ id: p.id, x: p.x, y: p.y, gotchiID: p.gotchiID });
            });
        }
        this.loadPendingPlayers();

        const view = this.cameras.main.worldView;
        for (const id in data.enemies) {
            const e = data.enemies[id];
            if (this.isInView(e.x, e.y, view)) {
                this.addEnemy(id, e);
            }
        }
        this.stats = data.player;
        this.updateBars();
    }

    addPlayer(data: any) {
        if (!this.players[data.id]) {
            this.pendingPlayers.push({ id: data.id, x: data.x, y: data.y, gotchiID: data.gotchiID });
            this.loadPendingPlayers();
        }
    }

    async loadPendingPlayers() {
        const playersToLoad = [...this.pendingPlayers];
        this.pendingPlayers = [];
        for (const p of playersToLoad) {
            const svgs = await fetchGotchiSVGs(p.gotchiID);
            const svgDataUrl = `data:image/svg+xml;base64,${btoa(svgs.front)}`; // Use fetchGotchiSVGs directly, assuming it returns cleaned SVG
            this.load.image(`gotchi-${p.id}-front`, svgDataUrl);
        }
        this.load.once('complete', () => {
            playersToLoad.forEach(p => {
                if (!this.players[p.id]) {
                    this.players[p.id] = this.add.sprite(p.x, p.y, `gotchi-${p.id}-front`);
                    this.players[p.id].setDepth(1);
                    this.players[p.id].name = p.id;
                    this.players[p.id].setScale(0.5); // Ensure 64x64 size
                    console.log(`Initialized player ${p.id} at (${p.x}, ${p.y}) with fetched SVG`);
                }
            });
        });
        this.load.start();
    }

    removePlayer(id: string) {
        if (this.players[id]) {
            this.players[id].destroy();
            delete this.players[id];
            console.log(`Removed player ${id}`);
        }
    }

    handleStats(data: any) {
        this.stats = data;
        this.updateBars();
        console.log(`Stats updated for ${data.id}: HP ${data.hp}/${data.maxHP}, AP ${data.ap}/${data.maxAP}`);
    }

    handlePlayerUpdates(data: any[]) {
        data.forEach(update => {
            const sprite = this.players[update.id];
            if (sprite) {
                sprite.setPosition(update.x, update.y);
                // console.log(`Updated player ${update.id} to (${update.x}, ${update.y})`);
            } else {
                console.log(`No sprite for player ${update.id} yet—awaiting load`);
            }
        });
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

    updateBars() {
        this.hpBar.width = 450 * (this.stats.hp / this.stats.maxHP);
        this.apBar.width = 450 * (this.stats.ap / this.stats.maxAP);
        this.hpText.setText(`HP: ${this.stats.hp}/${this.stats.maxHP}`);
        this.apText.setText(`AP: ${Math.floor(this.stats.ap)}/${this.stats.maxAP}`);
        console.log('Updated HP/AP bars:', this.stats.hp, '/', this.stats.maxHP, 'AP:', this.stats.ap, '/', this.stats.maxAP);
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
            this.updateBars();
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
        if (this.moveTimer <= 0 && this.isConnected) {
            this.keyState = {
                W: this.keys.W.isDown,
                A: this.keys.A.isDown,
                S: this.keys.S.isDown,
                D: this.keys.D.isDown,
                SPACE: this.keys.SPACE.isDown,
            };
            const message = JSON.stringify({ type: 'input', data: this.keyState });
            try {
                this.ws.send(message);
                // console.log('Sent input:', this.keyState);
            } catch (e) {
                console.error('Failed to send input:', e);
            }
            this.moveTimer = 0.1;
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

        this.cameras.main.setZoom(zoom);

        // Scale UI properly, preserving Phaser game window styling
        this.uiContainer.setPosition(-(GAME_WIDTH - newWidth) * 0.5, -(GAME_HEIGHT - newHeight) * 0.5);

        console.log('Resized game to width:', newWidth, 'height:', newHeight);
    }
}