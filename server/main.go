package main

import (
	"bytes"
	"encoding/json"
	"log"
	"math"
	"net/http"
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
	ID       string
	X        float32
	Y        float32
	HP       int
	MaxHP    int
	ATK      int
	AP       int
	MaxAP    int
	RGN      float32
	Speed    float32
	Conn     *websocket.Conn
	GotchiID string // Added to store Gotchi ID
}

type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type PlayerUpdate struct {
	ID string  `json:"id"`
	X  float32 `json:"x"`
	Y  float32 `json:"y"`
}

type Input struct {
	ID  string
	Msg Message
}

var (
	players    = make(map[string]*Player)
	inputChan  = make(chan Input, 10000)
	updateChan = make(chan []PlayerUpdate, 1000)
	mu         sync.RWMutex
)

func fetchGotchiStats(gotchiID string) (int, error) {
	log.Println("Fetching stats for Gotchi ID:", gotchiID)
	query := `{"query":"query($id: ID!) { aavegotchi(id: $id) { modifiedNumericTraits } }","variables":{"id":"` + gotchiID + `"}}`
	resp, err := httpClient.Post("https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-core-matic/api", "application/json", bytes.NewBuffer([]byte(query)))
	if err != nil {
		log.Println("HTTP error fetching stats for", gotchiID, ":", err)
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
		log.Println("Decode error fetching stats for", gotchiID, ":", err)
		return 0, err
	}
	if result.Data.Aavegotchi.ModifiedNumericTraits == nil || len(result.Data.Aavegotchi.ModifiedNumericTraits) != 6 {
		log.Println("Invalid traits for Gotchi ID:", gotchiID)
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
	log.Println("Fetched stats for Gotchi ID:", gotchiID, "BRS:", brs)
	return brs, nil
}

func calculateStats(brs int) (hp, atk, ap int, rgn, speed float32) {
	hp = brs * 2
	atk = brs / 5
	ap = brs
	rgn = float32(brs) / 100
	speed = 200
	return
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

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}

	playerID := r.RemoteAddr
	p := &Player{
		ID:    playerID,
		X:     8960,
		Y:     5600,
		HP:    100,
		MaxHP: 100,
		ATK:   10,
		AP:    100,
		MaxAP: 100,
		RGN:   1.0,
		Speed: 200,
		Conn:  conn,
		// GotchiID will be set after "join" message
	}
	mu.Lock()
	players[playerID] = p
	mu.Unlock()
	log.Println("Player connection established:", playerID)

	// Broadcast existing players to new player immediately (world-only mode)
	mu.RLock()
	var existingPlayers []map[string]interface{}
	for id, existingP := range players {
		if id != playerID {
			existingPlayers = append(existingPlayers, map[string]interface{}{
				"id":       existingP.ID,
				"x":        existingP.X,
				"y":        existingP.Y,
				"hp":       existingP.HP,
				"maxHP":    existingP.MaxHP,
				"atk":      existingP.ATK,
				"ap":       existingP.AP,
				"maxAP":    existingP.MaxAP,
				"rgn":      existingP.RGN,
				"gotchiID": existingP.GotchiID,
			})
		}
	}
	mu.RUnlock()

	// Send initial player updates to new connection with empty array if no players
	initialUpdates := Message{
		Type: "playerUpdates",
		Data: mustMarshal(existingPlayers), // Ensure updates is always an array, even if empty
	}
	if err := p.Conn.WriteJSON(initialUpdates); err != nil {
		log.Println("Failed to send initial player updates to", playerID, ":", err)
	} else {
		log.Println("Sent initial player updates to", playerID, "count:", len(existingPlayers))
	}

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

		// Wait for "join" message to get GotchiID
		_, firstMsg, err := p.Conn.ReadMessage()
		if err != nil {
			log.Println("Failed to read initial message for", p.ID, ":", err)
			return
		}
		var joinMsg Message
		if err := json.Unmarshal(firstMsg, &joinMsg); err != nil {
			log.Println("Failed to unmarshal join message from", p.ID, ":", err)
			p.Conn.Close()
			return
		}
		if joinMsg.Type != "join" {
			log.Println("Expected 'join' message, got", joinMsg.Type, "from", p.ID)
			p.Conn.Close()
			return
		}
		var joinData struct {
			GotchiID string `json:"gotchiID"`
		}
		if err := json.Unmarshal(joinMsg.Data, &joinData); err != nil || joinData.GotchiID == "" {
			log.Println("Invalid join data from", p.ID, ":", err)
			p.Conn.Close()
			return
		}

		// Set GotchiID and proceed
		mu.Lock()
		p.GotchiID = joinData.GotchiID
		players[p.ID] = p // Update player with GotchiID
		// Collect existing players
		var existingPlayers []map[string]interface{}
		for id, existingP := range players {
			if id != playerID {
				existingPlayers = append(existingPlayers, map[string]interface{}{
					"id":       existingP.ID,
					"x":        existingP.X,
					"y":        existingP.Y,
					"hp":       existingP.HP,
					"maxHP":    existingP.MaxHP,
					"atk":      existingP.ATK,
					"ap":       existingP.AP,
					"maxAP":    existingP.MaxAP,
					"rgn":      existingP.RGN,
					"gotchiID": existingP.GotchiID,
				})
			}
		}
		mu.Unlock()
		log.Println("Player joined with GotchiID:", p.GotchiID)

		// Send init message with existing players
		initialMsg := Message{
			Type: "init",
			Data: mustMarshal(map[string]interface{}{
				"map": "mmorpg.json",
				"player": map[string]interface{}{
					"hp":       p.HP,
					"maxHP":    p.MaxHP,
					"atk":      p.ATK,
					"ap":       p.AP,
					"maxAP":    p.MaxAP,
					"rgn":      p.RGN,
					"x":        p.X,
					"y":        p.Y,
					"id":       p.ID,
					"gotchiID": p.GotchiID,
				},
				"existingPlayers": existingPlayers,
				"enemies":         map[string]interface{}{}, // Add your enemy data here if applicable
			}),
		}
		if err := p.Conn.WriteJSON(initialMsg); err != nil {
			log.Println("Failed to send init message to", p.ID, ":", err)
			return
		}
		log.Println("Sent init message to", p.ID)

		// Broadcast "newPlayer" to existing players
		newPlayerMsg := Message{
			Type: "newPlayer",
			Data: mustMarshal(map[string]interface{}{
				"id":       p.ID,
				"x":        p.X,
				"y":        p.Y,
				"hp":       p.HP,
				"maxHP":    p.MaxHP,
				"atk":      p.ATK,
				"ap":       p.AP,
				"maxAP":    p.MaxAP,
				"rgn":      p.RGN,
				"gotchiID": p.GotchiID,
			}),
		}
		broadcastMessage(newPlayerMsg, p.ID)

		// Continue reading subsequent messages
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

			select {
			case inputChan <- Input{ID: p.ID, Msg: m}:
				log.Printf("Queued message for %s. Input channel length: %d", p.ID, len(inputChan))
			default:
				log.Println("Input channel full, dropping message for", p.ID)
			}
		}
	}(p)

	<-make(chan struct{})
}

