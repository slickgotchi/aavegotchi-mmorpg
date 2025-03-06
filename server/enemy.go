package main

import (
	// "log"
	"math"
	"math/rand"
	"sync"

	// "time"
	"log"
)

// EnemyProfile defines stat profiles for different enemy types
type EnemyProfile struct {
	HP              int
	MaxHP           int
	RoamSpeed       float32
	AggroRadius     float32
	TelegraphRadius float32
	AttackRadius    float32
	AttackDamage    int
	XPDrop          int
}

// EnemyProfiles stores predefined profiles for enemy types
var EnemyProfiles = map[string]EnemyProfile{
	"easy": {
		HP:              50,
		MaxHP:           50,
		RoamSpeed:       1 * 32, // 1 tile per second
		AggroRadius:     4 * 32, // 4 tiles
		TelegraphRadius: 1 * 32, // 1 tile
		AttackRadius:    1 * 32, // 1 tile
		AttackDamage:    5,
		XPDrop:          10, // XP drop for easy enemies
	},
	"medium": {
		HP:              100,
		MaxHP:           100,
		RoamSpeed:       1.5 * 32, // 1.5 tiles per second
		AggroRadius:     8 * 32,   // 8 tiles
		TelegraphRadius: 1.5 * 32, // 1.5 tiles
		AttackRadius:    1.5 * 32, // 1.5 tiles
		AttackDamage:    10,
		XPDrop:          20, // XP drop for medium enemies
	},
	"hard": {
		HP:              150,
		MaxHP:           150,
		RoamSpeed:       2 * 32,  // 2 tiles per second
		AggroRadius:     12 * 32, // 12 tiles
		TelegraphRadius: 2 * 32,  // 2 tiles
		AttackRadius:    2 * 32,  // 2 tiles
		AttackDamage:    15,
		XPDrop:          30, // XP drop for hard enemies
	},
}

const (
	// Enemy states
	StateSpawn     = "Spawn"
	StateRoam      = "Roam"
	StatePursue    = "Pursue"
	StateTelegraph = "Telegraph"
	StateAttack    = "Attack"
	StateCooldown  = "Cooldown"
	StateDeath     = "Death"
)

// Extended Enemy struct with state machine properties
type Enemy struct {
	ID               string
	X                float32
	Y                float32
	Type             string
	LayerName        string
	HP               int
	MaxHP            int
	RespawnTime      int64
	IsAlive          bool
	VelocityX        float32
	VelocityY        float32
	Direction        int
	XPDrop           int
	KillerID         string
	IsDeathProcessed bool
	Mu               sync.RWMutex

	// State machine properties
	State           string
	StateTimer      float32 // Time remaining in current state (seconds)
	SpawnPointX     float32 // Original spawn location
	SpawnPointY     float32
	RoamSpeed       float32
	AggroRadius     float32
	TelegraphRadius float32
	AttackRadius    float32
	AttackDamage    int
}

// Global enemies map (moved from main.go)
var Enemies = make(map[string]*Enemy)

// Initialize a new enemy
func NewEnemy(id, enemyType, layerName string, x, y float32) *Enemy {
	mu.Lock()
	defer mu.Unlock()

	profile, ok := EnemyProfiles[enemyType]
	if !ok {
		profile = EnemyProfiles["medium"] // Default to medium if type not found
	}

	e := &Enemy{
		ID:              id,
		X:               x,
		Y:               y,
		Type:            enemyType,
		LayerName:       layerName,
		HP:              profile.HP,
		MaxHP:           profile.MaxHP,
		IsAlive:         true,
		Direction:       0,
		State:           StateSpawn,
		StateTimer:      1.0, // 1 second spawn duration
		SpawnPointX:     x,
		SpawnPointY:     y,
		RoamSpeed:       profile.RoamSpeed,
		AggroRadius:     profile.AggroRadius,
		TelegraphRadius: profile.TelegraphRadius,
		AttackRadius:    profile.AttackRadius,
		AttackDamage:    profile.AttackDamage,
		XPDrop:          profile.XPDrop,
		KillerID:        "",
	}

	Enemies[id] = e

	return e
}

