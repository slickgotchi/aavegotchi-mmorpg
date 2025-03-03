package main

import (
	"bytes"
	"encoding/json"
	"log"
	"math"
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

type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type Input struct {
	ID  string
	Msg Message
}

var (
	players          = make(map[string]*Player)
	updateChan       = make(chan []PlayerUpdate, 1000)
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
		ATK:       10,
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
		mu.RLock()
		playerCount := len(players)
		mu.RUnlock()

		if playerCount == 0 {
			continue
		}

		// handle all tick logic
		handleLogicPlayerMovement(TICK_INTERVAL_MS, time.Now().UnixMilli())

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
		case updateChan <- playerUpdates:
			// log.Println("GameLoop sent updates for", len(playerUpdates), "players")
		default:
			log.Println("GameLoop updateChan full, skipping broadcast")
		}
	}
}

func BroadcastLoop(updateChan <-chan []PlayerUpdate) {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		select {
		case updates := <-updateChan:
			mu.RLock()
			for _, p := range players {
				if err := p.Conn.WriteJSON(Message{
					Type: "playerUpdates",
					Data: mustMarshal(updates),
				}); err != nil {
					log.Println("Failed to broadcast player updates to", p.ID, ":", err)
				} else {
					// log.Println("Sent player updates to", p.ID, "count:", len(updates))
				}
			}
			mu.RUnlock()
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
	go GameLoop(updateChan)
	go BroadcastLoop(updateChan)

	http.HandleFunc("/ws", wsHandler)
	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
