package main

import (
	"bytes"
	"encoding/json"
	"log"

	// "math"

	// "math/rand"
	"net/http"
	"strconv"

	// "sync"
	"time"
	// "github.com/gorilla/websocket"
)

var httpClient = &http.Client{
	Timeout: 5 * time.Second,
}

// EnemyUpdate struct for broadcasting enemy state to clients
type EnemyUpdate struct {
	ID        string  `json:"id"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	HP        int     `json:"hp"`
	MaxHP     int     `json:"maxHp"`
	Type      string  `json:"type"`
	Timestamp int64   `json:"timestamp"`
	Direction int     `json:"direction"`
}

type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type AttackUpdate struct {
	AttackerID string   `json:"attackerId"`
	HitIDs     []string `json:"hitIds"`
	Type       string   `json:"type"`
	Radius     float32  `json:"radius"`
	X          float32  `json:"x"`
	Y          float32  `json:"y"`
}

type DamageUpdate struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Damage int    `json:"damage"`
}

type Input struct {
	ID  string
	Msg Message
}

var (
	// players          = make(map[string]*Player)
	// playerUpdateChan = make(chan []PlayerUpdate, 1000)
	enemyUpdateChan  = make(chan []EnemyUpdate, 1000)
	attackUpdateChan = make(chan []AttackUpdate, 1000)
	damageUpdateChan = make(chan []DamageUpdate, 1000)
	// mu               sync.RWMutex
	TICK_INTERVAL_MS int = 100
	MAP_WIDTH_TILES  int = 400
	MAP_HEIGHT_TILES int = 300
	PIXELS_PER_TILE  int = 32
)

func wsHandler(w http.ResponseWriter, r *http.Request) {
	HandlePlayerConnection(w, r)
}

func GameLoop(updateChan chan<- []PlayerUpdate) {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer func() {
		log.Println("GameLoop ticker stopped")
		ticker.Stop()
	}()

	for range ticker.C {
		if len(players) <= 0 {
			continue
		}

		UpdatePlayers(TICK_INTERVAL_MS, time.Now().UnixMilli())
		HandlePlayerAttacks(TICK_INTERVAL_MS, time.Now().UnixMilli())

		UpdateEnemies(TICK_INTERVAL_MS, time.Now().UnixMilli())
	}
}

func BroadcastLoopPlayerUpdates(playerUpdateChan <-chan []PlayerUpdate) {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case playerUpdates := <-playerUpdateChan:
			mu.Lock()
			for _, p := range players {
				if err := p.Conn.WriteJSON(Message{
					Type: "playerUpdates",
					Data: mustMarshal(playerUpdates),
				}); err != nil {
					log.Println("Failed to broadcast player updates to", p.ID, ":", err)
				} else {
					// log.Println("Sent player updates to", p.ID, "count:", len(playerUpdates))
				}
			}
			mu.Unlock()
		default:
			break
		}
	}
}

func BroadcastLoopEnemyUpdates(enemyUpdatechan <-chan []EnemyUpdate) {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case enemyUpdates := <-enemyUpdateChan:
			mu.Lock()
			for _, p := range players {
				if err := p.Conn.WriteJSON(Message{
					Type: "enemyUpdates",
					Data: mustMarshal(enemyUpdates),
				}); err != nil {
					log.Println("Failed to broadcast player updates to", p.ID, ":", err)
				} else {
					// log.Println("Sent player updates to", p.ID, "count:", len(updates))
				}
			}
			mu.Unlock()
		default:
			break
		}
	}
}

func BroadcastLoopAttackUpdates(attackUpdatechan <-chan []AttackUpdate) {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case attackUpdates := <-attackUpdateChan:
			mu.Lock()
			for _, p := range players {
				if err := p.Conn.WriteJSON(Message{
					Type: "attackUpdates",
					Data: mustMarshal(attackUpdates),
				}); err != nil {
					log.Println("Failed to broadcast player updates to", p.ID, ":", err)
				} else {
					// log.Println("Sent player updates to", p.ID, "count:", len(updates))
				}
			}
			mu.Unlock()
		default:
			break
		}
	}
}

func BroadcastLoopDamageUpdates(damageUpdatechan <-chan []DamageUpdate) {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case damageUpdates := <-damageUpdatechan:
			mu.Lock()
			for _, p := range players {
				if err := p.Conn.WriteJSON(Message{
					Type: "damageUpdates",
					Data: mustMarshal(damageUpdates),
				}); err != nil {
					log.Println("Failed to broadcast player updates to", p.ID, ":", err)
				} else {
					// log.Println("Sent player updates to", p.ID, "count:", len(updates))
				}
			}
			mu.Unlock()
		default:
			break
		}
	}
}

// Broadcasts a message to all players except the specified ID (optional)
func broadcastMessage(msg Message, excludeID string) {
	mu.RLock()
	defer mu.RUnlock()
	for id, p := range players {
		if excludeID != "" && id == excludeID {
			continue
		}
		if err := p.Conn.WriteJSON(msg); err != nil {
			log.Println("Failed to broadcast to", id, ":", err)
		} else {
			log.Println("Broadcasted", msg.Type, "to", id)
		}
	}
}

func mustMarshal(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		log.Println("JSON encoding error:", err)
		return nil
	}
	return json.RawMessage(data)
}

func fetchGotchiStats(gotchiId string) (int, error) {
	log.Println("Fetching stats for Gotchi ID:", gotchiId)
	query := `{"query":"query($id: ID!) { aavegotchi(id: $id) { modifiedNumericTraits withSetsRarityScore } }","variables":{"id":"` + gotchiId + `"}}`
	resp, err := httpClient.Post("https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-core-matic/api", "application/json", bytes.NewBuffer([]byte(query)))
	if err != nil {
		log.Println("HTTP error fetching stats for", gotchiId, ":", err)
		return 0, err
	}
	defer resp.Body.Close()
	var result struct {
		Data struct {
			Aavegotchi struct {
				ModifiedNumericTraits []int  `json:"modifiedNumericTraits"`
				WithSetsRarityScore   string `json:"withSetsRarityScore"`
			} `json:"aavegotchi"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Println("Decode error fetching stats for", gotchiId, ":", err)
		return 0, err
	}
	if result.Data.Aavegotchi.ModifiedNumericTraits == nil || len(result.Data.Aavegotchi.ModifiedNumericTraits) != 6 {
		log.Println("Invalid traits for Gotchi ID:", gotchiId)
		return 0, nil
	}
	brs, err := strconv.Atoi(result.Data.Aavegotchi.WithSetsRarityScore)
	if err != nil {
		log.Println("Conversion error for BRS:", err)
		return 0, err
	}
	// traits := result.Data.Aavegotchi.ModifiedNumericTraits
	// for _, trait := range traits {
	// 	adjusted := 0
	// 	if trait < 50 {
	// 		adjusted = 100 - trait
	// 	} else {
	// 		adjusted = trait + 1
	// 	}
	// 	brs += adjusted
	// }
	log.Println("Fetched stats for Gotchi ID:", gotchiId, "BRS:", brs)
	return brs, nil
}

func calculateStats(brs int) (hp, atk, ap int, rgn, speed float32) {
	hp = brs
	atk = brs / 10
	ap = brs / 2
	rgn = float32(brs) / 100
	speed = 5 * 32
	return
}

func main() {
	// Load tilemap on server startup
	if err := LoadTilemap(); err != nil {
		log.Fatal("Failed to load tilemap:", err)
	}

	go GameLoop(playerUpdateChan)
	go BroadcastLoopPlayerUpdates(playerUpdateChan)
	go BroadcastLoopEnemyUpdates(enemyUpdateChan)
	go BroadcastLoopAttackUpdates(attackUpdateChan)
	go BroadcastLoopDamageUpdates(damageUpdateChan)
	go HandleEnemyRespawns() // Start enemy respawn logic in a separate goroutine

	http.HandleFunc("/ws", wsHandler)
	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