// UpdateEnemies handles the enemy state machine and movement
func UpdateEnemies(tickIntervalMs int, timestamp int64) {
	mu.RLock()

	var enemyUpdates []EnemyUpdate
	var damageUpdates []DamageUpdate
	var attackUpdates []AttackUpdate

	deltaTime := float32(tickIntervalMs) / 1000.0 // Convert to seconds

	for _, e := range Enemies {
		e.Mu.Lock() // lock per enemy

		if !e.IsAlive {
			e.Mu.Unlock()
			continue
		}

		e.StateTimer -= deltaTime
		nearestPlayer := findNearestPlayer(e)

		switch e.State {
		case StateSpawn:
			if e.StateTimer <= 0 {
				e.State = StateRoam
				e.StateTimer = 0
			}

		case StateRoam:
			updateRoamState(e, deltaTime)
			if nearestPlayer != nil && distanceTo(e, nearestPlayer) < e.AggroRadius {
				e.State = StatePursue
			}

		case StatePursue:
			updatePursueState(e, nearestPlayer, deltaTime)
			if nearestPlayer == nil || distanceTo(e, nearestPlayer) > e.AggroRadius {
				e.State = StateRoam
			} else if distanceTo(e, nearestPlayer) < e.TelegraphRadius {
				e.State = StateTelegraph
				e.StateTimer = 0.5 // 0.5 second telegraph
				e.VelocityX = 0
				e.VelocityY = 0
			}

		case StateTelegraph:
			if e.StateTimer <= 0 {
				e.State = StateAttack
				e.StateTimer = 0.5 // 0.5 second attack duration
			}

		case StateAttack:
			if e.StateTimer <= 0 {
				// log an attack
				attackUpdates = append(attackUpdates, AttackUpdate{
					AttackerID: e.ID,
					HitIDs:     nil,
					Type:       "enemyAttack",
					Radius:     e.AttackRadius,
					X:          e.X,
					Y:          e.Y,
				})

				// Perform attack only on nearby players (spatial check)
				enemyMinX := e.X - e.AttackRadius
				enemyMinY := e.Y - e.AttackRadius
				enemyMaxX := e.X + e.AttackRadius
				enemyMaxY := e.Y + e.AttackRadius

				for _, p := range players {
					if p.X < enemyMinX || p.X > enemyMaxX || p.Y < enemyMinY || p.Y > enemyMaxY {
						continue // Skip players outside rough range
					}

					if distanceTo(e, p) < e.AttackRadius {
						p.HP -= e.AttackDamage
						damageUpdates = append(damageUpdates, DamageUpdate{
							ID:     p.ID,
							Type:   "player",
							Damage: e.AttackDamage,
						})
					}
				}
				e.State = StateCooldown
				e.StateTimer = 1.0 // 1 second cooldown
			}

		case StateCooldown:
			if e.StateTimer <= 0 {
				if nearestPlayer != nil && distanceTo(e, nearestPlayer) < e.AggroRadius {
					e.State = StatePursue
				} else {
					e.State = StateRoam
				}
			}

		case StateDeath:
			if e.StateTimer <= 0 {
				e.IsAlive = false
				continue
			}
		}

		// Update position
		e.X += e.VelocityX * deltaTime
		e.Y += e.VelocityY * deltaTime

		// Update direction based on velocity
		if e.VelocityY < 0 {
			e.Direction = 3 // back
		} else if e.VelocityY > 0 {
			e.Direction = 0 // front
		} else if e.VelocityX > 0 {
			e.Direction = 2 // right
		} else if e.VelocityX < 0 {
			e.Direction = 1 // left
		}

		// Check for death and trigger OnDeath
		if e.HP <= 0 && e.State != StateDeath && !e.IsDeathProcessed {
			OnDeath(e, e.KillerID) // No killer ID yet (will be set in HandlePlayerAttacks)
		}

		enemyUpdates = append(enemyUpdates, EnemyUpdate{
			ID:        e.ID,
			X:         e.X,
			Y:         e.Y,
			HP:        e.HP,
			MaxHP:     e.MaxHP,
			Type:      e.Type,
			Timestamp: timestamp,
			Direction: e.Direction,
		})

		e.Mu.Unlock()
	}

	// Send updates
	if len(enemyUpdates) > 0 {
		enemyUpdateChan <- enemyUpdates
	}
	if len(damageUpdates) > 0 {
		damageUpdateChan <- damageUpdates
	}
	if len(attackUpdates) > 0 {
		attackUpdateChan <- attackUpdates
	}

	// Clean up dead enemies
	mu.Lock()
	for id, e := range Enemies {
		if !e.IsAlive {
			delete(Enemies, id)
		}
	}
	mu.Unlock()
}

