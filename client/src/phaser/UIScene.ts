import Phaser from 'phaser';
import { fetchAavegotchis, Aavegotchi } from './FetchGotchis';
import { ethers } from 'ethers';

const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1200;

export class UIScene extends Phaser.Scene {
    private uiContainer!: Phaser.GameObjects.Container;
    private connectButton!: Phaser.GameObjects.Rectangle;
    private connectText!: Phaser.GameObjects.Text;
    private gotchiSelectList!: Phaser.GameObjects.Container;
    private selectedGotchiText!: Phaser.GameObjects.Text;

    constructor() {
        super('UIScene');
    }

    create() {
        
        this.uiContainer = this.add.container(0, 0);
        this.uiContainer.setScrollFactor(0);
        this.uiContainer.setDepth(2000); // Ensure UI is above game elements

        // Connect Wallet Button (centered within 1920x1200 bounds)
        this.connectButton = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 250, 50, 0xffffff)
            .setOrigin(0.5, 0.5)
            .setInteractive()
            .on('pointerdown', () => this.connectWallet());
        this.connectText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Connect Wallet', { fontSize: '24px', color: '#000000' })
            .setOrigin(0.5, 0.5);
        this.uiContainer.add([this.connectButton, this.connectText]);

        // Aavegotchi Selection List (centered, within bounds, hidden initially)
        this.gotchiSelectList = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
        this.gotchiSelectList.setVisible(false);
        this.uiContainer.add(this.gotchiSelectList);

        // Selected Gotchi Text (top-left, within bounds, hidden initially)
        this.selectedGotchiText = this.add.text(20, 20, '', { fontSize: '24px', color: '#000000' })
            .setOrigin(0, 0)
            .setVisible(false);
        this.uiContainer.add(this.selectedGotchiText);

        // Listen for registry changes from App.tsx
        this.registry.events.on('changedata-account', this.updateUI, this);
        this.registry.events.on('changedata-gotchis', this.updateUI, this);
        this.registry.events.on('changedata-selectedGotchi', this.updateUI, this);

        console.log("Created UIScene");

        this.resizeGame();
        window.addEventListener('resize', () => this.resizeGame());
    }

    updateUI() {
        const account = this.registry.get('account') as string | null;
        const gotchis = this.registry.get('gotchis') as Aavegotchi[];
        const selectedGotchi = this.registry.get('selectedGotchi') as Aavegotchi | null;

        // Show/Hide Connect Button
        if (!account) {
            this.connectButton.setVisible(true);
            this.connectText.setVisible(true);
            this.gotchiSelectList.setVisible(false);
            this.selectedGotchiText.setVisible(false);
        } else if (!selectedGotchi && gotchis.length > 0) {
            // Show Aavegotchi Selection List
            this.connectButton.setVisible(false);
            this.connectText.setVisible(false);
            this.gotchiSelectList.setVisible(true);
            this.selectedGotchiText.setVisible(false);

            // Clear and rebuild selection list
            this.gotchiSelectList.removeAll(true);
            let yOffset = -gotchis.length * 30 / 2; // Center vertically
            gotchis.forEach((gotchi, index) => {
                const rect = this.add.rectangle(0, yOffset + index * 60, 400, 50, 0xffffff)
                    .setOrigin(0.5, 0.5)
                    .setInteractive()
                    .on('pointerdown', () => this.selectGotchi(gotchi));
                const text = this.add.text(0, yOffset + index * 60, `${gotchi.name} (BRS: ${calculateBRS(gotchi.modifiedNumericTraits)})`, { fontSize: '20px', color: '#000000' })
                    .setOrigin(0.5, 0.5);
                this.gotchiSelectList.add([rect, text]);
            });
        } else if (selectedGotchi) {
            // Show Selected Gotchi Text
            this.connectButton.setVisible(false);
            this.connectText.setVisible(false);
            this.gotchiSelectList.setVisible(false);
            this.selectedGotchiText.setVisible(true);
            this.selectedGotchiText.setText(`Playing as: ${selectedGotchi.name}`);
        }
    }

    connectWallet = async () => {
        console.log("connectWallet");
        if (window.ethereum) {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum);
                const accounts = await provider.send('eth_requestAccounts', []);
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x89' }],
                });
                const gotchis = await fetchAavegotchis(accounts[0]);
                gotchis.sort((a, b) => calculateBRS(b.modifiedNumericTraits) - calculateBRS(a.modifiedNumericTraits));
                this.registry.set('account', accounts[0]);
                this.registry.set('gotchis', gotchis);
            } catch (err) {
                console.error('Wallet connection or Gotchi fetch failed:', err.message || err);
            }
        } else {
            console.error('MetaMask not detected');
        }
    };

    selectGotchi(gotchi: Aavegotchi) {
        // Update registry to trigger App.tsx and GameScene
        if (this.registry.get('game')) {
            console.log("select gotchi: " + gotchi);
            this.registry.set('selectedGotchi', gotchi);
            this.registry.get('game').events.emit('selectGotchi', gotchi);
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

        // this.scale.resize(newWidth, newHeight);

        const zoomX = newWidth / GAME_WIDTH;
        const zoomY = newHeight / GAME_HEIGHT;
        const zoom = Math.min(zoomX, zoomY);

        this.cameras.main.setZoom(zoom);

        // Scale UI properly, preserving Phaser game window styling
        this.uiContainer.setPosition(-(GAME_WIDTH - newWidth) * 0.5, -(GAME_HEIGHT - newHeight) * 0.5);

        console.log('Resized game to width:', newWidth, 'height:', newHeight);
    }
}



// Helper function to calculate BRS (must be accessible in Phaser context)
function calculateBRS(traits: number[]): number {
    return traits.reduce((sum, trait) => sum + trait, 0);
}