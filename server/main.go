package main

import (
	"bytes"
	"encoding/json"
	"log"
	"math"

	// "math/rand"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == "http://localhost:5173"
	},
}

var httpClient = &http.Client{
	Timeout: 5 * time.Second,
}

type Player struct {
	ID        string
	X         float32
	Y         float32
	HP        int
	MaxHP     int
	ATK       int
	AP        int
	MaxAP     int
	RGN       float32
	Speed     float32
	Conn      *websocket.Conn
	GotchiID  int // Added to store Gotchi ID
	IsPlaying bool
	VelocityX float32
	VelocityY float32
	Direction int // 0 = front, 1 = left, 2 = right, 3 = back

	AttackTimerMs    float32
	AttackIntervalMs float32
	AttackRadius     float32
}

type PlayerUpdate struct {
	ID        string  `json:"id"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	HP        int     `json:"hp"`
	MaxHP     int     `json:"maxHp"`
	AP        int     `json:"ap"`
	MaxAP     int     `json:"maxAp"`
	GotchiID  int     `json:"gotchiId"`
	Timestamp int64   `json:"timestamp"`
	Direction int     `json:"direction"`
}

/*
type Enemy struct {
	ID          string
	X           float32 // In pixels
	Y           float32 // In pixels
	Type        string
	LayerName   string // Reference to the enemy layer it belongs to
	HP          int
	MaxHP       int
	RespawnTime int64 // Unix timestamp in milliseconds for respawn
	IsAlive     bool
	VelocityX   float32
	VelocityY   float32
	Direction   int // 0 = front, 1 = left, 2 = right, 3 = back
}
*/

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
	players          = make(map[string]*Player)
	playerUpdateChan = make(chan []PlayerUpdate, 1000)
	enemyUpdateChan  = make(chan []EnemyUpdate, 1000)
	attackUpdateChan = make(chan []AttackUpdate, 1000)
	damageUpdateChan = make(chan []DamageUpdate, 1000)
	mu               sync.RWMutex
	TICK_INTERVAL_MS int = 100
	MAP_WIDTH_TILES  int = 400
	MAP_HEIGHT_TILES int = 300
	PIXELS_PER_TILE  int = 32
)

func wsHandler(w http.ResponseWriter, r *http.Request) {
	// upgrade connection to websocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}

	// create a new player
	p := &Player{
		ID:        r.RemoteAddr,
		X:         float32(MAP_WIDTH_TILES*PIXELS_PER_TILE) / 2,
		Y:         float32(MAP_HEIGHT_TILES*PIXELS_PER_TILE) / 2,
		HP:        100,
		MaxHP:     100,
		ATK:       45,
		AP:        100,
		MaxAP:     100,
		RGN:       1.0,
		Speed:     5 * 32,
		Conn:      conn,
		GotchiID:  0, // we set GotchiID after 'join' message is received
		IsPlaying: false,
		VelocityX: 0,
		VelocityY: 0,
		Direction: 0,

		AttackTimerMs:    0,
		AttackIntervalMs: 1000,
		AttackRadius:     4 * 32,
	}

	// store new player in players
	mu.Lock()
	players[r.RemoteAddr] = p
	mu.Unlock()

	// Send welcome message with player ID
	welcomeMsg := Message{
		Type: "welcome",
		Data: mustMarshal(struct {
			ID string `json:"id"`
		}{ID: p.ID}),
	}
	if err := conn.WriteJSON(welcomeMsg); err != nil {
		log.Println("Failed to send welcome to", p.ID, ":", err)
	}

	log.Println("Player connection established:", r.RemoteAddr)

	go func(p *Player) {
		defer func() {
			mu.Lock()
			delete(players, p.ID)
			mu.Unlock()
			p.Conn.Close()
			log.Println("Client disconnected:", p.ID)
			disconnectMsg := Message{
				Type: "playerDisconnected",
				Data: mustMarshal(map[string]interface{}{
					"id": p.ID,
				}),
			}
			broadcastMessage(disconnectMsg, "")
		}()

		// handle messages as soon as received
		for {
			_, msg, err := p.Conn.ReadMessage()
			if err != nil {
				log.Println("Read error for", p.ID, ":", err)
				return
			}

			var m Message
			if err := json.Unmarshal(msg, &m); err != nil {
				log.Println("Failed to unmarshal message from", p.ID, ":", err)
				continue
			}

			// we handle messages immediately because relying on an input channel
			// can lead to time discrepancies in our core game loop.
			// the process is to:
			// - handle input immediately
			// - process game logic at the fixed game interval
			switch m.Type {
			case "join":
				handlePlayerMessageJoin(p, m)
			case "input":
				handlePlayerMessageInput(p, m)
			default:
			}
		}
	}(p)

	<-make(chan struct{})
}

func handlePlayerMessageJoin(p *Player, msg Message) {
	var joinData struct {
		GotchiID int `json:"gotchiId"`
	}
	if err := json.Unmarshal(msg.Data, &joinData); err != nil || joinData.GotchiID == 0 {
		log.Println("Invalid join data from", p.ID, ":", err)
		return
	}

	mu.Lock()
	p.GotchiID = joinData.GotchiID
	mu.Unlock()

	log.Println("Player joined with GotchiID:", p.GotchiID)

	brs, err := fetchGotchiStats(strconv.Itoa(joinData.GotchiID))
	if err != nil {
		log.Println("Failed to fetch stats for", p.ID, ":", err)
		return
	}

	mu.Lock()
	p.HP, p.ATK, p.AP, p.RGN, p.Speed = calculateStats(brs)
	p.MaxHP, p.MaxAP = p.HP, p.AP
	p.IsPlaying = true
	p.X = float32(MAP_WIDTH_TILES*PIXELS_PER_TILE) / 2
	p.Y = float32(MAP_HEIGHT_TILES*PIXELS_PER_TILE) / 2
	p.Direction = 0
	mu.Unlock()
}

func handlePlayerMessageInput(p *Player, msg Message) {
	var inputData struct {
		ID   string `json:"id"`
		Keys struct {
			W     bool `json:"W"`
			A     bool `json:"A"`
			S     bool `json:"S"`
			D     bool `json:"D"`
			SPACE bool `json:"SPACE"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(msg.Data, &inputData); err != nil {
		log.Println("Failed to unmarshal input for", p.ID, ":", err)
		return
	}

	mu.Lock()

	vx, vy := float32(0), float32(0)
	if inputData.Keys.W {
		vy -= p.Speed
	}
	if inputData.Keys.S {
		vy += p.Speed
	}
	if inputData.Keys.A {
		vx -= p.Speed
	}
	if inputData.Keys.D {
		vx += p.Speed
	}
	if vx != 0 || vy != 0 {
		norm := float32(math.Sqrt(float64(vx*vx + vy*vy)))

		p.VelocityX = (vx / norm) * p.Speed
		p.VelocityY = (vy / norm) * p.Speed

		if p.VelocityY < 0 {
			p.Direction = 3
		}
		if p.VelocityY > 0 {
			p.Direction = 0
		}
		if p.VelocityX > 0 {
			p.Direction = 2
		}
		if p.VelocityX < 0 {
			p.Direction = 1
		}
	}

	if math.Abs(float64(vx)) < 0.01 && math.Abs(float64(vy)) < 0.01 {
		p.VelocityX = 0
		p.VelocityY = 0
	}

	mu.Unlock()
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

		handleLogicPlayerMovement(TICK_INTERVAL_MS, time.Now().UnixMilli())
		handleLogicPlayerAttacks(TICK_INTERVAL_MS, time.Now().UnixMilli())

		handleLogicEnemyMovement(TICK_INTERVAL_MS, time.Now().UnixMilli())
	}
}