// OnDeath handles enemy death actions (called once when HP reaches 0)
func OnDeath(e *Enemy, killerID string) {
	if e.IsDeathProcessed {
		return // Prevent multiple calls
	}
	e.IsDeathProcessed = true

	// Store the killer ID
	e.KillerID = killerID

	log.Println("ondeath, killerId: ", e.KillerID)

	// Award XP to the player who killed the enemy
	if killerID != "" {
		// mu.Lock()
		if killer, exists := players[killerID]; exists {
			addXP(killer, e.XPDrop)
			log.Println("Awarded", e.XPDrop, "XP to player", killerID, "for killing enemy", e.ID)
		}
		// mu.Unlock()
	}

	// Additional death actions can be added here (e.g., item drops, score, etc.)
	// For now, transition to death state and clean up later
	e.State = StateDeath
	e.StateTimer = 1.0 // 1 second death animation
	e.VelocityX = 0
	e.VelocityY = 0
}

func updateRoamState(e *Enemy, deltaTime float32) {

	// Randomly change direction occasionally
	if rand.Float32() < 0.05 { // 5% chance per tick
		angle := rand.Float32() * 2 * math.Pi
		e.VelocityX = e.RoamSpeed * float32(math.Cos(float64(angle)))
		e.VelocityY = e.RoamSpeed * float32(math.Sin(float64(angle)))
	}

	// Keep enemy within roaming radius (e.g., 5 tiles) of spawn point
	maxDistance := float32(5 * 32)
	dx := e.X - e.SpawnPointX
	dy := e.Y - e.SpawnPointY
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
	if dist > maxDistance {
		// Move back toward spawn point
		angle := float32(math.Atan2(float64(-dy), float64(-dx)))
		e.VelocityX = e.RoamSpeed * float32(math.Cos(float64(angle)))
		e.VelocityY = e.RoamSpeed * float32(math.Sin(float64(angle)))
	}

	// apply anticlump
	antiClump(e, 100)

}

func updatePursueState(e *Enemy, target *Player, deltaTime float32) {
	if target == nil {
		e.VelocityX = 0
		e.VelocityY = 0
		return
	}

	dx := target.X - e.X
	dy := target.Y - e.Y
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
	if dist > 0 {
		e.VelocityX = (dx / dist) * e.RoamSpeed * 1.5 // 1.5x roam speed
		e.VelocityY = (dy / dist) * e.RoamSpeed * 1.5
	}

	// apply anticlump
	antiClump(e, 100)
}

func findNearestPlayer(e *Enemy) *Player {
	mu.RLock()
	defer mu.RUnlock()

	var nearest *Player
	minDist := float32(math.MaxFloat32)

	for _, p := range players {
		dist := distanceTo(e, p)
		if dist < minDist {
			minDist = dist
			nearest = p
		}
	}
	return nearest
}

func distanceTo(e *Enemy, p *Player) float32 {
	dx := e.X - p.X
	dy := e.Y - p.Y
	return float32(math.Sqrt(float64(dx*dx + dy*dy)))
}

