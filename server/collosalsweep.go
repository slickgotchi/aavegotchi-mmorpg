package main

import (
	"log"
	"time"
)

// ColossalSweep represents the ColossalSweep ability
type ColossalSweep struct {
    APCost     int
    Cooldown   time.Duration
    LastUsed   time.Time
    Damage     int
    Radius     float32
    TargetType string
}

// NewColossalSweep creates a new ColossalSweep ability with the given configuration
func NewColossalSweep(damage int, radius float32, targetType string, cooldownTime time.Duration, apCost int) *ColossalSweep {
    return &ColossalSweep{
        APCost:     apCost,
        Cooldown:   cooldownTime,
        LastUsed:   time.Unix(0, 0),
        Damage:     damage,
        Radius:     radius,
        TargetType: targetType,
    }
}

// NewColossalSweepForCaster creates a ColossalSweep instance based on the caster type
func NewColossalSweepForCaster(caster Entity) *ColossalSweep {
    isEnemy := len(caster.GetID()) >= 5 && caster.GetID()[:5] == "enemy"

    if isEnemy {
        return NewColossalSweep(
            20,
            100,
            "player",
            3*time.Second,
            20,
        )
    } else {
        return NewColossalSweep(
            30,
            150,
            "enemy",
            2*time.Second,
            20,
        )
    }
}

// Execute performs the ColossalSweep ability
func (cs *ColossalSweep) Execute(caster Entity, gs *GameServer, zone *Zone) []Message {
    if caster.GetStats().AP < cs.APCost {
        log.Printf("Ability failed for %s: insufficient AP (%d < %d)", caster.GetID(), caster.GetStats().AP, cs.APCost)
        return nil
    }
    if cs.IsOnCooldown() {
        log.Printf("Ability failed for %s: on cooldown", caster.GetID())
        return nil
    }

    caster.GetStats().AP -= cs.APCost
    cs.LastUsed = time.Now()

    var messages []Message
    casterX := caster.GetX()
    casterY := caster.GetY() - caster.GetSpriteHeightPixels()/2

    messages = append(messages, Message{
        Type: "abilityEffect",
        Data: map[string]interface{}{
            "ability":  "ColossalSweep",
            "casterId": caster.GetID(),
            "impactX":  casterX,
            "impactY":  casterY,
            "radius":   cs.Radius,
        },
    })

    if cs.TargetType == "player" || cs.TargetType == "all" {
        for _, player := range zone.Players {
            offsetY := player.GetSpriteHeightPixels() / 2
            playerColliderRadius := player.GetSpriteHeightPixels() / 2 * 1
            testDistanceSq := (cs.Radius + playerColliderRadius) * (cs.Radius + playerColliderRadius)

            dx := player.GetX() - casterX
            dy := (player.GetY() - offsetY) - casterY
            distSq := float32(dx*dx + dy*dy)
            if distSq <= testDistanceSq && player.GetID() != caster.GetID() {
                player.GetStats().HP -= cs.Damage
            }
        }
    }

    if cs.TargetType == "enemy" || cs.TargetType == "all" {
        for _, enemy := range zone.Enemies {
            offsetY := enemy.GetSpriteHeightPixels() / 2
            enemyColliderRadius := enemy.GetSpriteHeightPixels() / 2 * 1.2
            testDistanceSq := (cs.Radius + enemyColliderRadius) * (cs.Radius + enemyColliderRadius)

            dx := enemy.GetX() - casterX
            dy := (enemy.GetY() - offsetY) - casterY
            distSq := float32(dx*dx + dy*dy)
            if distSq <= testDistanceSq && enemy.GetID() != caster.GetID() {
                enemy.GetStats().HP -= cs.Damage
            }
        }
    }

    return messages
}

func (cs *ColossalSweep) GetAPCost() int {
    return cs.APCost
}

func (cs *ColossalSweep) GetCooldown() time.Duration {
    return cs.Cooldown
}

func (cs *ColossalSweep) IsOnCooldown() bool {
    return time.Since(cs.LastUsed) < cs.Cooldown
}

func (cs *ColossalSweep) ResetCooldown() {
    cs.LastUsed = time.Unix(0, 0)
}