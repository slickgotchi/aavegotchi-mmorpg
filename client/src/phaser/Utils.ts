import Phaser from "phaser";

export function alphaFlashSprite(
    sprite: Phaser.GameObjects.Sprite,
    scene: Phaser.Scene,
    duration_ms: number = 250
) {
    if (!sprite || !sprite.scene) return;
    scene.tweens.add({
        targets: sprite,
        alpha: { from: 0, to: 1 },
        duration: duration_ms / 2,
        yoyo: true,
        ease: "Quad.easeInOut",
        onComplete: () => sprite.setAlpha(0),
    });
}

export function isOnScreen(
    sprite: Phaser.GameObjects.Sprite,
    camera: Phaser.Cameras.Scene2D.Camera
): boolean {
    if (!sprite) return false;
    const worldView = camera.worldView;
    const x = sprite.x;
    const y = sprite.y;
    return (
        x >= worldView.left &&
        x <= worldView.right &&
        y >= worldView.top &&
        y <= worldView.bottom
    );
}
