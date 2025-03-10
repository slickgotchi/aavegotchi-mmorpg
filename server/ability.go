package main

import (
	"log"
	"math"
	"time"
)

// Ability defines the interface for all abilities
type Ability interface {
	Execute(caster Entity, gs *GameServer, zone *Zone) []Message // Returns messages for broadcasting
	GetAPCost() int                                              // Returns the AP cost
	GetCooldown() time.Duration                                  // Returns the cooldown duration
	IsOnCooldown() bool                                          // Checks if the ability is on cooldown
	ResetCooldown()                                              // Resets the cooldown timer
}

// Entity is an interface for players and enemies to use abilities
type Entity interface {
	GetID() string
	GetX() float32
	GetY() float32
	GetStats() *Stats
	GetSpriteHeightPixels() float32
}

// HammerSwing represents the HammerSwing ability
type HammerSwing struct {
	APCost     int
	Cooldown   time.Duration
	LastUsed   time.Time
	Damage     int
	Radius     float32
	TargetType string // "enemy", "player", "all"
}

// NewHammerSwing creates a new HammerSwing ability with the given configuration
func NewHammerSwing(damage int, radius float32, targetType string, cooldownTime time.Duration) *HammerSwing {
	return &HammerSwing{
		APCost:     0,
		Cooldown:   cooldownTime,    //2 * time.Second,
		LastUsed:   time.Unix(0, 0), // Initialize to epoch for immediate use
		Damage:     damage,
		Radius:     radius,
		TargetType: targetType,
	}
}

// NewHammerSwingForCaster creates a HammerSwing instance based on the caster type
func NewHammerSwingForCaster(caster Entity) *HammerSwing {
	isEnemy := len(caster.GetID()) >= 5 && caster.GetID()[:5] == "enemy"

	if isEnemy {
		log.Println("enemy HammerSwing")
		return NewHammerSwing(
			10,       // Damage
			70,       // Radius (smaller than player's)
			"player", // Targets players only
			time.Duration(2000)*time.Millisecond,
		)
	} else {
		log.Println("player HammerSwing")
		return NewHammerSwing(
			15,      // Damage
			100,     // Radius
			"enemy", // Targets enemies only
			time.Duration(500)*time.Millisecond,
		)
	}
}

// Execute performs the HammerSwing ability
func (hs *HammerSwing) Execute(caster Entity, gs *GameServer, zone *Zone) []Message {
	if caster.GetStats().AP < hs.APCost {
		log.Printf("Ability failed for %s: insufficient AP (%d < %d)", caster.GetID(), caster.GetStats().AP, hs.APCost)
		return nil
	}
	if hs.IsOnCooldown() {
		log.Printf("Ability failed for %s: on cooldown", caster.GetID())
		return nil
	}

	caster.GetStats().AP -= hs.APCost
	hs.LastUsed = time.Now()

	var messages []Message
	casterX := caster.GetX()
	casterY := caster.GetY() - caster.GetSpriteHeightPixels()/2 // move attack to centre of sprite

	// Send a single visual effect message for the caster's position, regardless of hits
	messages = append(messages, Message{
		Type: "abilityEffect",
		Data: map[string]interface{}{
			"ability":  "HammerSwing",
			"casterId": caster.GetID(),
			"impactX":  casterX,
			"impactY":  casterY,
			"radius":   hs.Radius,
		},
	})
	log.Println("pos of attack ", casterY, ", pos of caster", caster.GetY())

	// ENEMY ATTACKS
	// Apply damage to targets within range (no additional messages for hits)
	if hs.TargetType == "player" || hs.TargetType == "all" {
		for _, player := range zone.Players {
			offsetY := player.SpriteHeightPixels / 2
			playerColliderRadius := player.SpriteHeightPixels / 2 * 1
			testDistanceSq := (hs.Radius + playerColliderRadius) * (hs.Radius + playerColliderRadius)

			dx := player.GetX() - casterX
			dy := (player.GetY() - offsetY) - casterY
			distSq := float32(dx*dx + dy*dy)
			if distSq <= testDistanceSq && player.GetID() != caster.GetID() {
				player.GetStats().HP -= hs.Damage
				// log.Printf("HammerSwing hit %s, HP now %d", player.GetID(), player.GetStats().HP)
			}
		}
	}

	// PLAYER ATTACKS
	if hs.TargetType == "enemy" || hs.TargetType == "all" {
		// NOTE: an enemies position is the bottom of their sprite so we need
		// to offset our collision test point up (negative offset for phaser) by half their
		// sprite height THEN we add their sprite radius (x1.2 for some buffer) to get
		// final distance check
		// ALSO: we need to account for the players sprite base being at its position so need
		// to offset our attack up to their centre
		for _, enemy := range zone.Enemies {
			offsetY := enemy.SpriteHeightPixels / 2
			enemyColliderRadius := enemy.SpriteHeightPixels / 2 * 1.2
			testDistanceSq := (hs.Radius + enemyColliderRadius) * (hs.Radius + enemyColliderRadius)

			dx := enemy.GetX() - casterX
			dy := (enemy.GetY() - offsetY) - casterY
			distSq := float32(dx*dx + dy*dy)
			if distSq <= testDistanceSq && enemy.GetID() != caster.GetID() {
				enemy.GetStats().HP -= hs.Damage
				// log.Printf("HammerSwing hit %s, HP now %d", enemy.GetID(), enemy.GetStats().HP)
			}
		}
	}

	return messages
}

