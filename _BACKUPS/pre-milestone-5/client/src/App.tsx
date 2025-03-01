import { useRef, useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { GameScene } from './phaser/GameScene'
import { fetchAavegotchis, Aavegotchi, calculateBRS } from './phaser/FetchGotchis'

function App() {
    const gameRef = useRef<Phaser.Game | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [account, setAccount] = useState<string | null>(null)
    const [gotchis, setGotchis] = useState<Aavegotchi[]>([])
    const [selectedGotchi, setSelectedGotchi] = useState<Aavegotchi | null>(null)

    useEffect(() => {
        if (!containerRef.current || !selectedGotchi) return

        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: containerRef.current,
            scene: [GameScene],
            scale:{
                mode: Phaser.Scale.NONE,
            }
        }

        if (!gameRef.current) {
            gameRef.current = new Phaser.Game(config)
            gameRef.current.registry.set('selectedGotchi', selectedGotchi) // Pass to Phaser
        }

        return () => {
            if (gameRef.current) {
                gameRef.current.destroy(true)
                gameRef.current = null
            }
        }
    }, [selectedGotchi])

    const connectWallet = async () => {
        if (window.ethereum) {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum)
                const accounts = await provider.send('eth_requestAccounts', [])
                setAccount(accounts[0])
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x89' }],
                })
                const gotchis = await fetchAavegotchis(accounts[0])
                setGotchis(gotchis.sort((a, b) => calculateBRS(b.modifiedNumericTraits) - calculateBRS(a.modifiedNumericTraits)))
            } catch (err) {
                console.error('Wallet connection or Gotchi fetch failed:', err.message || err)
            }
        } else {
            console.error('MetaMask not detected')
        }
    }

    return (
        <div>
            {!account ? (
                <button onClick={connectWallet}>Connect Wallet</button>
            ) : !selectedGotchi ? (
                <div>
                    <h2>Select Your Aavegotchi</h2>
                    <ul>
                        {gotchis.map(g => (
                            <li key={g.id} onClick={() => setSelectedGotchi(g)}>
                                {g.name} (BRS: {calculateBRS(g.modifiedNumericTraits)})
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                        <p>Playing as: {selectedGotchi.name}</p>
                    )}
            <div ref={containerRef} style={{ width: '1280px', height: '800px' }} />
        </div>
    )
}

export default App