func handleLogicPlayerMovement(tickInterval_ms int, timestamp int64) {
	mu.RLock()
	var playerUpdates []PlayerUpdate
	for _, p := range players {
		// update player position
		p.X += p.VelocityX * float32(tickInterval_ms) * 0.001
		p.Y += p.VelocityY * float32(tickInterval_ms) * 0.001

		playerUpdate := PlayerUpdate{
			ID:        p.ID,
			X:         p.X,
			Y:         p.Y,
			HP:        p.HP,
			MaxHP:     p.MaxHP,
			AP:        p.AP,
			MaxAP:     p.MaxAP,
			GotchiID:  p.GotchiID,
			Timestamp: timestamp,
			Direction: p.Direction,
		}

		playerUpdates = append(playerUpdates, playerUpdate)
	}
	mu.RUnlock()

	if len(playerUpdates) > 0 {
		select {
		case playerUpdateChan <- playerUpdates:
			// log.Println("GameLoop sent updates for", len(playerUpdates), "players")
		default:
			log.Println("GameLoop updateChan full, skipping broadcast")
		}
	}
}

func handleLogicPlayerAttacks(tickIntervalms int, timestamp int64) {

	var attackUpdates []AttackUpdate
	var damageUpdates []DamageUpdate

	for _, p := range players {
		mu.Lock()
		// check for enemies in range
		playerMinX := p.X - 40*0.5*32
		playerMinY := p.Y - 25*0.5*32
		playerMaxX := p.X + 40*0.5*32
		playerMaxY := p.Y + 25*0.5*32

		isEnemiesOnScreen := false

		for _, e := range Enemies {
			if e.X > playerMinX && e.X < playerMaxX && e.Y > playerMinY && e.Y < playerMaxY {
				isEnemiesOnScreen = true
				break
			}
		}

		if isEnemiesOnScreen {
			p.AttackTimerMs -= float32(tickIntervalms)
			if p.AttackTimerMs < 0 {
				p.AttackTimerMs += p.AttackIntervalMs

				hitEnemies := make([]string, 0)

				for _, e := range Enemies {

					distSq := (e.X-p.X)*(e.X-p.X) + (e.Y-p.Y)*(e.Y-p.Y)
					if distSq < p.AttackRadius*p.AttackRadius {
						e.HP -= p.ATK

						damageUpdate := DamageUpdate{
							ID:     e.ID,
							Type:   "enemy",
							Damage: p.ATK,
						}
						damageUpdates = append(damageUpdates, damageUpdate)

						hitEnemies = append(hitEnemies, e.ID)
					}
				}

				attackUpdate := AttackUpdate{
					AttackerID: p.ID,
					HitIDs:     hitEnemies,
					Type:       "playerAttack",
					Radius:     p.AttackRadius,
					X:          p.X,
					Y:          p.Y,
				}

				attackUpdates = append(attackUpdates, attackUpdate)
			}
		}
		mu.Unlock()
	}

	if len(attackUpdates) > 0 {
		select {
		case attackUpdateChan <- attackUpdates:
			// log.Println("GameLoop sent updates for", len(playerUpdates), "players")
		default:
			log.Println("GameLoop updateChan full, skipping broadcast")
		}
	}

	if len(damageUpdates) > 0 {
		select {
		case damageUpdateChan <- damageUpdates:
			// log.Println("GameLoop sent updates for", len(playerUpdates), "players")
		default:
			log.Println("GameLoop updateChan full, skipping broadcast")
		}
	}

}