func GameLoop(inputChan <-chan Input, updateChan chan<- []PlayerUpdate) {
	ticker := time.NewTicker(100 * time.Millisecond)
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

		var inputs []Input
		for i := 0; i < 100; i++ {
			select {
			case input := <-inputChan:
				log.Println("GameLoop dequeued input for", input.ID, "type:", input.Msg.Type)
				inputs = append(inputs, input)
			case <-time.After(1 * time.Millisecond):
				// log.Println("GameLoop no input available after timeout")
				// break
			}
		}

		for _, input := range inputs {
			mu.Lock()
			p, ok := players[input.ID]
			if !ok {
				mu.Unlock()
				log.Println("Player", input.ID, "not found, skipping input")
				continue
			}
			log.Println("GameLoop process input for", p.ID, "type:", input.Msg.Type)
			mu.Unlock()

			switch input.Msg.Type {
			case "input":
				var keys struct{ W, A, S, D, SPACE bool }
				if err := json.Unmarshal(input.Msg.Data, &keys); err != nil {
					log.Println("Failed to unmarshal input for", p.ID, ":", err)
					continue
				}
				vx, vy := float32(0), float32(0)
				if keys.W {
					vy -= p.Speed
				}
				if keys.S {
					vy += p.Speed
				}
				if keys.A {
					vx -= p.Speed
				}
				if keys.D {
					vx += p.Speed
				}
				if vx != 0 || vy != 0 {
					norm := float32(math.Sqrt(float64(vx*vx + vy*vy)))
					p.X += (vx / norm) * p.Speed * 0.1
					p.Y += (vy / norm) * p.Speed * 0.1
				}
			case "join":
				var joinData struct {
					GotchiID string `json:"gotchiID"`
				}
				if err := json.Unmarshal(input.Msg.Data, &joinData); err != nil || joinData.GotchiID == "" {
					log.Println("Invalid join data from", p.ID, ":", err)
					continue
				}
				mu.Lock()
				p.GotchiID = joinData.GotchiID
				players[p.ID] = p // Update player with GotchiID
				// Collect existing players
				var existingPlayers []map[string]interface{}
				for id, existingP := range players {
					if id != p.ID {
						existingPlayers = append(existingPlayers, map[string]interface{}{
							"id":       existingP.ID,
							"x":        existingP.X,
							"y":        existingP.Y,
							"hp":       existingP.HP,
							"maxHP":    existingP.MaxHP,
							"atk":      existingP.ATK,
							"ap":       existingP.AP,
							"maxAP":    existingP.MaxAP,
							"rgn":      existingP.RGN,
							"gotchiID": existingP.GotchiID,
						})
					}
				}
				mu.Unlock()
				log.Println("Player joined with GotchiID:", p.GotchiID)

				// Send init message with existing players
				initialMsg := Message{
					Type: "init",
					Data: mustMarshal(map[string]interface{}{
						"map": "mmorpg.json",
						"player": map[string]interface{}{
							"hp":       p.HP,
							"maxHP":    p.MaxHP,
							"atk":      p.ATK,
							"ap":       p.AP,
							"maxAP":    p.MaxAP,
							"rgn":      p.RGN,
							"x":        p.X,
							"y":        p.Y,
							"id":       p.ID,
							"gotchiID": p.GotchiID,
						},
						"existingPlayers": existingPlayers,
						"enemies":         map[string]interface{}{}, // Add your enemy data here if applicable
					}),
				}
				if err := p.Conn.WriteJSON(initialMsg); err != nil {
					log.Println("Failed to send init message to", p.ID, ":", err)
					continue
				}
				log.Println("Sent init message to", p.ID)

				// Broadcast "newPlayer" to existing players
				newPlayerMsg := Message{
					Type: "newPlayer",
					Data: mustMarshal(map[string]interface{}{
						"id":       p.ID,
						"x":        p.X,
						"y":        p.Y,
						"hp":       p.HP,
						"maxHP":    p.MaxHP,
						"atk":      p.ATK,
						"ap":       p.AP,
						"maxAP":    p.MaxAP,
						"rgn":      p.RGN,
						"gotchiID": p.GotchiID,
					}),
				}
				broadcastMessage(newPlayerMsg, p.ID)
			case "stats":
				var stats struct{ GotchiID string }
				if err := json.Unmarshal(input.Msg.Data, &stats); err != nil {
					log.Println("Failed to unmarshal stats for", p.ID, ":", err)
					continue
				}
				brs, err := fetchGotchiStats(stats.GotchiID)
				if err != nil {
					log.Println("Failed to fetch stats for", p.ID, ":", err)
					continue
				}
				mu.Lock()
				p.HP, p.ATK, p.AP, p.RGN, p.Speed = calculateStats(brs)
				p.MaxHP, p.MaxAP = p.HP, p.AP
				mu.Unlock()
				if err := p.Conn.WriteJSON(Message{
					Type: "stats",
					Data: mustMarshal(map[string]interface{}{
						"hp":       p.HP,
						"maxHP":    p.MaxHP,
						"atk":      p.ATK,
						"ap":       p.AP,
						"maxAP":    p.MaxAP,
						"rgn":      p.RGN,
						"x":        p.X,
						"y":        p.Y,
						"id":       p.ID,
						"gotchiID": p.GotchiID,
					}),
				}); err != nil {
					log.Println("Failed to send stats response to", p.ID, ":", err)
				}
			}
		}

		mu.RLock()
		var playerUpdates []PlayerUpdate
		for _, p := range players {
			playerUpdates = append(playerUpdates, PlayerUpdate{ID: p.ID, X: p.X, Y: p.Y})
		}
		mu.RUnlock()

		if len(playerUpdates) > 0 {
			select {
			case updateChan <- playerUpdates:
				log.Println("GameLoop sent updates for", len(playerUpdates), "players")
			default:
				log.Println("GameLoop updateChan full, skipping broadcast")
			}
		}
	}
}

func BroadcastLoop(updateChan <-chan []PlayerUpdate) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		// log.Println("Broadcast tick")
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
					log.Println("Sent player updates to", p.ID, "count:", len(updates))
				}
			}
			mu.RUnlock()
		default:
			mu.RLock()
			var playerUpdates []PlayerUpdate
			for _, p := range players {
				playerUpdates = append(playerUpdates, PlayerUpdate{ID: p.ID, X: p.X, Y: p.Y})
			}
			for _, p := range players {
				if err := p.Conn.WriteJSON(Message{
					Type: "playerUpdates",
					Data: mustMarshal(playerUpdates),
				}); err != nil {
					log.Println("Failed to broadcast default player updates to", p.ID, ":", err)
				} else {
					log.Println("Sent default player updates to", p.ID, "count:", len(playerUpdates))
				}
			}
			mu.RUnlock()
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

func main() {
	go GameLoop(inputChan, updateChan)
	go BroadcastLoop(updateChan)

	http.HandleFunc("/ws", wsHandler)
	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
