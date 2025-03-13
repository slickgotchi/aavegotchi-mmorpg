package main

import (
	"log"
	"time"
)

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
        Cooldown:   cooldownTime,
        LastUsed:   time.Unix(0, 0),
        Damage:     damage,
        Radius:     radius,
        TargetType: targetType,
    }
}

// NewHammerSwingForCaster creates a HammerSwing instance based on the caster type
func NewHammerSwingForCaster(caster Entity) *HammerSwing {
    isEnemy := len(caster.GetID()) >= 5 && caster.GetID()[:5] == "enemy"

    if isEnemy {
        return NewHammerSwing(
            10,
            70,
            "player",
            2*time.Second,
        )
    } else {
        return NewHammerSwing(
            15,
            100,
            "enemy",
            500*time.Millisecond,
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
    casterY := caster.GetY() - caster.GetSpriteHeightPixels()/2

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

    if hs.TargetType == "player" || hs.TargetType == "all" {
        for _, player := range zone.Players {
            offsetY := player.GetSpriteHeightPixels() / 2
            playerColliderRadius := player.GetSpriteHeightPixels() / 2 * 1
            testDistanceSq := (hs.Radius + playerColliderRadius) * (hs.Radius + playerColliderRadius)

            dx := player.GetX() - casterX
            dy := (player.GetY() - offsetY) - casterY
            distSq := float32(dx*dx + dy*dy)
            if distSq <= testDistanceSq && player.GetID() != caster.GetID() {
                player.GetStats().HP -= hs.Damage
            }
        }
    }

    if hs.TargetType == "enemy" || hs.TargetType == "all" {
        for _, enemy := range zone.Enemies {
            offsetY := enemy.GetSpriteHeightPixels() / 2
            enemyColliderRadius := enemy.GetSpriteHeightPixels() / 2 * 1.2
            testDistanceSq := (hs.Radius + enemyColliderRadius) * (hs.Radius + enemyColliderRadius)

            dx := enemy.GetX() - casterX
            dy := (enemy.GetY() - offsetY) - casterY
            distSq := float32(dx*dx + dy*dy)
            if distSq <= testDistanceSq && enemy.GetID() != caster.GetID() {
                enemy.GetStats().HP -= hs.Damage
            }
        }
    }

    return messages
}

func (hs *HammerSwing) GetAPCost() int {
    return hs.APCost
}

func (hs *HammerSwing) GetCooldown() time.Duration {
    return hs.Cooldown
}

func (hs *HammerSwing) IsOnCooldown() bool {
    return time.Since(hs.LastUsed) < hs.Cooldown
}

func (hs *HammerSwing) ResetCooldown() {
    hs.LastUsed = time.Unix(0, 0)
}