func removeEnemy(enemyID string) {
	mu.Lock()
	defer mu.Unlock()

	_, exists := Enemies[enemyID]
	if !exists {
		return // ✅ Enemy already removed, avoid crashing
	}

	log.Println("Removing enemy:", enemyID)

	// Remove enemy from the map
	delete(Enemies, enemyID)
}

func handleLogicEnemyMovement(tickInterval_ms int, timestamp int64) {
	UpdateEnemies(tickInterval_ms, timestamp)
	/*
		enemiesToRemove := make([]string, 0)

		mu.Lock()
		var enemyUpdates []EnemyUpdate
		for _, e := range Enemies {
			// Simple enemy movement (e.g., random or patrolling)
			if rand.Intn(100) < 5 { // 5% chance to change direction each tick
				e.VelocityX = float32(rand.Intn(3)-1) * 32 // -32 to 32 pixels per second
				e.VelocityY = float32(rand.Intn(3)-1) * 32
				if e.VelocityY < 0 {
					e.Direction = 3 // back
				} else if e.VelocityY > 0 {
					e.Direction = 0 // front
				} else if e.VelocityX > 0 {
					e.Direction = 2 // right
				} else if e.VelocityX < 0 {
					e.Direction = 1 // left
				}
			}
			e.X += e.VelocityX * float32(tickInterval_ms) * 0.001
			e.Y += e.VelocityY * float32(tickInterval_ms) * 0.001

			enemyUpdate := EnemyUpdate{
				ID:        e.ID,
				X:         e.X,
				Y:         e.Y,
				HP:        e.HP,
				MaxHP:     e.MaxHP,
				Type:      e.Type,
				Timestamp: timestamp,
				Direction: e.Direction,
			}

			if e.HP <= 0 {
				enemiesToRemove = append(enemiesToRemove, e.ID)
			}

			enemyUpdates = append(enemyUpdates, enemyUpdate)
		}
		mu.Unlock()

		if len(enemyUpdates) > 0 {
			select {
			case enemyUpdateChan <- enemyUpdates:
				// log.Println("GameLoop sent updates for", len(playerUpdates), "players")
			default:
				log.Println("GameLoop updateChan full, skipping broadcast")
			}
		}

		for _, etr := range enemiesToRemove {
			removeEnemy(etr)
		}
	*/
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
	query := `{"query":"query($id: ID!) { aavegotchi(id: $id) { modifiedNumericTraits } }","variables":{"id":"` + gotchiId + `"}}`
	resp, err := httpClient.Post("https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-core-matic/api", "application/json", bytes.NewBuffer([]byte(query)))
	if err != nil {
		log.Println("HTTP error fetching stats for", gotchiId, ":", err)
		return 0, err
	}
	defer resp.Body.Close()
	var result struct {
		Data struct {
			Aavegotchi struct {
				ModifiedNumericTraits []int `json:"modifiedNumericTraits"`
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
	brs := 0
	traits := result.Data.Aavegotchi.ModifiedNumericTraits
	for _, trait := range traits {
		adjusted := 0
		if trait < 50 {
			adjusted = 100 - trait
		} else {
			adjusted = trait + 1
		}
		brs += adjusted
	}
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
