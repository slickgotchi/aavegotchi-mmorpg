package main

import (
	"log"
	"math"
	"time"
)

// Fireball represents the Fireball ability
type Fireball struct {
    APCost     int
    Cooldown   time.Duration
    LastUsed   time.Time
    Damage     int
    Radius     float32
    Range      float32
    TargetType string
    ImpactX    float32
    ImpactY    float32
    TargetID   string
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
            20,
            50,
            300,
            "player",
        )
    } else {
        return NewFireball(
            25,
            50,
            400,
            "enemy",
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
            }
        }
    }

    fb.ImpactX, fb.ImpactY = 0, 0
    fb.TargetID = ""

    return messages
}

func (fb *Fireball) GetAPCost() int {
    return fb.APCost
}

func (fb *Fireball) GetCooldown() time.Duration {
    return fb.Cooldown
}

func (fb *Fireball) IsOnCooldown() bool {
    return time.Since(fb.LastUsed) < fb.Cooldown
}

func (fb *Fireball) ResetCooldown() {
    fb.LastUsed = time.Unix(0, 0)
}