// Fireball represents the Fireball ability
type Fireball struct {
	APCost     int
	Cooldown   time.Duration
	LastUsed   time.Time
	Damage     int
	Radius     float32 // Radius at impact point
	Range      float32 // Maximum targeting range
	TargetType string  // "enemy", "player", "all"
	ImpactX    float32 // Recorded impact position X (set during Telegraph)
	ImpactY    float32 // Recorded impact position Y (set during Telegraph)
	TargetID   string  // ID of the targeted entity (for messaging)
}

// NewFireball creates a new Fireball ability with the given configuration
func NewFireball(damage int, radius float32, distance float32, targetType string) *Fireball {
	return &Fireball{
		APCost:     0,
		Cooldown:   3 * time.Second,
		LastUsed:   time.Unix(0, 0),
		Damage:     damage,
		Radius:     radius,
		Range:      distance,
		TargetType: targetType,
		ImpactX:    0,
		ImpactY:    0,
		TargetID:   "",
	}
}

// NewFireballForCaster creates a Fireball instance based on the caster type
func NewFireballForCaster(caster Entity) *Fireball {
	isEnemy := len(caster.GetID()) >= 5 && caster.GetID()[:5] == "enemy"

	if isEnemy {
		return NewFireball(
			20,       // Damage
			25,       // Radius at impact
			300,      // Maximum targeting range
			"player", // Targets players only
		)
	} else {
		return NewFireball(
			25,      // Damage
			50,      // Radius at impact
			400,     // Maximum targeting range
			"enemy", // Targets enemies only
		)
	}
}

// SetImpactPosition sets the impact position for the Fireball AoE
func (fb *Fireball) SetImpactPosition(impactX, impactY float32, targetID string) {
	fb.ImpactX = impactX
	fb.ImpactY = impactY
	fb.TargetID = targetID
}

// Execute performs the Fireball ability
func (fb *Fireball) Execute(caster Entity, gs *GameServer, zone *Zone) []Message {
	if caster.GetStats().AP < fb.APCost {
		log.Printf("Ability failed for %s: insufficient AP (%d < %d)", caster.GetID(), caster.GetStats().AP, fb.APCost)
		return nil
	}
	if fb.IsOnCooldown() {
		log.Printf("Ability failed for %s: on cooldown", caster.GetID())
		return nil
	}

	caster.GetStats().AP -= fb.APCost
	fb.LastUsed = time.Now()

	var messages []Message
	impactX, impactY := fb.ImpactX, fb.ImpactY

	// Send a single visual effect message for the impact position, regardless of hits
	messages = append(messages, Message{
		Type: "abilityEffect",
		Data: map[string]interface{}{
			"ability":  "Fireball",
			"casterId": caster.GetID(),
			"impactX":  impactX,
			"impactY":  impactY,
			"radius":   fb.Radius,
		},
	})

	// Apply damage to targets within range (no additional messages for hits)
	if fb.TargetType == "player" || fb.TargetType == "all" {
		for _, player := range zone.Players {
			if player.GetID() == caster.GetID() {
				continue
			}
			dx := player.GetX() - impactX
			dy := player.GetY() - impactY
			dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
			if dist <= fb.Radius {
				player.GetStats().HP -= fb.Damage
				log.Printf("Fireball hit %s, HP now %d", player.GetID(), player.GetStats().HP)
			}
		}
	}

	if fb.TargetType == "enemy" || fb.TargetType == "all" {
		for _, enemy := range zone.Enemies {
			if enemy.GetID() == caster.GetID() {
				continue
			}
			dx := enemy.GetX() - impactX
			dy := enemy.GetY() - impactY
			dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
			if dist <= fb.Radius {
				enemy.GetStats().HP -= fb.Damage
				log.Printf("Fireball hit %s, HP now %d", enemy.GetID(), enemy.GetStats().HP)
			}
		}
	}

	// Reset impact position after execution
	fb.ImpactX, fb.ImpactY = 0, 0
	fb.TargetID = ""

	return messages
}

// ExecuteAbility executes the specified ability for the given entity
func ExecuteAbility(caster Entity, abilityName string, gs *GameServer, zone *Zone) []Message {
	var ability Ability
	switch abilityName {
	case "HammerSwing":
		ability = NewHammerSwingForCaster(caster)
	case "Fireball":
		ability = NewFireballForCaster(caster)
	default:
		log.Printf("Unknown ability: %s for %s", abilityName, caster.GetID())
		return nil
	}
	return ability.Execute(caster, gs, zone)
}

// GetAPCost returns the AP cost of the ability
func (hs *HammerSwing) GetAPCost() int {
	return hs.APCost
}

// GetCooldown returns the cooldown duration of the ability
func (hs *HammerSwing) GetCooldown() time.Duration {
	return hs.Cooldown
}

// IsOnCooldown checks if the ability is on cooldown
func (hs *HammerSwing) IsOnCooldown() bool {
	return time.Since(hs.LastUsed) < hs.Cooldown
}

// ResetCooldown resets the cooldown timer
func (hs *HammerSwing) ResetCooldown() {
	hs.LastUsed = time.Unix(0, 0)
}

// GetAPCost returns the AP cost of the ability
func (fb *Fireball) GetAPCost() int {
	return fb.APCost
}

// GetCooldown returns the cooldown duration of the ability
func (fb *Fireball) GetCooldown() time.Duration {
	return fb.Cooldown
}

// IsOnCooldown checks if the ability is on cooldown
func (fb *Fireball) IsOnCooldown() bool {
	return time.Since(fb.LastUsed) < fb.Cooldown
}

// ResetCooldown resets the cooldown timer
func (fb *Fireball) ResetCooldown() {
	fb.LastUsed = time.Unix(0, 0)
}