// antiClump adds velocity to push the enemy away from nearby enemies
func antiClump(e *Enemy, strength float32) {
	const minSeparation = 64 // Minimum distance in pixels (1 tile) before repulsion kicks in
	const checkRadius = 128  // Only check enemies within 2 tiles (4x minSeparation) for efficiency

	// Use a simple spatial partitioning (grid) based on enemy position
	gridSize := 128 // Grid cell size (2 tiles, adjustable)
	gridX := int(e.X / float32(gridSize))
	gridY := int(e.Y / float32(gridSize))

	for _, other := range Enemies {
		if other == e || !other.IsAlive {
			continue // Skip self and dead enemies
		}

		// Quick check: only consider enemies in nearby grid cells or within checkRadius
		otherGridX := int(other.X / float32(gridSize))
		otherGridY := int(other.Y / float32(gridY))
		if (otherGridX < gridX-1 || otherGridX > gridX+1) || (otherGridY < gridY-1 || otherGridY > gridY+1) {
			dx := e.X - other.X
			dy := e.Y - other.Y
			roughDist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
			if roughDist > checkRadius {
				continue // Skip if too far
			}
		}

		dx := e.X - other.X
		dy := e.Y - other.Y
		dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))

		if dist < minSeparation && dist > 0 { // Avoid division by zero
			// Calculate repulsion force (stronger when closer)
			force := strength * (minSeparation - dist) / minSeparation
			// Normalize direction and apply force
			e.VelocityX += (dx / dist) * force
			e.VelocityY += (dy / dist) * force
		}
	}

	// Cap total velocity to prevent excessive movement
	maxSpeed := e.RoamSpeed * 1.5 // Use pursue speed as max
	totalSpeed := float32(math.Sqrt(float64(e.VelocityX*e.VelocityX + e.VelocityY*e.VelocityY)))
	if totalSpeed > maxSpeed {
		e.VelocityX = (e.VelocityX / totalSpeed) * maxSpeed
		e.VelocityY = (e.VelocityY / totalSpeed) * maxSpeed
	}
}

/*
// antiClump adds velocity to push the enemy away from nearby enemies
func antiClump(e *Enemy, strength float32) {
	const minSeparation = 64 // Minimum distance in pixels (1 tile) before repulsion kicks in

	for _, other := range Enemies {
		if other == e || !other.IsAlive {
			continue // Skip self and dead enemies
		}

		dx := e.X - other.X
		dy := e.Y - other.Y
		dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))

		if dist < minSeparation && dist > 0 { // Avoid division by zero
			// Calculate repulsion force (stronger when closer)
			force := strength * (minSeparation - dist) / minSeparation
			// Normalize direction and apply force
			e.VelocityX += (dx / dist) * force
			e.VelocityY += (dy / dist) * force
		}
	}

	// Cap total velocity to prevent excessive movement
	maxSpeed := e.RoamSpeed * 1.5 // Use pursue speed as max
	totalSpeed := float32(math.Sqrt(float64(e.VelocityX*e.VelocityX + e.VelocityY*e.VelocityY)))
	if totalSpeed > maxSpeed {
		e.VelocityX = (e.VelocityX / totalSpeed) * maxSpeed
		e.VelocityY = (e.VelocityY / totalSpeed) * maxSpeed
	}
}
*/

// HandleEnemyRespawns manages enemy respawning
/*
func HandleEnemyRespawns() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		enemyMu.Lock()
		currentTime := time.Now().UnixMilli()
		for id, e := range Enemies {
			if !e.IsAlive && e.RespawnTime > 0 && currentTime >= e.RespawnTime {
				// Respawn the enemy
				e.X = e.SpawnPointX
				e.Y = e.SpawnPointY
				e.HP = e.MaxHP
				e.IsAlive = true
				e.State = StateSpawn
				e.StateTimer = 2.0
				Enemies[id] = e
			}
		}
		enemyMu.Unlock()
	}
}
*/
